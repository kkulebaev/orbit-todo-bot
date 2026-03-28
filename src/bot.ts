import 'dotenv/config';
import { Context, InlineKeyboard } from 'grammy';
import { PendingActionKind, PrismaClient, TaskStatus, User } from '@prisma/client';
import { bot } from './bot-instance.js';
import { escapeHtml, fmtTaskLine, fmtUser, isTelegramMessageNotModifiedError, kbList, PAGE_SIZE, type ListMode } from './utils.js';
import { parseCallbackData } from './callback-data.js';
import { dispatchCallbackData } from './callback-dispatcher.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL in env');

const prisma = new PrismaClient();

function mustBePrivateChat(ctx: Context) {
  return ctx.chat?.type === 'private';
}

async function upsertUserFromCtx(ctx: Context) {
  const from = ctx.from;
  if (!from) throw new Error('No from in context');

  return prisma.user.upsert({
    where: { telegramUserId: BigInt(from.id) },
    update: {
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
    create: {
      telegramUserId: BigInt(from.id),
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
  });
}

type PendingMode = 'my' | 'done';

async function getTasksForMode(mode: ListMode, viewer: User, page: number) {
  const where: any = {};
  if (mode === 'done') where.status = 'done';
  else where.status = 'open';

  // Privacy: lists should be scoped to the viewer
  where.assignedToId = viewer.id;

  const taskOrderBy = mode === 'done'
    ? [
        // UX: newest completed first
        { doneAt: 'desc' as const },
        // Fallback for tasks without doneAt (should be rare)
        { createdAt: 'desc' as const },
      ]
    : [
        // UX: newest created first
        { createdAt: 'desc' as const },
      ];

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: taskOrderBy,
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.task.count({ where }),
  ]);

  return { tasks, total };
}


async function showList(ctx: Context, mode: ListMode, page: number, editMessageId?: number) {
  const viewer = await upsertUserFromCtx(ctx);
  const { tasks, total } = await getTasksForMode(mode, viewer, page);

  const title = mode === 'my'
    ? '🪐 <b>Orbit · Мои задачи</b>'
    : '🪐 <b>Orbit · Выполненные</b>';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageInfo = total > 0 ? `\nСтраница: <b>${page + 1}</b> / <b>${totalPages}</b>` : '';

  let body = '';
  if (tasks.length === 0) {
    body = mode === 'done'
      ? 'Пока нет выполненных задач.'
      : 'Пока нет задач. Добавь первую командой:\n<code>/add купить молоко</code>';
  } else {
    body = tasks
      .map((t, idx) => {
        const n = page * PAGE_SIZE + idx + 1;
        const statusEmoji = t.status === 'done' ? '✅' : '⏳';
        return `${statusEmoji} <b>${n}.</b> ${escapeHtml(t.title)}`;
      })
      .join('\n');

    body += `\n\nНажми на номер задачи ниже, чтобы открыть действия.`;
  }

  const text = `${title}${pageInfo}\n\n${body}`;
  const reply_markup = kbList(mode, page, tasks, total);

  if (editMessageId) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, editMessageId, text, {
        parse_mode: 'HTML',
        reply_markup,
      });
    } catch (e) {
      // Бывает, что мы повторно рендерим тот же текст/клавиатуру
      // (Telegram в этом случае кидает 400: message is not modified)
      if (isTelegramMessageNotModifiedError(e)) return;

      // Fallback: if message can't be edited (or parse error), just send a fresh message.
      console.error('editMessageText failed, falling back to reply()', e);
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup });
  }
}

function kbTaskDetail(taskNumId: number, status: TaskStatus, mode: ListMode, page: number) {
  const kb = new InlineKeyboard();
  if (status === 'open') kb.text('✅ Готово', `t:done:${taskNumId}:${mode}:${page}`);
  else kb.text('🔁 Вернуть', `t:reopen:${taskNumId}:${mode}:${page}`);
  kb.text('📝 Изменить', `t:edit:${taskNumId}:${mode}:${page}`);
  kb.row();
  kb.text('🗑 Удалить', `t:delask:${taskNumId}:${mode}:${page}`);
  kb.text('⬅️ Назад', `v:list:${mode}:${page}`);
  return kb;
}

