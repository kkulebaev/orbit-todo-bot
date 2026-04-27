import type { CallbackData, ListMode } from './callback-data.js';
import { escapeHtml, isTelegramMessageNotModifiedError } from './utils.js';

export type CtxLike = {
  chat?: { id: number | string };
  callbackQuery?: { message?: { message_id: number } };
  api: {
    editMessageText: (...args: any[]) => Promise<unknown>;
  };
  reply: (...args: any[]) => Promise<unknown>;
};

export type InlineKeyboardLike = {
  text: (text: string, callback_data: string) => InlineKeyboardLike;
  row: () => InlineKeyboardLike;
};

export type PendingActionLike = {
  id: string;
  kind?: string | null;
  taskId?: string | null;
  panelMode?: string | null;
  panelPage?: number | null;
  panelMessageId?: number | null;
  draftTitle?: string | null;
};

export type DispatchDeps = {
  showList: (ctx: CtxLike, mode: ListMode, page: number, editMessageId?: number) => Promise<void>;
  showTaskDetail: (ctx: CtxLike, taskNumId: number, mode: ListMode, page: number, editMessageId: number) => Promise<void>;

  upsertUserFromCtx: (ctx: CtxLike) => Promise<{ id: string }>;

  prisma: {
    pendingAction: {
      deleteMany: (args: { where: { userId: string } }) => Promise<unknown>;
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      findFirst: (args: unknown) => Promise<PendingActionLike | null>;
      delete: (args: { where: { id: string } }) => Promise<unknown>;
    };
    task: {
      delete: (args: { where: { numId: number } }) => Promise<unknown>;
      findUnique: (args: unknown) => Promise<
        | { id: string; title: string; dueAt?: Date | null; dueHasTime?: boolean }
        | null
      >;
      update: (args: unknown) => Promise<{ numId: number }>;
      create: (args: unknown) => Promise<unknown>;
    };
    user: {
      // kept for future features; currently assignment is disabled
      findMany: (args: unknown) => Promise<Array<{ numId: number; username?: string | null; firstName?: string | null }>>;
      findUnique: (args: unknown) => Promise<{ id: string } | null>;
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
      await deps.prisma.pendingAction.deleteMany({ where: { userId: me.id } });
      await deps.prisma.pendingAction.create({
        data: {
          kind: deps.PendingActionKind.addTask,
          userId: me.id,
          panelMode: parsed.mode,
          panelPage: parsed.page,
          panelMessageId: messageId,
        },
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
      const pending = await deps.prisma.pendingAction.findFirst({ where: { userId: me.id }, orderBy: { createdAt: 'desc' } });
      await deps.prisma.pendingAction.deleteMany({ where: { userId: me.id } });

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

      const mode = (pending?.panelMode as ListMode | null | undefined) ?? 'my';
      const page = pending?.panelPage ?? 0;
      await deps.showList(ctx, mode, page, messageId);
      return;
    }

    case 'v:addDraft': {
      const me = await deps.upsertUserFromCtx(ctx);
      const pending = await deps.prisma.pendingAction.findFirst({
        where: { userId: me.id, kind: deps.PendingActionKind.addTaskDraft },
        orderBy: { createdAt: 'desc' },
      });

      if (!pending) {
        await editOrReply(ctx, messageId, 'Черновик задачи не найден 🙃');
        return;
      }

      if (parsed.action === 'cancel') {
        await deps.prisma.pendingAction.delete({ where: { id: pending.id } });
        await editOrReply(ctx, messageId, 'Ок, не добавляю ✅');
        return;
      }

      const title = String(pending.draftTitle ?? '').trim();
      if (!title) {
        await deps.prisma.pendingAction.delete({ where: { id: pending.id } });
        await editOrReply(ctx, messageId, 'Пустой черновик, нечего добавлять 🙃');
        return;
      }

      const task = await deps.prisma.task.create({
        data: { title: title.slice(0, 200), createdById: me.id, assignedToId: me.id },
        include: { assignedTo: true },
      });

      await deps.prisma.pendingAction.delete({ where: { id: pending.id } });
      await editOrReply(ctx, messageId, `✅ Создал задачу!\n\n${deps.fmtTaskLine(task)}`);
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
      await deps.prisma.task.delete({ where: { numId: parsed.taskNumId } });
      await deps.showList(ctx, parsed.mode, parsed.page, messageId);
      return;
    }

    case 't:edit': {
      const me = await deps.upsertUserFromCtx(ctx);
      const task = await deps.prisma.task.findUnique({ where: { numId: parsed.taskNumId } });
      if (!task) {
        if (messageId) await deps.showList(ctx, parsed.mode, parsed.page, messageId);
        return;
      }

      await deps.prisma.pendingAction.deleteMany({ where: { userId: me.id } });
      await deps.prisma.pendingAction.create({
        data: {
          kind: deps.PendingActionKind.editTitle,
          userId: me.id,
          taskId: task.id,
          panelMode: parsed.mode,
          panelPage: parsed.page,
          panelMessageId: messageId,
        },
      });

      const kb = new deps.InlineKeyboard().text('❌ Отмена', 'v:cancel');
      await ctx.reply(
        `✏️ Текущий текст:\n<code>${escapeHtml(task.title)}</code>\n\nПришли новый текст одним сообщением.`,
        { parse_mode: 'HTML', reply_markup: kb } as any,
      );
      return;
    }

    case 't:setDue': {
      const me = await deps.upsertUserFromCtx(ctx);
      const task = await deps.prisma.task.findUnique({ where: { numId: parsed.taskNumId } });
      if (!task) {
        if (messageId) await deps.showList(ctx, parsed.mode, parsed.page, messageId);
        return;
      }

      await deps.prisma.pendingAction.deleteMany({ where: { userId: me.id } });
      await deps.prisma.pendingAction.create({
        data: {
          kind: deps.PendingActionKind.setDueDate,
          userId: me.id,
          taskId: task.id,
          panelMode: parsed.mode,
          panelPage: parsed.page,
          panelMessageId: messageId,
        },
      });

      const kb = new deps.InlineKeyboard();
      if (task.dueAt) kb.text('🗑 Очистить', 'v:clearDue');
      kb.text('❌ Отмена', 'v:cancel');

      await ctx.reply(
        `📅 Когда сделать?\n\nФормат: <code>27.04.2026</code> или <code>27.04.2026 18:00</code>`,
        { parse_mode: 'HTML', reply_markup: kb } as any,
      );
      return;
    }

    case 'v:clearDue': {
      if (!messageId) return;
      const me = await deps.upsertUserFromCtx(ctx);
      const pending = await deps.prisma.pendingAction.findFirst({
        where: { userId: me.id, kind: deps.PendingActionKind.setDueDate },
        orderBy: { createdAt: 'desc' },
      });

      if (!pending) {
        await editOrReply(ctx, messageId, 'Уже неактуально 🙃');
        return;
      }

      if (pending.taskId) {
        await deps.prisma.task.update({
          where: { id: pending.taskId },
          data: { dueAt: null, dueHasTime: false },
        });
      }
      await deps.prisma.pendingAction.delete({ where: { id: pending.id } });

      await editOrReply(ctx, messageId, '✅ Срок убран.');

      const mode = (pending.panelMode as ListMode | null | undefined) ?? 'my';
      const page = pending.panelPage ?? 0;
      if (pending.panelMessageId) await deps.showList(ctx, mode, page, pending.panelMessageId);
      return;
    }

    case 't:done':
    case 't:reopen': {
      if (!messageId) return;
      const isDone = parsed.kind === 't:done';

      await deps.prisma.task.update({
        where: { numId: parsed.taskNumId },
        data: {
          status: isDone ? 'done' : 'open',
          doneAt: isDone ? new Date() : null,
        },
        include: { assignedTo: true, createdBy: true },
      });

      await deps.showList(ctx, parsed.mode, parsed.page, messageId);
      return;
    }


    default: {
      const _x: never = parsed;
      return _x;
    }
  }
}
