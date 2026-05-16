import { describe, expect, it } from 'vitest';

import { TaskListResponseSchema } from '@orbit/contracts';
import { ApiClientError, ApiNetworkError } from '@orbit/api-client';

import { executeList } from './list.js';
import { makeFakeApi, makeTask } from '../test-helpers/fake-api.js';
import { EXIT_NETWORK, EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

const now = new Date('2026-05-16T06:00:00.000Z');

describe('list', () => {
  // AC-P1-9
  it('prints "No tasks." on an empty list (human mode)', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeList({}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    expect(l.out).toContain('No tasks.');
  });

  // AC-P1-9 (--json variant)
  it('emits a TaskListResponse-shaped JSON when --json on empty', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeList({ json: true }, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    const parsed = TaskListResponseSchema.safeParse(JSON.parse(l.out[0]));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items).toEqual([]);
  });

  // AC-P1-4: russian-relative rendering in the table output.
  it('renders russian-relative dates in the Due column', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 4,
      items: [
        makeTask({ numId: 1, title: 't1', dueAt: '2026-05-16T15:00:00.000Z', dueHasTime: true }),
        makeTask({ numId: 2, title: 't2', dueAt: '2026-05-16T21:00:00.000Z', dueHasTime: false }),
        makeTask({ numId: 3, title: 't3', dueAt: '2026-05-18T21:00:00.000Z', dueHasTime: false }),
        makeTask({ numId: 4, title: 't4', dueAt: '2026-05-14T21:00:00.000Z', dueHasTime: false }),
      ],
    });
    const l = logs();
    const code = await executeList({}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    const stdout = l.out.join('\n');
    expect(stdout).toContain('сегодня в 18:00');
    expect(stdout).toContain('завтра');
    expect(stdout).toContain('через 3 дня');
    expect(stdout).toContain('15 мая'); // overdue
    expect(stdout).toContain('⚠️'); // overdue prefix
  });

  // AC-P1-6: network errors → exit 4.
  it('returns NETWORK (4) on ApiNetworkError', async () => {
    const api = makeFakeApi();
    api.listTasks.mockRejectedValueOnce(new ApiNetworkError(new Error('timeout')));
    const l = logs();
    const code = await executeList({}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_NETWORK);
  });

  it('passes --mode and --page to the api-client', async () => {
    const api = makeFakeApi();
    const l = logs();
    await executeList({ mode: 'done', page: '2' }, { client: api, log: l.log, err: l.err, now });
    expect(api.listTasks).toHaveBeenCalledWith({ mode: 'done', page: 2 });
  });

  it('rejects an unknown --mode with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeList(
      { mode: 'bogus' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(1);
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it('forwards 5xx as GENERIC (1)', async () => {
    const api = makeFakeApi();
    api.listTasks.mockRejectedValueOnce(new ApiClientError(500, {}));
    const l = logs();
    const code = await executeList({}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(1);
  });

  it('appends pager footer with "next page" hint when more pages exist', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 20,
      items: [makeTask({ numId: 1, title: 't1' })],
    });
    const l = logs();
    const code = await executeList({}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    const stdout = l.out.join('\n');
    expect(stdout).toContain('Страница 1 из 3');
    expect(stdout).toContain('всего 20');
    expect(stdout).toContain('далее: orbit list --page 1');
  });

  it('omits "далее" hint on the last page', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 2,
      total: 20,
      items: [makeTask({ numId: 1, title: 't1' })],
    });
    const l = logs();
    const code = await executeList(
      { page: '2' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(EXIT_OK);
    const stdout = l.out.join('\n');
    expect(stdout).toContain('Страница 3 из 3');
    expect(stdout).not.toContain('далее:');
  });

  it('includes --mode flag in the pager hint when mode is not "my"', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 20,
      items: [makeTask({ numId: 1, title: 't1' })],
    });
    const l = logs();
    await executeList(
      { mode: 'done' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(l.out.join('\n')).toContain('orbit list --mode done --page 1');
  });

  it('does not print pager on empty results', async () => {
    const api = makeFakeApi();
    const l = logs();
    await executeList({}, { client: api, log: l.log, err: l.err, now });
    expect(l.out.join('\n')).not.toContain('Страница');
  });

  it('does not print pager in --json mode', async () => {
    const api = makeFakeApi();
    api.listTasks.mockResolvedValueOnce({
      page: 0,
      total: 20,
      items: [makeTask({ numId: 1, title: 't1' })],
    });
    const l = logs();
    await executeList(
      { json: true },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(l.out).toHaveLength(1);
    expect(l.out[0]).not.toContain('Страница');
  });

  it('--all fetches every page and merges items', async () => {
    const api = makeFakeApi();
    api.listTasks
      .mockResolvedValueOnce({
        page: 0,
        total: 20,
        items: Array.from({ length: 8 }, (_, i) => makeTask({ numId: i + 1, title: `t${i + 1}` })),
      })
      .mockResolvedValueOnce({
        page: 1,
        total: 20,
        items: Array.from({ length: 8 }, (_, i) => makeTask({ numId: i + 9, title: `t${i + 9}` })),
      })
      .mockResolvedValueOnce({
        page: 2,
        total: 20,
        items: Array.from({ length: 4 }, (_, i) => makeTask({ numId: i + 17, title: `t${i + 17}` })),
      });
    const l = logs();
    const code = await executeList(
      { all: true },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(EXIT_OK);
    expect(api.listTasks).toHaveBeenCalledTimes(3);
    expect(api.listTasks).toHaveBeenNthCalledWith(1, { mode: 'my', page: 0 });
    expect(api.listTasks).toHaveBeenNthCalledWith(2, { mode: 'my', page: 1 });
    expect(api.listTasks).toHaveBeenNthCalledWith(3, { mode: 'my', page: 2 });
    const stdout = l.out.join('\n');
    expect(stdout).toContain('t1');
    expect(stdout).toContain('t20');
    // --all is supposed to be self-contained, no pager footer.
    expect(stdout).not.toContain('Страница');
  });

  it('--all emits TaskListResponse-shaped JSON with all items', async () => {
    const api = makeFakeApi();
    api.listTasks
      .mockResolvedValueOnce({
        page: 0,
        total: 9,
        items: Array.from({ length: 8 }, (_, i) => makeTask({ numId: i + 1, title: `t${i + 1}` })),
      })
      .mockResolvedValueOnce({
        page: 1,
        total: 9,
        items: [makeTask({ numId: 9, title: 't9' })],
      });
    const l = logs();
    const code = await executeList(
      { all: true, json: true },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(EXIT_OK);
    expect(l.out).toHaveLength(1);
    const parsed = TaskListResponseSchema.safeParse(JSON.parse(l.out[0]));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(9);
      expect(parsed.data.total).toBe(9);
    }
  });

  it('rejects --all combined with --page (exit 1)', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeList(
      { all: true, page: '1' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(1);
    expect(api.listTasks).not.toHaveBeenCalled();
  });
});
