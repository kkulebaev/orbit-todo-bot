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

/**
 * Builds default DispatchDeps with mocked prisma + sessionStore. Tests that
 * exercise the Prisma path use this as-is; tests that exercise the API path
 * (T3) override `api` + `writeViaApi`.
 */
function makeDeps() {
  const prisma = {
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
    prisma,
    sessionStore,
    PendingActionKind: { addTask: 'addTask', addTaskDraft: 'addTaskDraft', editTitle: 'editTitle', setDueDate: 'setDueDate' },
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

  it('routes v:addDraft:confirm to task.create + sessionStore.delete + editMessageText + fresh /my panel', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1', kind: 'addTaskDraft', payload: { draftTitle: 'купить молоко' },
    })) as any;

    await dispatchCallbackData(ctx, { kind: 'v:addDraft', action: 'confirm' }, deps as any);

    expect(deps.prisma.task.create).toHaveBeenCalled();
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

  it('t:edit creates editTitle session with panel context and sends prompt with old title in <code>', async () => {
    const ctx = makeCtx();
    (ctx.reply as any) = vi.fn(async () => ({ message_id: 555 }));
    const deps = makeDeps();
    deps.prisma.task.findUnique = vi.fn(async () => ({
      id: 'task-1', numId: 7, title: 'купить хлеб',
    })) as any;

    await dispatchCallbackData(ctx, { kind: 't:edit', taskNumId: 7, mode: 'done', page: 2 }, deps as any);

    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'editTitle',
      {
        panelMode: 'done',
        panelPage: 2,
        panelMessageId: 123,
        promptMessageId: 555,
      },
      { taskNumId: undefined, prismaTaskId: 'task-1' },
    );

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[0]).toContain('<code>купить хлеб</code>');
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([[{ text: '❌ Отмена', callback_data: 'v:cancel' }]]);
  });

  it('t:edit HTML-escapes the old title to prevent injection', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.task.findUnique = vi.fn(async () => ({
      id: 'task-1', numId: 1, title: '<script>alert(1)</script>',
    })) as any;

    await dispatchCallbackData(ctx, { kind: 't:edit', taskNumId: 1, mode: 'my', page: 0 }, deps as any);

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[0]).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(replyArgs[0]).not.toContain('<script>');
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

  it('t:setDue creates setDueDate session and sends prompt without clear button when no current dueAt', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.task.findUnique = vi.fn(async () => ({
      id: 'task-1', numId: 7, title: 'купить хлеб', dueAt: null, dueHasTime: false,
    })) as any;

    await dispatchCallbackData(ctx, { kind: 't:setDue', taskNumId: 7, mode: 'my', page: 1 }, deps as any);

    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'setDueDate',
      {
        panelMode: 'my',
        panelPage: 1,
        panelMessageId: 123,
        promptMessageId: 555,
      },
      { taskNumId: undefined, prismaTaskId: 'task-1' },
    );

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([
      [{ text: '❌ Отмена', callback_data: 'v:cancel' }],
    ]);
  });

  it('t:setDue includes clear button when dueAt is set', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.prisma.task.findUnique = vi.fn(async () => ({
      id: 'task-1',
      numId: 7,
      title: 'купить хлеб',
      dueAt: new Date('2026-04-30T15:00:00Z'),
      dueHasTime: true,
    })) as any;

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
});

// ─────────────────────────────────────────────────────────────────────────────
// WRITE_VIA_API=true paths (P4 cutover)
//
// These tests verify the dispatcher routes task WRITES through the @orbit/api
// client when the bot is configured for P4 cutover. Session reads/writes
// stay on the sessionStore abstraction in both cases — the dispatcher doesn't
// branch session ops directly.
// ─────────────────────────────────────────────────────────────────────────────

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

