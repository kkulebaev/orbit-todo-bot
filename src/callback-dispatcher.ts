import type { CallbackData, ListMode } from './callback-data.js';

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
  panelMode?: string | null;
  panelPage?: number | null;
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
      findUnique: (args: unknown) => Promise<{ id: string } | null>;
      update: (args: unknown) => Promise<{ numId: number }>;
      create: (args: unknown) => Promise<unknown>;
    };
    user: {
      findMany: (args: unknown) => Promise<Array<{ numId: number; username?: string | null; firstName?: string | null }>>;
      findUnique: (args: unknown) => Promise<{ id: string } | null>;
    };
  };

  PendingActionKind: {
    addTask: string;
    addTaskDraft: string;
    editTitle: string;
  };

  InlineKeyboard: new () => InlineKeyboardLike;
  fmtUser: (u: { username?: string | null; firstName?: string | null }) => string;
  fmtTaskLine: (t: unknown) => string;
};

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
      await ctx.api.editMessageText(ctx.chat!.id, messageId, '✍️ Напиши текст задачи одним сообщением.', {
        parse_mode: 'HTML',
        reply_markup: kb,
      });
      return;
    }

    case 'v:cancel': {
      if (!messageId) return;
      const me = await deps.upsertUserFromCtx(ctx);
      const pending = await deps.prisma.pendingAction.findFirst({ where: { userId: me.id }, orderBy: { createdAt: 'desc' } });
      await deps.prisma.pendingAction.deleteMany({ where: { userId: me.id } });

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
        await ctx.reply('Черновик задачи не найден 🙃');
        return;
      }

      if (parsed.action === 'cancel') {
        await deps.prisma.pendingAction.delete({ where: { id: pending.id } });
        await ctx.reply('Ок, не добавляю ✅');
        return;
      }

      const title = String(pending.draftTitle ?? '').trim();
      if (!title) {
        await deps.prisma.pendingAction.delete({ where: { id: pending.id } });
        await ctx.reply('Пустой черновик, нечего добавлять 🙃');
        return;
      }

      const task = await deps.prisma.task.create({
        data: { title: title.slice(0, 200), createdById: me.id, assignedToId: me.id },
        include: { assignedTo: true },
      });

      await deps.prisma.pendingAction.delete({ where: { id: pending.id } });
      await ctx.reply(`✅ Создал задачу!\n\n${deps.fmtTaskLine(task)}`);
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

      await ctx.api.editMessageText(ctx.chat!.id, messageId, '🗑 Удалить задачу? Это действие нельзя отменить.', {
        parse_mode: 'HTML',
        reply_markup: kb,
      });
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
      await deps.prisma.pendingAction.create({ data: { kind: deps.PendingActionKind.editTitle, userId: me.id, taskId: task.id } });
      await ctx.reply(`✏️ Ок! Пришли новым сообщением <b>новый текст задачи</b>.\n\nОтмена: /cancel`, { parse_mode: 'HTML' });
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

      // UX: after marking a task as done, return user to "Мои задачи"
      if (isDone) {
        await deps.showList(ctx, 'my', 0, messageId);
        return;
      }

      // For reopen keep user on the task screen
      await deps.showTaskDetail(ctx, parsed.taskNumId, parsed.mode, parsed.page, messageId);
      return;
    }

    case 't:assign': {
      if (!messageId) return;
      const users = await deps.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
      const kb = new deps.InlineKeyboard();
      for (const u of users) {
        kb.text(deps.fmtUser(u), `t:assignTo:${parsed.taskNumId}:${u.numId}:${parsed.mode}:${parsed.page}`).row();
      }
      kb.text('⬅️ Назад', `v:task:${parsed.taskNumId}:${parsed.mode}:${parsed.page}`);

      await ctx.api.editMessageText(ctx.chat!.id, messageId, 'Кому назначить? 👇', { reply_markup: kb });
      return;
    }

    case 't:assignTo': {
      if (!messageId) return;
      const toUser = await deps.prisma.user.findUnique({ where: { numId: parsed.toUserNumId } });
      if (!toUser) {
        await deps.showTaskDetail(ctx, parsed.taskNumId, parsed.mode, parsed.page, messageId);
        return;
      }

      const updated = await deps.prisma.task.update({
        where: { numId: parsed.taskNumId },
        data: { assignedToId: toUser.id },
        include: { assignedTo: true, createdBy: true },
      });
      await deps.showTaskDetail(ctx, updated.numId, parsed.mode, parsed.page, messageId);
      return;
    }

    default: {
      const _x: never = parsed;
      return _x;
    }
  }
}
