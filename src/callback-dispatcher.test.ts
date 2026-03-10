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

  it('routes t:done to task.update then returns to my list', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:done', taskNumId: 7, mode: 'all', page: 1 }, deps as any);

    expect(deps.prisma.task.update).toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
    expect(deps.showTaskDetail).not.toHaveBeenCalled();
  });

  it('routes v:addDraft:cancel to pendingAction.delete and reply', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.pendingAction.findFirst = vi.fn(async () => ({ id: 'p1', draftTitle: 'x' }));

    await dispatchCallbackData(ctx, { kind: 'v:addDraft', action: 'cancel' }, deps as any);

    expect(deps.prisma.pendingAction.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('does nothing when messageId is missing for actions that require it', async () => {
    const ctx = makeCtx(null);
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 'v:list', mode: 'my', page: 0 }, deps as any);

    expect(deps.showList).not.toHaveBeenCalled();
  });
});
