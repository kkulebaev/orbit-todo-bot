import { describe, expect, it } from 'vitest';

import { executeDone } from './done.js';
import { executeReopen } from './reopen.js';
import { makeFakeApi, makeTask } from '../test-helpers/fake-api.js';
import { EXIT_NOT_FOUND, EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

const now = new Date('2026-05-16T06:00:00.000Z');

describe('done / reopen', () => {
  // AC-P3-2
  it('done sets status to "done"', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(makeTask({ status: 'done' }));
    const l = logs();
    const code = await executeDone('7', {}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    expect(api.updateTask).toHaveBeenCalledWith(7, { status: 'done' }, expect.any(String));
  });

  it('reopen sets status to "open"', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(makeTask({ status: 'open' }));
    const l = logs();
    const code = await executeReopen('7', {}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    expect(api.updateTask).toHaveBeenCalledWith(7, { status: 'open' }, expect.any(String));
  });

  it('returns NOT_FOUND (3) when the task does not exist', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(null);
    const l = logs();
    const code = await executeDone('99', {}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  // AC-P3-9
  it('forwards --idempotency-key verbatim', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(makeTask({ status: 'done' }));
    await executeDone(
      '7',
      { idempotencyKey: 'custom-key' },
      { client: api, log: () => {}, err: () => {}, now },
    );
    expect(api.updateTask.mock.calls[0][2]).toBe('custom-key');
  });
});