describe('callback-dispatcher routing — WRITE_VIA_API=true', () => {
  it('t:done routes to api.updateTask with status=done and skips prisma.task.update', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();

    await dispatchCallbackData(
      ctx,
      { kind: 't:done', taskNumId: 7, mode: 'my', page: 2 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(api._view.updateTask).toHaveBeenCalledWith(7, { status: 'done' }, expect.any(String));
    expect(deps.prisma.task.update).not.toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 2, 123);
  });

  it('t:reopen routes to api.updateTask with status=open and skips prisma.task.update', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();

    await dispatchCallbackData(
      ctx,
      { kind: 't:reopen', taskNumId: 7, mode: 'done', page: 0 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(api._view.updateTask).toHaveBeenCalledWith(7, { status: 'open' }, expect.any(String));
    expect(deps.prisma.task.update).not.toHaveBeenCalled();
  });

  it('t:done surfaces "unavailable" message on API error (no Prisma fallback)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();
    api._view.updateTask = vi.fn(async () => { throw new Error('boom'); });

    await dispatchCallbackData(
      ctx,
      { kind: 't:done', taskNumId: 7, mode: 'my', page: 0 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(deps.prisma.task.update).not.toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenCalled();
    const editArgs = (ctx.api.editMessageText as any).mock.calls[0];
    expect(String(editArgs[2])).toContain('временно недоступен');
    expect(deps.showList).not.toHaveBeenCalled();
  });

  it('t:delyes routes to api.deleteTask and skips prisma.task.delete', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();

    await dispatchCallbackData(
      ctx,
      { kind: 't:delyes', taskNumId: 5, mode: 'my', page: 0 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(api._view.deleteTask).toHaveBeenCalledWith(5, expect.any(String));
    expect(deps.prisma.task.delete).not.toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
  });

  it('t:edit reads task via api.getTask and links the session by taskNumId (no prismaTaskId)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();

    await dispatchCallbackData(
      ctx,
      { kind: 't:edit', taskNumId: 7, mode: 'my', page: 1 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(api._view.getTask).toHaveBeenCalledWith(7);
    expect(deps.prisma.task.findUnique).not.toHaveBeenCalled();
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'editTitle',
      expect.objectContaining({
        panelMode: 'my',
        panelPage: 1,
        panelMessageId: 123,
        promptMessageId: 555,
      }),
      { taskNumId: 7, prismaTaskId: undefined },
    );
  });

  it('t:setDue reads task via api.getTask and links the session by taskNumId', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();
    // Pretend the task has a due date so we expect the "🗑 Очистить" button.
    api._view.getTask = vi.fn(async () => ({
      numId: 7,
      title: 'x',
      status: 'open',
      dueAt: '2026-04-30T15:00:00.000Z',
      dueHasTime: true,
    })) as any;

    await dispatchCallbackData(
      ctx,
      { kind: 't:setDue', taskNumId: 7, mode: 'my', page: 0 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(api._view.getTask).toHaveBeenCalledWith(7);
    expect(deps.prisma.task.findUnique).not.toHaveBeenCalled();
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'setDueDate',
      expect.objectContaining({ panelMode: 'my', panelPage: 0, panelMessageId: 123 }),
      { taskNumId: 7, prismaTaskId: undefined },
    );

    const replyArgs = (ctx.reply as any).mock.calls[0];
    expect(replyArgs[1].reply_markup.inline_keyboard).toEqual([
      [{ text: '🗑 Очистить', callback_data: 'v:clearDue' }],
      [{ text: '❌ Отмена', callback_data: 'v:cancel' }],
    ]);
  });

  it('t:edit silently returns to the list when api.getTask returns null (task gone)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();
    api._view.getTask = vi.fn(async () => null);

    await dispatchCallbackData(
      ctx,
      { kind: 't:edit', taskNumId: 99, mode: 'my', page: 0 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(deps.sessionStore.create).not.toHaveBeenCalled();
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0, 123);
  });

  it('v:addDraft:confirm creates the task via api.createTask and deletes the draft session', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1', kind: 'addTaskDraft', payload: { draftTitle: 'купить молоко' },
    })) as any;

    await dispatchCallbackData(
      ctx,
      { kind: 'v:addDraft', action: 'confirm' },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(api._view.createTask).toHaveBeenCalledWith({ title: 'купить молоко' }, expect.any(String));
    expect(deps.prisma.task.create).not.toHaveBeenCalled();
    expect(deps.sessionStore.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'p1',
    );
    expect(deps.showList).toHaveBeenCalledWith(ctx, 'my', 0);
  });

  it('v:add creates a session even in API mode (sessionStore is the single switch)', async () => {
    // The dispatcher does not branch session ops on writeViaApi — sessionStore
    // itself is API-backed at runtime. This test pins down that the dispatcher
    // doesn't accidentally call any API client method for the session creation.
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();

    await dispatchCallbackData(
      ctx,
      { kind: 'v:add', mode: 'my', page: 0 },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(deps.sessionStore.deleteAll).toHaveBeenCalled();
    expect(deps.sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'addTask',
      { panelMode: 'my', panelPage: 0, panelMessageId: 123 },
    );
    // The API client should NOT have been touched — session ops go through
    // sessionStore, not directly via deps.api.
    expect(api._view.createTask).not.toHaveBeenCalled();
    expect(api.asViewer).not.toHaveBeenCalled();
  });

  it('v:clearDue commits via sessionStore on the API path too (single code path)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const api = createFakeApi();
    deps.sessionStore.findLatestOfKind = vi.fn(async () => ({
      id: 'p1',
      kind: 'setDueDate',
      payload: { panelMode: 'my', panelPage: 0, panelMessageId: 999, promptMessageId: 777 },
    })) as any;

    await dispatchCallbackData(
      ctx,
      { kind: 'v:clearDue' },
      { ...deps, api, writeViaApi: true } as any,
    );

    expect(deps.sessionStore.commit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'me' }),
      'p1',
      { dueAt: null, dueHasTime: false },
    );
    // Dispatcher must not bypass sessionStore on the API path.
    expect(api._view.updateTask).not.toHaveBeenCalled();
  });
});
