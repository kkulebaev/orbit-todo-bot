import { describe, expect, it, vi } from 'vitest';
import { dispatchCallbackData } from './callback-dispatcher.js';

function makeCtx(messageId: number | null = 123) {
  return {
    chat: { id: 1 },
    callbackQuery: messageId === null
      ? { data: 'x' }
      : { data: 'x', message: { message_id: messageId } },
    api: {
      editMessageText: vi.fn(async () => {}),
    },
    reply: vi.fn(async () => {}),
  };
}

function makeDeps() {
  const prisma = {
    pendingAction: {
      deleteMany: vi.fn(async () => {}),
      create: vi.fn(async () => {}),
      findFirst: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
    },
    task: {
      delete: vi.fn(async () => {}),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({ numId: 7 })),
      create: vi.fn(async () => ({ id: 't1', title: 'x', status: 'open', assignedTo: { username: 'u' } })),
    },
    user: {
      findMany: vi.fn(async () => [{ id: 'u1', numId: 1, username: 'kk' }]),
      findUnique: vi.fn(async () => ({ id: 'u1', numId: 1, username: 'kk' })),
    },
  };

  class InlineKeyboard {
    inline_keyboard: any[] = [];
    text(text: string, callback_data: string) {
      this.inline_keyboard.push([{ text, callback_data }]);
      return this;
    }
    row() {
      this.inline_keyboard.push([]);
      return this;
    }
  }

  return {
    prisma,
    PendingActionKind: { addTask: 'addTask', addTaskDraft: 'addTaskDraft', editTitle: 'editTitle' },
    InlineKeyboard,
    fmtUser: (u: any) => (u.username ? `@${u.username}` : 'user'),
    fmtTaskLine: () => 'line',
    upsertUserFromCtx: vi.fn(async () => ({ id: 'me' })),
    showList: vi.fn(async () => {}),
    showTaskDetail: vi.fn(async () => {}),
  };
}

describe('callback-dispatcher routing', () => {
  it('routes v:list to showList', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 'v:list', mode: 'my', page: 0 }, deps as any);

    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
  });

  it('routes v:add to pendingAction + editMessageText', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 'v:add', mode: 'all', page: 2 }, deps as any);

    expect(deps.prisma.pendingAction.deleteMany).toHaveBeenCalled();
    expect(deps.prisma.pendingAction.create).toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  it('routes t:delyes to task.delete then showList', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:delyes', taskNumId: 5, mode: 'my', page: 0 }, deps as any);

    expect(deps.prisma.task.delete).toHaveBeenCalledWith({ where: { numId: 5 } });
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
  });

  it('routes t:done to task.update then returns to the same list+page', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:done', taskNumId: 7, mode: 'my', page: 2 }, deps as any);

    expect(deps.prisma.task.update).toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 2, 123);
    expect(deps.showTaskDetail).not.toHaveBeenCalled();
  });

  it('routes t:reopen to task.update then returns to the same list+page', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:reopen', taskNumId: 7, mode: 'done', page: 1 }, deps as any);

    expect(deps.prisma.task.update).toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'done', 1, 123);
    expect(deps.showTaskDetail).not.toHaveBeenCalled();
  });

  it('routes v:addDraft:cancel to pendingAction.delete and editMessageText', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.pendingAction.findFirst = vi.fn(async () => ({ id: 'p1', draftTitle: 'x' }));

    await dispatchCallbackData(ctx, { kind: 'v:addDraft', action: 'cancel' }, deps as any);

    expect(deps.prisma.pendingAction.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('routes v:addDraft:confirm to task.create + pendingAction.delete + editMessageText + fresh /my panel', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.pendingAction.findFirst = vi.fn(async () => ({ id: 'p1', draftTitle: 'купить молоко' }));

    await dispatchCallbackData(ctx, { kind: 'v:addDraft', action: 'confirm' }, deps as any);

    expect(deps.prisma.task.create).toHaveBeenCalled();
    expect(deps.prisma.pendingAction.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0);
  });

  it('does nothing when messageId is missing for actions that require it', async () => {
    const ctx = makeCtx(null);
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 'v:list', mode: 'my', page: 0 }, deps as any);

    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('t:edit creates editTitle pending with panel context and sends prompt with old title in <code>', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.task.findUnique = vi.fn(async () => ({ id: 'task-1', title: 'купить хлеб' }));

    await dispatchCallbackData(ctx, { kind: 't:edit', taskNumId: 7, mode: 'done', page: 2 }, deps as any);

    expect(deps.prisma.pendingAction.create).toHaveBeenCalledWith({
      data: {
        kind: 'editTitle',
        userId: 'me',
        taskId: 'task-1',
        panelMode: 'done',
        panelPage: 2,
        panelMessageId: 123,
      },
    });

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[0]).toContain('<code>купить хлеб</code>');
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([[{ text: '❌ Отмена', callback_data: 'v:cancel' }]]);
  });

  it('t:edit HTML-escapes the old title to prevent injection', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.task.findUnique = vi.fn(async () => ({ id: 'task-1', title: '<script>alert(1)</script>' }));

    await dispatchCallbackData(ctx, { kind: 't:edit', taskNumId: 1, mode: 'my', page: 0 }, deps as any);

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[0]).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(replyArgs[0]).not.toContain('<script>');
  });

  it('v:cancel collapses the prompt only when cancelling an edit-title flow', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.pendingAction.findFirst = vi.fn(async () => ({ id: 'p1', kind: 'editTitle', panelMode: 'my', panelPage: 3 }));

    await dispatchCallbackData(ctx, { kind: 'v:cancel' }, deps as any);

    expect(deps.prisma.pendingAction.deleteMany).toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('v:cancel from add-task pending restores the panel into a list', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.pendingAction.findFirst = vi.fn(async () => ({ id: 'p1', kind: 'addTask', panelMode: 'done', panelPage: 1 }));

    await dispatchCallbackData(ctx, { kind: 'v:cancel' }, deps as any);

    expect(deps.showList).toHaveBeenCalledWith(ctx, 'done', 1, 123);
  });
});
