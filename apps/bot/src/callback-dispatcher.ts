import { randomUUID } from 'node:crypto';
import type { CallbackData, ListMode } from './callback-data.js';
import type { ApiClient } from './api-client.js';
import type { SessionStore } from './session-store.js';
import type { ViewerView } from './viewer-view.js';
import { escapeHtml, isTelegramMessageNotModifiedError } from './utils.js';

const UNAVAILABLE_MSG = '🛠 Сервис временно недоступен, попробуйте ещё раз чуть позже.';

export type CtxLike = {
  chat?: { id: number | string };
  callbackQuery?: { message?: { message_id: number } };
  api: {
    editMessageText: (...args: any[]) => Promise<unknown>;
    deleteMessage: (...args: any[]) => Promise<unknown>;
  };
  reply: (...args: any[]) => Promise<unknown>;
};

export type InlineKeyboardLike = {
  text: (text: string, callback_data: string) => InlineKeyboardLike;
  row: () => InlineKeyboardLike;
};

export type DispatchDeps = {
  showList: (ctx: CtxLike, mode: ListMode, page: number, editMessageId?: number) => Promise<void>;
  showTaskDetail: (ctx: CtxLike, taskNumId: number, mode: ListMode, page: number, editMessageId: number) => Promise<void>;

  upsertUserFromCtx: (ctx: CtxLike) => Promise<ViewerView>;

  /**
   * Session-machine I/O. The bot picks a Prisma- or API-backed implementation
   * at startup based on `WRITE_VIA_API`; the dispatcher just forwards to it.
   */
  sessionStore: SessionStore;

  prisma: {
    task: {
      delete: (args: { where: { numId: number } }) => Promise<unknown>;
      findUnique: (args: unknown) => Promise<
        | { id: string; numId: number; title: string; dueAt?: Date | null; dueHasTime?: boolean }
        | null
      >;
      update: (args: unknown) => Promise<{ numId: number }>;
      create: (args: unknown) => Promise<unknown>;
    };
    user?: {
      findMany?: (args: unknown) => Promise<Array<{ numId: number; username?: string | null; firstName?: string | null }>>;
      findUnique?: (args: unknown) => Promise<{ id: string } | null>;
    };
  };

  PendingActionKind: {
    addTask: string;
    addTaskDraft: string;
    editTitle: string;
    setDueDate: string;
  };

  InlineKeyboard: new () => InlineKeyboardLike;
  fmtUser: (u: { username?: string | null; firstName?: string | null }) => string;
  fmtTaskLine: (t: unknown) => string;

  /**
   * P4 cutover: when `writeViaApi` is true and `api` is non-null, task WRITE
   * operations (create/update/delete) are routed through `@orbit/api` instead
   * of Prisma. On API failure the user sees "service unavailable" — no Prisma
   * fallback (this is the migration commit point).
   *
   * Session reads/writes always go through `sessionStore` (it picks the right
   * backend itself).
   */
  api?: ApiClient | null;
  writeViaApi?: boolean;
};

async function editOrReply(ctx: CtxLike, messageId: number | undefined, text: string) {
  if (messageId) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, messageId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      });
      return;
    } catch (e) {
      if (isTelegramMessageNotModifiedError(e)) return;
    }
  }
  await ctx.reply(text, { parse_mode: 'HTML' });
}

/**
 * Handles parsed callback_data routing.
 *
 * This function is intentionally DI-friendly so we can unit-test routing
 * without BOT_TOKEN/DATABASE_URL or real Prisma.
 */
