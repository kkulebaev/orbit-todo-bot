import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';

import { makeFakeApi, makeTask } from '../test-helpers/fake-api.js';
import { App } from './App.js';

const NOW = new Date('2026-05-16T06:00:00.000Z');
const KEY = (): string => 'idem-key-1';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 500,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const f = lastFrame() ?? '';
    if (predicate(f)) return f;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`waitForFrame timeout. Last frame:\n${lastFrame() ?? '(empty)'}`);
}

const ARROW_UP = '[A';
const ARROW_DOWN = '[B';
const ARROW_LEFT = '[D';
const ARROW_RIGHT = '[C';
const ENTER = '\r';
const ESC = '';

function eight(prefix: string, status: 'open' | 'done' = 'open') {
  return Array.from({ length: 8 }, (_, i) =>
    makeTask({ numId: i + 1, title: `${prefix}${i + 1}`, status }),
  );
}

describe('TUI App', () => {
  it('renders the page-0 list with cursor on the first row', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 3,
      items: [
        makeTask({ numId: 1, title: 'first' }),
        makeTask({ numId: 2, title: 'second' }),
        makeTask({ numId: 3, title: 'third' }),
      ],
    });

    const { lastFrame } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('first');
    expect(frame).toContain('second');
    expect(frame).toContain('third');
    expect(frame).toMatch(/>\s+ +#1\s+first/);
  });

  it('arrow-down moves the cursor to the next task', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 2,
      items: [
        makeTask({ numId: 1, title: 'a' }),
        makeTask({ numId: 2, title: 'b' }),
      ],
    });

    const { lastFrame, stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await waitForFrame(lastFrame, (f) => f.includes('#2'));
    stdin.write(ARROW_DOWN);
    await waitForFrame(lastFrame, (f) => />\s+ +#2\s+b/.test(f));
  });

  it('arrow-up clamps cursor at 0', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 2,
      items: [
        makeTask({ numId: 1, title: 'a' }),
        makeTask({ numId: 2, title: 'b' }),
      ],
    });

    const { lastFrame, stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    stdin.write(ARROW_UP);
    await flush();
    expect(lastFrame()!).toMatch(/>\s+ +#1\s+a/);
  });

  it('arrow-right advances to the next page and refetches', async () => {
    const api = makeFakeApi();
    api.listTasks
      .mockResolvedValueOnce({ page: 0, total: 10, items: eight('p0_') })
      .mockResolvedValueOnce({
        page: 1,
        total: 10,
        items: [makeTask({ numId: 9, title: 'p1_only' })],
      });

    const { lastFrame, stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await waitForFrame(lastFrame, (f) => f.includes('p0_1'));
    stdin.write(ARROW_RIGHT);
    await waitForFrame(lastFrame, (f) => f.includes('p1_only'));
    expect(api.listTasks).toHaveBeenNthCalledWith(2, { mode: 'my', page: 1 });
    expect(lastFrame()!).toContain('Страница 2 из 2');
  });

  it('arrow-right is a no-op on the last page', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 1,
      items: [makeTask({ numId: 1, title: 'only' })],
    });

    const { stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    stdin.write(ARROW_RIGHT);
    await flush();
    // Only the initial page-0 fetch.
    expect(api.listTasks).toHaveBeenCalledTimes(1);
  });

  it('"m" cycles the mode and refetches with the new mode', async () => {
    const api = makeFakeApi();
    api.listTasks
      .mockResolvedValueOnce({ page: 0, total: 1, items: [makeTask({ numId: 1 })] })
      .mockResolvedValueOnce({ page: 0, total: 0, items: [] });

    const { lastFrame, stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    stdin.write('m');
    await flush();
    await flush();
    expect(api.listTasks).toHaveBeenNthCalledWith(2, { mode: 'due-soon', page: 0 });
    expect(lastFrame()!).toContain('Orbit — скоро дедлайн');
  });

  it('"d" calls updateTask({status:"done"}) for the selected open task', async () => {
    const api = makeFakeApi();
    const task = makeTask({ numId: 7, title: 'finish me', status: 'open' });
    api.listTasks
      .mockResolvedValueOnce({ page: 0, total: 1, items: [task] })
      .mockResolvedValueOnce({ page: 0, total: 1, items: [{ ...task, status: 'done' }] });

    const { stdin, lastFrame } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await waitForFrame(lastFrame, (f) => f.includes('finish me'));
    stdin.write('d');
    await waitForFrame(lastFrame, (f) => f.includes('#7 закрыто'));
    expect(api.updateTask).toHaveBeenCalledWith(7, { status: 'done' }, 'idem-key-1');
  });

  it('"o" reopens a done task', async () => {
    const api = makeFakeApi();
    const task = makeTask({ numId: 5, title: 'redo', status: 'done' });
    api.listTasks
      .mockResolvedValueOnce({ page: 0, total: 1, items: [task] })
      .mockResolvedValueOnce({ page: 0, total: 1, items: [{ ...task, status: 'open' }] });

    const { stdin, lastFrame } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await waitForFrame(lastFrame, (f) => f.includes('redo'));
    stdin.write('o');
    await waitForFrame(lastFrame, (f) => f.includes('#5 переоткрыто'));
    expect(api.updateTask).toHaveBeenCalledWith(5, { status: 'open' }, 'idem-key-1');
  });

  it('"d" is a no-op on already-done tasks', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 1,
      items: [makeTask({ numId: 1, status: 'done' })],
    });
    const { stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    stdin.write('d');
    await flush();
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('enter opens the detail view; esc returns to the list', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 1,
      items: [makeTask({ numId: 42, title: 'detail-me', dueAt: null })],
    });
    const { lastFrame, stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await waitForFrame(lastFrame, (f) => f.includes('detail-me'));
    stdin.write(ENTER);
    const detail = await waitForFrame(lastFrame, (f) => f.includes('Карточка задачи'));
    expect(detail).toContain('#42');
    stdin.write(ESC);
    await waitForFrame(lastFrame, (f) => f.includes('Страница 1 из 1'));
  });

  it('renders "Нет задач." on an empty list', async () => {
    const api = makeFakeApi();
    const { lastFrame } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    expect(lastFrame()!).toContain('Нет задач.');
  });

  it('renders an error frame when listTasks rejects', async () => {
    const api = makeFakeApi();
    api.listTasks.mockRejectedValueOnce(new Error('boom'));
    const { lastFrame } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    expect(lastFrame()!).toContain('Ошибка: boom');
  });

  it('arrow-left on first page is a no-op (does not refetch)', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 1,
      items: [makeTask({ numId: 1, title: 'a' })],
    });
    const { stdin } = render(
      <App client={api} idempotencyKey={KEY} now={NOW} exitOnQuit={false} />,
    );
    await flush();
    stdin.write(ARROW_LEFT);
    await flush();
    expect(api.listTasks).toHaveBeenCalledTimes(1);
  });
});
