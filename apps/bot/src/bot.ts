import { Context, InlineKeyboard } from 'grammy';
import { randomUUID } from 'node:crypto';
import { bot } from './bot-instance.js';
import { escapeHtml, fmtTaskLine, fmtUser, isTelegramMessageNotModifiedError, kbList, PAGE_SIZE, truncate, type ListMode } from './utils.js';
import { parseCallbackData } from './callback-data.js';
import { dispatchCallbackData } from './callback-dispatcher.js';
import { createCallbackDeduper } from './callback-deduper.js';
import { formatDueSmart, formatSmart, parseDueDateInput } from '@orbit/contracts';
import { createApiClient } from '@orbit/api-client';
import { fromApiTask, type TaskView } from './task-view.js';
import { fromApiUser, type ViewerView } from './viewer-view.js';
import { createApiSessionStore, type SessionStore } from './session-store.js';

const API_BASE_URL = process.env.API_BASE_URL ?? '';
const API_BOT_TOKEN = process.env.API_BOT_TOKEN ?? '';
if (!API_BASE_URL || !API_BOT_TOKEN) {
  throw new Error('Missing API_BASE_URL or API_BOT_TOKEN in env');
}

const apiClient = createApiClient({ baseUrl: API_BASE_URL, credential: { kind: 'service', token: API_BOT_TOKEN } });
const sessionStore: SessionStore = createApiSessionStore(apiClient);

const UNAVAILABLE_MSG = '🛠 Сервис временно недоступен, попробуйте ещё раз чуть позже.';

function mustBePrivateChat(ctx: Context) {
  return ctx.chat?.type === 'private';
}

async function upsertUserFromCtx(ctx: Context): Promise<ViewerView> {
  const from = ctx.from;
  if (!from) throw new Error('No from in context');
  const dto = await apiClient.asViewer(String(from.id)).upsertMe();
  return fromApiUser(dto);
}

function fmtDueSuffix(t: { dueAt: Date | null; dueHasTime: boolean }, now: Date = new Date()): string {
  if (!t.dueAt) return '';
  const { text, overdue } = formatDueSmart(t.dueAt, t.dueHasTime, now);
  return ` · ${overdue ? '⚠️' : '⏰'} <i>${text}</i>`;
}

async function getTasksForMode(mode: ListMode, viewer: ViewerView, page: number): Promise<{ tasks: TaskView[]; total: number }> {
  const res = await apiClient.asViewer(String(viewer.telegramUserId)).listTasks({ mode, page });
  return { tasks: res.items.map(fromApiTask), total: res.total };
}

