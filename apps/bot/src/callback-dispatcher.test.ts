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
      deleteMessage: vi.fn(async () => {}),
    },
    reply: vi.fn(async () => ({ message_id: 555 })),
  };
}

/** Builds a fake api-client whose `.asViewer()` always returns the same spy
 *  bundle. The returned `_view` lets tests assert calls per-method. */
function createFakeApi() {
  const v = {
    updateTask: vi.fn(async () => ({ numId: 7, title: 'x', status: 'open' })),
    deleteTask: vi.fn(async () => true),
    createTask: vi.fn(async () => ({ numId: 99, title: 'created', status: 'open' })),
    getTask: vi.fn(async () => ({
      numId: 7,
      title: 'купить хлеб',
      status: 'open' as const,
      dueAt: null as string | null,
      dueHasTime: false,
    })),
  };
  return {
    asViewer: vi.fn(() => v),
    _view: v,
  };
}

/**
 * Builds default DispatchDeps with a fake api-client and mocked sessionStore.
 * All task I/O goes through `api` after P5.
 */
function makeDeps() {
  const api = createFakeApi();

  const sessionStore = {
    findLatest: vi.fn(async () => null),
    findLatestOfKind: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'session-new', kind: 'addTask', payload: {} })),
    updatePayload: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
    commit: vi.fn(async () => true),
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
    api,
    sessionStore,
    InlineKeyboard,
    fmtUser: (u: any) => (u.username ? `@${u.username}` : 'user'),
    fmtTaskLine: () => 'line',
    upsertUserFromCtx: vi.fn(async () => ({ id: 'me', telegramUserId: BigInt(42) })),
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

  it('routes v:add to sessionStore.deleteAll + create + editMessageText', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 'v:add', mode: 'all', page: 2 }, deps as any);

    expect(deps.sessionStore.deleteAll).toHaveBeenCalled();
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'addTask',
      { panelMode: 'all', panelPage: 2, panelMessageId: 123 },
    );
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  it('routes t:delyes to api.deleteTask then showList', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:delyes', taskNumId: 5, mode: 'my', page: 0 }, deps as any);

    expect(deps.api._view.deleteTask).toHaveBeenCalledWith(5, expect.any(String));
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
  });

  it('routes t:done to api.updateTask with status=done then returns to the same list+page', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:done', taskNumId: 7, mode: 'my', page: 2 }, deps as any);

    expect(deps.api._view.updateTask).toHaveBeenCalledWith(7, { status: 'done' }, expect.any(String));
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 2, 123);
    expect(deps.showTaskDetail).not.toHaveBeenCalled();
  });

  it('routes t:reopen to api.updateTask with status=open then returns to the same list+page', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(ctx, { kind: 't:reopen', taskNumId: 7, mode: 'done', page: 1 }, deps as any);

    expect(deps.api._view.updateTask).toHaveBeenCalledWith(7, { status: 'open' }, expect.any(String));
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'done', 1, 123);
    expect(deps.showTaskDetail).not.toHaveBeenCalled();
  });

  it('routes v:addDraft:cancel to sessionStore.delete and editMessageText', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1', kind: 'addTaskDraft', payload: { draftTitle: 'x' },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:addDraft', action: 'cancel' }, deps as any);

    expect(deps.sessionStore.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'p1',
    );
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('routes v:addDraft:confirm to api.createTask + sessionStore.delete + editMessageText + fresh /my panel', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1', kind: 'addTaskDraft', payload: { draftTitle: 'купить молоко' },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:addDraft', action: 'confirm' }, deps as any);

    expect(deps.api._view.createTask).toHaveBeenCalledWith({ title: 'купить молоко' }, expect.any(String));
    expect(deps.sessionStore.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'p1',
    );
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

  it('t:edit reads task via api.getTask, creates editTitle session with panel context and sends prompt with old title in <code>', async () => {
    const ctx = makeCtx();
    (ctx.reply as any) = vi.fn(async () => ({ message_id: 555 }));
    const deps = makeDeps();
    // api.getTask default returns { numId: 7, title: 'купить хлеб', ... }

    await dispatchCallbackData(ctx, { kind: 't:edit', taskNumId: 7, mode: 'done', page: 2 }, deps as any);

    expect(deps.api._view.getTask).toHaveBeenCalledWith(7);
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'editTitle',
      {
        panelMode: 'done',
        panelPage: 2,
        panelMessageId: 123,
        promptMessageId: 555,
      },
      { taskNumId: 7 },
    );

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[0]).toContain('<code>купить хлеб</code>');
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([[{ text: '❌ Отмена', callback_data: 'v:cancel' }]]);
  });

  it('t:edit HTML-escapes the old title to prevent injection', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.api._view.getTask = vi.fn(async () => ({
      numId: 1,
      title: '<script>alert(1)</script>',
      status: 'open' as const,
      dueAt: null,
      dueHasTime: false,
    }));

    await dispatchCallbackData(ctx, { kind: 't:edit', taskNumId: 1, mode: 'my', page: 0 }, deps as any);

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[0]).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(replyArgs[0]).not.toContain('<script>');
  });

  it('t:edit silently returns to the list when api.getTask returns null (task gone)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.api._view.getTask = vi.fn(async () => null);

    await dispatchCallbackData(
      ctx,
      { kind: 't:edit', taskNumId: 99, mode: 'my', page: 0 },
      deps as any,
    );

    expect(deps.sessionStore.create).not.toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
  });

  it('v:cancel collapses the prompt only when cancelling an edit-title flow', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatest = vi.fn(async () => ({
      id: 'p1', kind: 'editTitle', payload: { panelMode: 'my', panelPage: 3 },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:cancel' }, deps as any);

    expect(deps.sessionStore.deleteAll).toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('v:cancel from add-task pending restores the panel into a list', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatest = vi.fn(async () => ({
      id: 'p1', kind: 'addTask', payload: { panelMode: 'done', panelPage: 1 },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:cancel' }, deps as any);

    expect(deps.showList).toHaveBeenCalledWith(ctx, 'done', 1, 123);
  });

  it('v:cancel collapses the prompt for setDueDate flow too', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatest = vi.fn(async () => ({
      id: 'p1', kind: 'setDueDate', payload: { panelMode: 'my', panelPage: 0 },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:cancel' }, deps as any);

    expect(deps.sessionStore.deleteAll).toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('t:setDue reads task via api.getTask and creates setDueDate session without clear button when no dueAt', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.api._view.getTask = vi.fn(async () => ({
      numId: 7,
      title: 'купить хлеб',
      status: 'open' as const,
      dueAt: null,
      dueHasTime: false,
    }));

    await dispatchCallbackData(ctx, { kind: 't:setDue', taskNumId: 7, mode: 'my', page: 1 }, deps as any);

    expect(deps.api._view.getTask).toHaveBeenCalledWith(7);
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'setDueDate',
      {
        panelMode: 'my',
        panelPage: 1,
        panelMessageId: 123,
        promptMessageId: 555,
      },
      { taskNumId: 7 },
    );

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([
      [{ text: '❌ Отмена', callback_data: 'v:cancel' }],
    ]);
  });

  it('t:setDue includes clear button when dueAt is set', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.api._view.getTask = vi.fn(async () => ({
      numId: 7,
      title: 'x',
      status: 'open' as const,
      dueAt: '2026-04-30T15:00:00.000Z',
      dueHasTime: true,
    }));

    await dispatchCallbackData(ctx, { kind: 't:setDue', taskNumId: 7, mode: 'my', page: 0 }, deps as any);

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([
      [{ text: '🗑 Очистить', callback_data: 'v:clearDue' }],
      [{ text: '❌ Отмена', callback_data: 'v:cancel' }],
    ]);
  });

  it('v:clearDue atomically commits {dueAt:null, dueHasTime:false}, deletes prompt+panel, sends confirmation and a fresh list', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1',
      kind: 'setDueDate',
      payload: {
        panelMode: 'my',
        panelPage: 2,
        panelMessageId: 999,
        promptMessageId: 777,
      },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:clearDue' }, deps as any);

    expect(deps.sessionStore.commit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'p1',
      { dueAt: null, dueHasTime: false },
    );
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(1, 777);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(1, 999);
    expect(ctx.reply).toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 2);
  });

  it('v:clearDue is a no-op when no setDueDate pending exists', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => null);

    await dispatchCallbackData(ctx, { kind: 'v:clearDue' }, deps as any);

    expect(deps.sessionStore.commit).not.toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('t:done surfaces "unavailable" message on API error (no fallback)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.api._view.updateTask = vi.fn(async () => { throw new Error('boom'); });

    await dispatchCallbackData(
      ctx,
      { kind: 't:done', taskNumId: 7, mode: 'my', page: 0 },
      deps as any,
    );

    expect(ctx.api.editMessageText).toHaveBeenCalled();
    const editArgs = (ctx.api.editMessageText as any).mock.calls[0];
    expect(String(editArgs[2])).toContain('временно недоступен');
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('v:add creates a session via sessionStore (api client not called for session ops)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await dispatchCallbackData(
      ctx,
      { kind: 'v:add', mode: 'my', page: 0 },
      deps as any,
    );

    expect(deps.sessionStore.deleteAll).toHaveBeenCalled();
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'addTask',
      { panelMode: 'my', panelPage: 0, panelMessageId: 123 },
    );
    // The API client must NOT be called for session creation — goes through sessionStore.
    expect(deps.api._view.createTask).not.toHaveBeenCalled();
    expect(deps.api.asViewer).not.toHaveBeenCalled();
  });

  it('v:clearDue: commit throws → surfaces UNAVAILABLE_MSG (T2 gap)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1',
      kind: 'setDueDate',
      payload: { panelMode: 'my', panelPage: 0, panelMessageId: 999, promptMessageId: 777 },
    })) as any;
    deps.sessionStore.commit = vi.fn(async () => { throw new Error('network timeout'); });

    await dispatchCallbackData(ctx, { kind: 'v:clearDue' }, deps as any);

    // Should reply with UNAVAILABLE_MSG — not throw out to grammY error handler.
    const editCalls = (ctx.api.editMessageText as any).mock.calls;
    const replyCalls = (ctx.reply as any).mock.calls;
    const allMessages = [
      ...editCalls.map((c: any[]) => String(c[2])),
      ...replyCalls.map((c: any[]) => String(c[0])),
    ];
    expect(allMessages.some((m) => m.includes('временно недоступен'))).toBe(true);
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('t:edit: api.getTask throws → surfaces UNAVAILABLE_MSG (T2 gap)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.api._view.getTask = vi.fn(async () => { throw new Error('API down'); });

    await dispatchCallbackData(
      ctx,
      { kind: 't:edit', taskNumId: 7, mode: 'my', page: 0 },
      deps as any,
    );

    // Should reply with UNAVAILABLE_MSG — not throw.
    const editCalls = (ctx.api.editMessageText as any).mock.calls;
    const replyCalls = (ctx.reply as any).mock.calls;
    const allMessages = [
      ...editCalls.map((c: any[]) => String(c[2])),
      ...replyCalls.map((c: any[]) => String(c[0])),
    ];
    expect(allMessages.some((m) => m.includes('временно недоступен'))).toBe(true);
    expect(deps.sessionStore.create).not.toHaveBeenCalled();
  });

  it('v:clearDue commits via sessionStore (api updateTask not called directly)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1',
      kind: 'setDueDate',
      payload: { panelMode: 'my', panelPage: 0, panelMessageId: 999, promptMessageId: 777 },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:clearDue' }, deps as any);

    expect(deps.sessionStore.commit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'p1',
      { dueAt: null, dueHasTime: false },
    );
    expect(deps.api._view.updateTask).not.toHaveBeenCalled();
  });
});
