import { describe, expect, it, vi } from 'vitest';

import { TaskDtoSchema } from '@orbit/contracts';

import { executeAdd } from './add.js';
import { makeFakeApi, makeTask } from '../test-helpers/fake-api.js';
import { EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

const now = new Date('2026-05-16T06:00:00.000Z');

describe('add', () => {
  // AC-P3-1
  it('creates a task with a multi-word title and renders russian-relative due', async () => {
    const api = makeFakeApi();
    api.createTask.mockResolvedValueOnce(
      makeTask({
        numId: 9,
        title: 'buy milk and bread',
        dueAt: '2026-05-16T15:00:00.000Z',
        dueHasTime: true,
      }),
    );
    const l = logs();
    const code = await executeAdd(
      ['buy', 'milk', 'and', 'bread'],
      { due: '16.05.2026 18:00' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(EXIT_OK);
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'buy milk and bread',
        dueAt: expect.any(String),
        dueHasTime: true,
      }),
      expect.any(String),
    );
    expect(l.out.join('\n')).toContain('сегодня в 18:00');
  });

  // AC-P3-5: --json shape validates.
  it('emits TaskDto-shaped JSON for --json', async () => {
    const api = makeFakeApi();
    api.createTask.mockResolvedValueOnce(makeTask({ numId: 7, title: 'x' }));
    const l = logs();
    const code = await executeAdd(
      ['x'],
      { json: true },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(EXIT_OK);
    const parsed = TaskDtoSchema.safeParse(JSON.parse(l.out[0]));
    expect(parsed.success).toBe(true);
  });

  // AC-P3-6: default Idempotency-Key is a randomUUID per invocation.
  it('uses a fresh randomUUID() Idempotency-Key by default', async () => {
    const api = makeFakeApi();
    api.createTask.mockResolvedValue(makeTask());
    await executeAdd(['x'], {}, { client: api, log: () => {}, err: () => {}, now });
    await executeAdd(['x'], {}, { client: api, log: () => {}, err: () => {}, now });
    const keyA = api.createTask.mock.calls[0][1];
    const keyB = api.createTask.mock.calls[1][1];
    expect(keyA).not.toBe(keyB);
    expect(keyA).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // AC-P3-9: explicit --idempotency-key forwarded verbatim.
  it('forwards --idempotency-key verbatim', async () => {
    const api = makeFakeApi();
    api.createTask.mockResolvedValue(makeTask());
    await executeAdd(
      ['x'],
      { idempotencyKey: 'my-key-123' },
      { client: api, log: () => {}, err: () => {}, now },
    );
    expect(api.createTask.mock.calls[0][1]).toBe('my-key-123');
  });

  it('rejects an empty title with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeAdd([''], {}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(1);
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('rejects an unparseable --due with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeAdd(
      ['x'],
      { due: 'not-a-date' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(1);
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('rejects a --due in the past with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeAdd(
      ['x'],
      { due: '01.01.2020' },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(1);
    expect(api.createTask).not.toHaveBeenCalled();
  });
});