async function showList(ctx: Context, mode: ListMode, page: number, editMessageId?: number) {
  const viewer = await upsertUserFromCtx(ctx);
  let { tasks, total } = await getTasksForMode(mode, viewer, page);

  // If the requested page is past the last non-empty page (e.g., the last task on it
  // was just completed/deleted), clamp back to the last page that still has data.
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  if (page > maxPage) {
    page = maxPage;
    ({ tasks } = await getTasksForMode(mode, viewer, page));
  }

  const title = mode === 'my'
    ? '🪐 <b>Orbit · Мои задачи</b>'
    : '🪐 <b>Orbit · Выполненные</b>';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageInfo = total > 0 ? `\nСтраница: <b>${page + 1}</b> / <b>${totalPages}</b>` : '';

  let body = '';
  if (tasks.length === 0) {
    body = mode === 'done'
      ? 'Пока нет выполненных задач.'
      : 'Пока нет задач. Можно:\n• нажать <b>➕ Добавить</b> ниже\n• или просто отправить текст задачи сообщением\n\nПереключаться между списками — кнопками <b>⏳ В работе</b> / <b>🗂️ Выполненные</b> внизу.';
  } else {
    const renderedAt = new Date();
    body = tasks
      .map((t, idx) => {
        const n = page * PAGE_SIZE + idx + 1;
        const due = mode === 'my' ? fmtDueSuffix(t, renderedAt) : '';
        return `<b>${n}.</b> ${escapeHtml(truncate(t.title))}${due}`;
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

function kbTaskDetail(taskNumId: number, status: 'open' | 'done', mode: ListMode, page: number) {
  const kb = new InlineKeyboard();
  if (status === 'open') kb.text('✅ Готово', `t:done:${taskNumId}:${mode}:${page}`);
  else kb.text('🔁 Вернуть', `t:reopen:${taskNumId}:${mode}:${page}`);
  kb.text('📝 Изменить', `t:edit:${taskNumId}:${mode}:${page}`);
  if (status === 'open') {
    kb.row();
    kb.text('📅 Срок', `t:setDue:${taskNumId}:${mode}:${page}`);
  }
  kb.row();
  kb.text('🗑 Удалить', `t:delask:${taskNumId}:${mode}:${page}`);
  kb.text('⬅️ Назад', `v:list:${mode}:${page}`);
  return kb;
}

async function showTaskDetail(ctx: Context, taskNumId: number, mode: ListMode, page: number, editMessageId: number) {
  const viewer = await upsertUserFromCtx(ctx);

  const dto = await apiClient
    .asViewer(String(viewer.telegramUserId))
    .getTask(taskNumId);
  const task = dto ? fromApiTask(dto) : null;

  if (!task) {
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

  const statusLine = task.status === 'done' ? '✅ Выполнено' : '⏳ В работе';
  const createdLine = `Создано: ${formatSmart(task.createdAt)}`;
  const dueLine = task.dueAt
    ? `\nСрок: ${formatDueSmart(task.dueAt, task.dueHasTime).text}`
    : '';
  const doneLine = task.status === 'done' && task.doneAt
    ? `\nЗакрыто: ${formatSmart(task.doneAt)}`
    : '';
  const text =
    `📝 <b>Задача</b>\n\n` +
    `<b>${escapeHtml(task.title)}</b>\n\n` +
    `${statusLine}\n` +
    `${createdLine}${dueLine}${doneLine}`;

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
  try {
    const me = await upsertUserFromCtx(ctx);
    try { await sessionStore.deleteAll(me); } catch (e) { console.warn('[api] deleteAll warn', { err: String(e) }); }
    await showList(ctx, 'my', 0);
  } catch (e) {
    console.error('[api] /start error', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
  }
});

bot.command('help', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  const kb = new InlineKeyboard()
    .text('🪐 Мои задачи', 'v:list:my:0')
    .text('🗂️ Выполненные', 'v:list:done:0');
  await ctx.reply(
    `🪐 <b>Orbit · help</b>\n\n` +
      `📌 Команды:\n` +
      `/add &lt;text&gt; — создать задачу\n` +
      `/my — мои открытые\n` +
      `/done — выполненные\n` +
      `/cancel — отменить ввод`,
    { parse_mode: 'HTML', reply_markup: kb },
  );
});

bot.command('cancel', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  try {
    const me = await upsertUserFromCtx(ctx);
    try { await sessionStore.deleteAll(me); } catch (e) { console.warn('[api] deleteAll warn', { err: String(e) }); }
    await ctx.reply('Ок, отменил ✅🪐');
  } catch (e) {
    console.error('[api] /cancel error', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
  }
});

bot.command('add', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;

  let me: ViewerView;
  try {
    me = await upsertUserFromCtx(ctx);
  } catch (e) {
    console.error('[api] upsertMe failed', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
    return;
  }

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

  try {
    const dto = await apiClient
      .asViewer(String(me.telegramUserId))
      .createTask({ title: parsed.title }, randomUUID());
    await ctx.reply(`✅ Создал задачу!\n\n${fmtTaskLine({ title: dto.title, status: dto.status })}`);
  } catch (e) {
    console.error('[api] createTask failed', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
    return;
  }
  await showList(ctx, 'my', 0);
});

// Text input handler for pending actions (e.g., editing task title).
// Note: this handler is registered as a side-effect; it cannot be unit-tested directly
// (see CLAUDE.md "Handler registration"). The API-failure → UNAVAILABLE_MSG paths below
// are verified by inspection. Underlying `sessionStore.commit` is covered by tests in
// callback-dispatcher.test.ts; extracting these branches into testable functions is in
// the post-P5 follow-up backlog.
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

  let me: ViewerView;
  try {
    me = await upsertUserFromCtx(ctx);
  } catch (e) {
    console.error('[api] upsertMe failed in message:text', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
    return;
  }

  const pending = await sessionStore.findLatest(me);

  if (!pending) {
    // UX: allow adding a task by simply sending a text message (without pressing ➕)
    // Ask for confirmation to avoid accidental task creation from random chat messages
    const titleDraft = text.slice(0, 200);

    await sessionStore.deleteAll(me);
    await sessionStore.create(me, 'addTaskDraft', { draftTitle: titleDraft });

    const kb = new InlineKeyboard()
      .text('✅ Добавить', 'v:addDraft:confirm')
      .text('❌ Не добавлять', 'v:addDraft:cancel');

    await ctx.reply(`Добавить задачу?\n\n📝 ${escapeHtml(titleDraft)}`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  if (pending.kind === 'editTitle') {
    const newTitle = text.slice(0, 200);
    let ok: boolean;
    try {
      ok = await sessionStore.commit(me, pending.id, { title: newTitle });
    } catch (e) {
      console.error('[api] editTitle commit failed', { err: String(e) });
      await ctx.reply(UNAVAILABLE_MSG);
      return;
    }
    if (!ok) {
      await ctx.reply('Задача уже не существует 🙃');
      return;
    }

    const chatId = ctx.chat!.id;
    const promptId = pending.payload.promptMessageId;
    const panelId = pending.payload.panelMessageId;
    if (promptId) { try { await ctx.api.deleteMessage(chatId, promptId); } catch {} }
    if (panelId) { try { await ctx.api.deleteMessage(chatId, panelId); } catch {} }

    await ctx.reply('✅ Задача обновлена');

    const mode = pending.payload.panelMode ?? 'my';
    const page = pending.payload.panelPage ?? 0;
    await showList(ctx, mode, page);
    return;
  }

  if (pending.kind === 'setDueDate') {
    const result = parseDueDateInput(text);
    if (!result.ok) {
      if (result.error === 'past') {
        await ctx.reply('⚠️ Эта дата уже прошла. Попробуй ещё раз или /cancel.');
      } else {
        await ctx.reply(
          '⚠️ Не понял формат. Жду <code>27.04.2026</code> или <code>27.04.2026 18:00</code>. Или /cancel.',
          { parse_mode: 'HTML' },
        );
      }
      return;
    }

    let ok: boolean;
    try {
      ok = await sessionStore.commit(me, pending.id, {
        dueAt: result.dueAt.toISOString(),
        dueHasTime: result.dueHasTime,
      });
    } catch (e) {
      console.error('[api] setDueDate commit failed', { err: String(e) });
      await ctx.reply(UNAVAILABLE_MSG);
      return;
    }
    if (!ok) {
      await ctx.reply('Задача уже не существует 🙃');
      return;
    }

    const chatId = ctx.chat!.id;
    const promptId = pending.payload.promptMessageId;
    const panelId = pending.payload.panelMessageId;
    if (promptId) { try { await ctx.api.deleteMessage(chatId, promptId); } catch {} }
    if (panelId) { try { await ctx.api.deleteMessage(chatId, panelId); } catch {} }

    await ctx.reply('✅ Срок установлен');

    const mode = pending.payload.panelMode ?? 'my';
    const page = pending.payload.panelPage ?? 0;
    await showList(ctx, mode, page);
    return;
  }

  if (pending.kind === 'addTask') {
    const title = text.slice(0, 200);

    try {
      await apiClient
        .asViewer(String(me.telegramUserId))
        .createTask({ title }, randomUUID());
    } catch (e) {
      console.error('[api] createTask failed', { err: String(e) });
      await ctx.reply(UNAVAILABLE_MSG);
      return;
    }
    await sessionStore.delete(me, pending.id);

    const mode = pending.payload.panelMode ?? 'my';
    const page = pending.payload.panelPage ?? 0;
    const panelMessageId = pending.payload.panelMessageId;
    await showList(ctx, mode, page, panelMessageId);
    return;
  }

  if (pending.kind === 'addTaskDraft') {
    // If user sends another message while draft is pending, treat it as updating the draft.
    const titleDraft = text.slice(0, 200);
    await sessionStore.updatePayload(me, pending.id, { draftTitle: titleDraft });

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
  try {
    const me = await upsertUserFromCtx(ctx);
    try { await sessionStore.deleteAll(me); } catch (e) { console.warn('[api] deleteAll warn', { err: String(e) }); }
    await showList(ctx, 'my', 0);
  } catch (e) {
    console.error('[api] /my error', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
  }
});

bot.command('done', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  try {
    const me = await upsertUserFromCtx(ctx);
    try { await sessionStore.deleteAll(me); } catch (e) { console.warn('[api] deleteAll warn', { err: String(e) }); }
    await showList(ctx, 'done', 0);
  } catch (e) {
    console.error('[api] /done error', { err: String(e) });
    await ctx.reply(UNAVAILABLE_MSG);
  }
});

// --- Callback dispatcher (parseCallbackData) ---

const callbackDeduper = createCallbackDeduper({ ttlMs: 60_000, maxSize: 10_000 });

bot.on('callback_query:data', async (ctx, next) => {
  const callbackQueryId: string | undefined = (ctx.callbackQuery as any)?.id;
  if (callbackQueryId && callbackDeduper.isDuplicate(callbackQueryId)) {
    try {
      await ctx.answerCallbackQuery();
    } catch {}
    return;
  }

  const parsed = parseCallbackData(ctx.callbackQuery.data);
  if (!parsed) return next();

  (ctx as any)._matchedCallbackHandled = true;

  try {
    await ctx.answerCallbackQuery();
  } catch {}

  try {
    await dispatchCallbackData(ctx, parsed, {
      showList,
      showTaskDetail,
      upsertUserFromCtx,
      sessionStore,
      InlineKeyboard,
      fmtUser,
      fmtTaskLine,
      api: apiClient,
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