export async function dispatchCallbackData(ctx: CtxLike, parsed: CallbackData, deps: DispatchDeps) {
  const messageId: number | undefined = ctx.callbackQuery?.message?.message_id;
  const useApi = !!(deps.writeViaApi && deps.api);

  switch (parsed.kind) {
    case 'noop':
      return;

    case 'v:list':
      if (!messageId) return;
      await deps.showList(ctx, parsed.mode, parsed.page, messageId);
      return;

    case 'v:add': {
      if (!messageId) return;
      const me = await deps.upsertUserFromCtx(ctx);
      await deps.sessionStore.deleteAll(me);
      await deps.sessionStore.create(me, 'addTask', {
        panelMode: parsed.mode,
        panelPage: parsed.page,
        panelMessageId: messageId,
      });

      const kb = new deps.InlineKeyboard().text('❌ Отмена', 'v:cancel');
      try {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, '✍️ Напиши текст задачи одним сообщением.', {
          parse_mode: 'HTML',
          reply_markup: kb,
        });
      } catch (e) {
        if (isTelegramMessageNotModifiedError(e)) return;
        throw e;
      }
      return;
    }

    case 'v:cancel': {
      if (!messageId) return;
      const me = await deps.upsertUserFromCtx(ctx);
      const pending = await deps.sessionStore.findLatest(me);
      await deps.sessionStore.deleteAll(me);

      // Edit-title and set-due-date prompts are sent as separate messages above
      // the panel. Cancelling should collapse only the prompt, not overwrite it
      // with a list (the panel above is still accurate).
      if (
        pending?.kind === deps.PendingActionKind.editTitle ||
        pending?.kind === deps.PendingActionKind.setDueDate
      ) {
        await editOrReply(ctx, messageId, '❌ Отмена.');
        return;
      }

      const mode = pending?.payload.panelMode ?? 'my';
      const page = pending?.payload.panelPage ?? 0;
      await deps.showList(ctx, mode, page, messageId);
      return;
    }

    case 'v:addDraft': {
      const me = await deps.upsertUserFromCtx(ctx);
      const pending = await deps.sessionStore.findLatestOfKind(me, 'addTaskDraft');

      if (!pending) {
        await editOrReply(ctx, messageId, 'Черновик задачи не найден 🙃');
        return;
      }

      if (parsed.action === 'cancel') {
        await deps.sessionStore.delete(me, pending.id);
        await editOrReply(ctx, messageId, 'Ок, не добавляю ✅');
        return;
      }

      const title = String(pending.payload.draftTitle ?? '').trim();
      if (!title) {
        await deps.sessionStore.delete(me, pending.id);
        await editOrReply(ctx, messageId, 'Пустой черновик, нечего добавлять 🙃');
        return;
      }

      const slicedTitle = title.slice(0, 200);
      let createdLine: string;
      if (useApi) {
        try {
          const dto = await deps.api!
            .asViewer(String(me.telegramUserId))
            .createTask({ title: slicedTitle }, randomUUID());
          createdLine = deps.fmtTaskLine({ title: dto.title, status: dto.status });
        } catch (e) {
          console.error('[write-via-api] createTask (draft) failed', { err: String(e) });
          await editOrReply(ctx, messageId, UNAVAILABLE_MSG);
          return;
        }
      } else {
        const task = await deps.prisma.task.create({
          data: { title: slicedTitle, createdById: me.id, assignedToId: me.id },
          include: { assignedTo: true },
        });
        createdLine = deps.fmtTaskLine(task);
      }

      await deps.sessionStore.delete(me, pending.id);
      await editOrReply(ctx, messageId, `✅ Создал задачу!\n\n${createdLine}`);
      await deps.showList(ctx, 'my', 0);
      return;
    }

    case 'v:task': {
      if (!messageId) return;
      await deps.showTaskDetail(ctx, parsed.taskNumId, parsed.mode, parsed.page, messageId);
      return;
    }

    case 't:delask': {
      if (!messageId) return;
      const kb = new deps.InlineKeyboard()
        .text('✅ Да, удалить', `t:delyes:${parsed.taskNumId}:${parsed.mode}:${parsed.page}`)
        .row()
        .text('❌ Отмена', `v:task:${parsed.taskNumId}:${parsed.mode}:${parsed.page}`);

      try {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, '🗑 Удалить задачу? Это действие нельзя отменить.', {
          parse_mode: 'HTML',
          reply_markup: kb,
        });
      } catch (e) {
        if (isTelegramMessageNotModifiedError(e)) return;
        throw e;
      }
      return;
    }

    case 't:delyes': {
      if (!messageId) return;
      if (useApi) {
        const me = await deps.upsertUserFromCtx(ctx);
        try {
          await deps.api!
            .asViewer(String(me.telegramUserId))
            .deleteTask(parsed.taskNumId, randomUUID());
        } catch (e) {
          console.error('[write-via-api] deleteTask failed', { err: String(e) });
          await editOrReply(ctx, messageId, UNAVAILABLE_MSG);
          return;
        }
      } else {
        await deps.prisma.task.delete({ where: { numId: parsed.taskNumId } });
      }
      await deps.showList(ctx, parsed.mode, parsed.page, messageId);
      return;
    }

    case 't:edit': {
      const me = await deps.upsertUserFromCtx(ctx);

      // Look up the task so we can render its current title in the prompt.
      // We also need a stable id to link the new session to: prismaTaskId on
      // the Prisma path, taskNumId on the API path.
      let taskTitle: string;
      let prismaTaskId: string | undefined;
      let linkTaskNumId: number | undefined;
      if (useApi) {
        try {
          const dto = await deps.api!
            .asViewer(String(me.telegramUserId))
            .getTask(parsed.taskNumId);
          if (!dto) {
            if (messageId) await deps.showList(ctx, parsed.mode, parsed.page, messageId);
            return;
          }
          taskTitle = dto.title;
          linkTaskNumId = dto.numId;
        } catch (e) {
          console.error('[write-via-api] getTask failed', { err: String(e) });
          await editOrReply(ctx, messageId, UNAVAILABLE_MSG);
          return;
        }
      } else {
        const task = await deps.prisma.task.findUnique({ where: { numId: parsed.taskNumId } });
        if (!task) {
          if (messageId) await deps.showList(ctx, parsed.mode, parsed.page, messageId);
          return;
        }
        taskTitle = task.title;
        prismaTaskId = task.id;
      }

      await deps.sessionStore.deleteAll(me);

      const kb = new deps.InlineKeyboard().text('❌ Отмена', 'v:cancel');
      const prompt = (await ctx.reply(
        `✏️ Текущий текст:\n<code>${escapeHtml(taskTitle)}</code>\n\nПришли новый текст одним сообщением.`,
        { parse_mode: 'HTML', reply_markup: kb } as any,
      )) as { message_id: number } | undefined;

      await deps.sessionStore.create(
        me,
        'editTitle',
        {
          panelMode: parsed.mode,
          panelPage: parsed.page,
          panelMessageId: messageId,
          promptMessageId: prompt?.message_id,
        },
        { taskNumId: linkTaskNumId, prismaTaskId },
      );
      return;
    }

    case 't:setDue': {
      const me = await deps.upsertUserFromCtx(ctx);

      // Same dual lookup pattern as t:edit — we need the task's current dueAt
      // to decide whether to render the "🗑 Очистить" button, plus a stable
      // id to link the session for an atomic later commit.
      let currentDueAt: Date | string | null | undefined;
      let prismaTaskId: string | undefined;
      let linkTaskNumId: number | undefined;
      if (useApi) {
        try {
          const dto = await deps.api!
            .asViewer(String(me.telegramUserId))
            .getTask(parsed.taskNumId);
          if (!dto) {
            if (messageId) await deps.showList(ctx, parsed.mode, parsed.page, messageId);
            return;
          }
          currentDueAt = dto.dueAt;
          linkTaskNumId = dto.numId;
        } catch (e) {
          console.error('[write-via-api] getTask failed', { err: String(e) });
          await editOrReply(ctx, messageId, UNAVAILABLE_MSG);
          return;
        }
      } else {
        const task = await deps.prisma.task.findUnique({ where: { numId: parsed.taskNumId } });
        if (!task) {
          if (messageId) await deps.showList(ctx, parsed.mode, parsed.page, messageId);
          return;
        }
        currentDueAt = task.dueAt;
        prismaTaskId = task.id;
      }

      await deps.sessionStore.deleteAll(me);

      const kb = new deps.InlineKeyboard();
      if (currentDueAt) kb.text('🗑 Очистить', 'v:clearDue');
      kb.text('❌ Отмена', 'v:cancel');

      const prompt = (await ctx.reply(
        `📅 Когда сделать?\n\nФормат: <code>27.04.2026</code> или <code>27.04.2026 18:00</code>`,
        { parse_mode: 'HTML', reply_markup: kb } as any,
      )) as { message_id: number } | undefined;

      await deps.sessionStore.create(
        me,
        'setDueDate',
        {
          panelMode: parsed.mode,
          panelPage: parsed.page,
          panelMessageId: messageId,
          promptMessageId: prompt?.message_id,
        },
        { taskNumId: linkTaskNumId, prismaTaskId },
      );
      return;
    }

    case 'v:clearDue': {
      if (!messageId) return;
      const me = await deps.upsertUserFromCtx(ctx);
      const pending = await deps.sessionStore.findLatestOfKind(me, 'setDueDate');

      if (!pending) {
        await editOrReply(ctx, messageId, 'Уже неактуально 🙃');
        return;
      }

      // Atomic: clear task due fields + delete the session in one go.
      // SessionStore picks Prisma `$transaction` or API `commitSession` based on
      // the backend; the dispatcher doesn't care which.
      await deps.sessionStore.commit(me, pending.id, { dueAt: null, dueHasTime: false });

      const chatId = ctx.chat!.id;
      const promptId = pending.payload.promptMessageId ?? messageId;
      try { await ctx.api.deleteMessage(chatId, promptId); } catch {}
      if (pending.payload.panelMessageId) {
        try { await ctx.api.deleteMessage(chatId, pending.payload.panelMessageId); } catch {}
      }

      await ctx.reply('✅ Срок убран');

      const mode = pending.payload.panelMode ?? 'my';
      const page = pending.payload.panelPage ?? 0;
      await deps.showList(ctx, mode, page);
      return;
    }

    case 't:done':
    case 't:reopen': {
      if (!messageId) return;
      const isDone = parsed.kind === 't:done';

      if (useApi) {
        const me = await deps.upsertUserFromCtx(ctx);
        try {
          // API derives `doneAt` server-side from the status transition.
          await deps.api!
            .asViewer(String(me.telegramUserId))
            .updateTask(parsed.taskNumId, { status: isDone ? 'done' : 'open' }, randomUUID());
        } catch (e) {
          console.error('[write-via-api] updateTask status failed', { err: String(e) });
          await editOrReply(ctx, messageId, UNAVAILABLE_MSG);
          return;
        }
      } else {
        await deps.prisma.task.update({
          where: { numId: parsed.taskNumId },
          data: {
            status: isDone ? 'done' : 'open',
            doneAt: isDone ? new Date() : null,
          },
          include: { assignedTo: true, createdBy: true },
        });
      }

      await deps.showList(ctx, parsed.mode, parsed.page, messageId);
      return;
    }


    default: {
      const _x: never = parsed;
      return _x;
    }
  }
}