async function showTaskDetail(ctx: Context, taskNumId: number, mode: ListMode, page: number, editMessageId: number) {
  const viewer = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({
    where: { numId: taskNumId },
    include: { assignedTo: true, createdBy: true },
  });

  if (!task) {
    // Don't rely on callback popups (we may have already answered the callback).
    try {
      await ctx.api.editMessageText(ctx.chat!.id, editMessageId, '🙃 Задача не найдена.', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('⬅️ Назад', `v:list:${mode}:${page}`),
      });
    } catch (e) {
      if (isTelegramMessageNotModifiedError(e)) return;
      throw e;
    }
    return;
  }

  // UX: allow viewing tasks in the shared workspace (2-person bot). Actions are still gated elsewhere.
  // If you want stricter privacy later, re-enable creator/assignee check.

  const statusLine = task.status === 'done' ? '✅ Выполнено' : '⏳ В работе';
  const text =
    `📝 <b>Задача</b>\n\n` +
    `<b>${escapeHtml(task.title)}</b>\n\n` +
    `${statusLine}`;

  try {
    await ctx.api.editMessageText(ctx.chat!.id, editMessageId, text, {
      parse_mode: 'HTML',
      reply_markup: kbTaskDetail(task.numId, task.status, mode, page),
    });
  } catch (e) {
    if (isTelegramMessageNotModifiedError(e)) return;
    throw e;
  }
}

bot.command('start', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;

  const user = await upsertUserFromCtx(ctx);

  await ctx.reply(
    `Привет, ${escapeHtml(fmtUser(user))}! ✨\n\n` +
      `Я <b>Orbit</b> 🪐 — ваш милый TODO-бот.\n\n` +
      `Открой панель: /my\n` +
      `Быстро добавить: <code>/add купить молоко</code>\n\n` +
      `Но удобнее — через кнопку <b>➕ Добавить</b> в панели 👇`,
    { parse_mode: 'HTML' },
  );

  await showList(ctx, 'my', 0);
});

bot.command('help', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await ctx.reply(
    `🪐 Orbit · help\n\n` +
      `📌 Команды:\n` +
      `/add <text> — создать задачу себе\n` +
      `/my — мои открытые\n` +
      `/done — выполненные\n` +
      `/cancel — отменить ввод (например редактирование)`,
  );
});

bot.command('cancel', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  const me = await upsertUserFromCtx(ctx);
  await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
  await ctx.reply('Ок, отменил ✅🪐');
});

bot.command('add', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;

  const me = await upsertUserFromCtx(ctx);
  const text = (ctx.match as string | undefined)?.trim() ?? '';
  if (!text) {
    await ctx.reply('Напиши так: <code>/add купить молоко</code>', { parse_mode: 'HTML' });
    return;
  }

  const parsed = (await import('./bot-logic.js')).parseAddCommandText(text);
  if (!parsed) {
    await ctx.reply('Напиши так: <code>/add купить молоко</code>', { parse_mode: 'HTML' });
    return;
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.title,
      createdById: me.id,
      assignedToId: me.id,
    },
  });

  await ctx.reply(`✅ Создал задачу!\n\n${fmtTaskLine(task)}`);
  await showList(ctx, 'my', 0);
});

// Text input handler for pending actions (e.g., editing task title)
bot.on('message:text', async (ctx, next) => {
  if (!mustBePrivateChat(ctx)) return;

  const from = ctx.from;
  if (!from) return;

  const text = ctx.message.text.trim();
  if (!text) return;

  // let commands pass through
  if (text.startsWith('/')) {
    await next();
    return;
  }

  const me = await upsertUserFromCtx(ctx);
  const pending = await prisma.pendingAction.findFirst({
    where: { userId: me.id },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending) {
    // UX: allow adding a task by simply sending a text message (without pressing ➕)
    // Ask for confirmation to avoid accidental task creation from random chat messages
    const titleDraft = text.slice(0, 200);

    await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
    await prisma.pendingAction.create({
      data: {
        kind: PendingActionKind.addTaskDraft,
        userId: me.id,
        draftTitle: titleDraft,
      },
    });

    const kb = new InlineKeyboard()
      .text('✅ Добавить', 'v:addDraft:confirm')
      .text('❌ Не добавлять', 'v:addDraft:cancel');

    await ctx.reply(`Добавить задачу?\n\n📝 ${escapeHtml(titleDraft)}`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  if (pending.kind === PendingActionKind.editTitle && pending.taskId) {
    const newTitle = text.slice(0, 200);

    const task = await prisma.task.findUnique({ where: { id: pending.taskId }, include: { assignedTo: true } });
    if (!task) {
      await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
      await ctx.reply('Задача уже не существует 🙃');
      return;
    }

    await prisma.task.update({ where: { id: pending.taskId }, data: { title: newTitle } });
    await prisma.pendingAction.deleteMany({ where: { userId: me.id } });

    await ctx.reply(`✏️ Обновил задачу:\n\n${fmtTaskLine({ ...task, title: newTitle })}`);

    const mode = (pending.panelMode as PendingMode | null) ?? 'my';
    const page = pending.panelPage ?? 0;
    const panelMessageId = pending.panelMessageId ?? undefined;
    await showList(ctx, mode, page, panelMessageId);
    return;
  }

  if (pending.kind === PendingActionKind.addTask) {
    const title = text.slice(0, 200);

    await prisma.task.create({
      data: {
        title,
        createdById: me.id,
        assignedToId: me.id,
      },
    });

    await prisma.pendingAction.deleteMany({ where: { userId: me.id } });

    const mode = (pending.panelMode as PendingMode | null) ?? 'my';
    const page = pending.panelPage ?? 0;
    const panelMessageId = pending.panelMessageId ?? undefined;
    await showList(ctx, mode, page, panelMessageId);
    return;
  }

  if (pending.kind === PendingActionKind.addTaskDraft) {
    // If user sends another message while draft is pending, treat it as updating the draft
    const titleDraft = text.slice(0, 200);

    await prisma.pendingAction.update({
      where: { id: pending.id },
      data: { draftTitle: titleDraft },
    });

    const kb = new InlineKeyboard()
      .text('✅ Добавить', 'v:addDraft:confirm')
      .text('❌ Не добавлять', 'v:addDraft:cancel');

    await ctx.reply(`Добавить задачу?\n\n📝 ${escapeHtml(titleDraft)}`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  await next();
});

bot.command('my', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await showList(ctx, 'my', 0);
});

bot.command('done', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await showList(ctx, 'done', 0);
});

// --- Callback dispatcher (parseCallbackData) ---

bot.on('callback_query:data', async (ctx, next) => {
  const parsed = parseCallbackData(ctx.callbackQuery.data);
  if (!parsed) return next();

  (ctx as any)._matchedCallbackHandled = true;

  try {
    // Answer early to avoid Telegram timeout (where applicable)
    await ctx.answerCallbackQuery();
  } catch {}

  try {
    await dispatchCallbackData(ctx, parsed, {
      showList,
      showTaskDetail,
      upsertUserFromCtx,
      prisma,
      PendingActionKind,
      InlineKeyboard,
      fmtUser,
      fmtTaskLine,
    } as any);
    return;
  } catch (e) {
    console.error('callback dispatcher error', { parsed, e });
    return next();
  }
});

bot.use(async (ctx, next) => {
  // catch-all for unmatched callback queries (helps UX)
  if (ctx.callbackQuery?.data) {
    const before = (ctx as any)._matchedCallbackHandled;
    await next();
    const after = (ctx as any)._matchedCallbackHandled;
    if (!before && !after) {
      try {
        await ctx.answerCallbackQuery({ text: 'Не понял кнопку 🙃 Обнови список: 🔄 Обновить' } as any);
      } catch {
        // ignore
      }
    }
    return;
  }
  await next();
});

bot.catch((err) => {
  console.error('Bot error', err.error);
});

// Note: bot.start() (long polling) is disabled for Render/webhook deployments.
// Webhook server is implemented in src/server.ts and calls bot.handleUpdate().
export async function diagnostics() {
  console.log('Orbit bot handlers loaded');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  try {
    await prisma.user.count();
    console.log('DB check: OK');
  } catch (e) {
    console.error('DB check: FAILED', e);
  }
}

// noop: trigger CI
