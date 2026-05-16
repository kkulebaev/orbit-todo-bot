import { describe, expect, it } from 'vitest';

import { executeEdit } from './edit.js';
import { makeFakeApi, makeTask } from '../test-helpers/fake-api.js';
import { EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

const now = new Date('2026-05-16T06:00:00.000Z');

describe('edit', () => {
  // AC-P3-3
  it('--no-due clears dueAt and dueHasTime', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(makeTask({ dueAt: null, dueHasTime: false }));
    const l = logs();
    const code = await executeEdit('7', { noDue: true }, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(EXIT_OK);
    expect(api.updateTask).toHaveBeenCalledWith(
      7,
      { dueAt: null, dueHasTime: false },
      expect.any(String),
    );
  });

  it('--title updates the title', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(makeTask({ title: 'new title' }));
    const l = logs();
    await executeEdit('7', { title: 'new title' }, { client: api, log: l.log, err: l.err, now });
    expect(api.updateTask).toHaveBeenCalledWith(
      7,
      { title: 'new title' },
      expect.any(String),
    );
  });

  it('--due updates dueAt + dueHasTime', async () => {
    const api = makeFakeApi();
    api.updateTask.mockResolvedValueOnce(makeTask());
    await executeEdit(
      '7',
      { due: '16.05.2026 20:00' },
      { client: api, log: () => {}, err: () => {}, now },
    );
    const call = api.updateTask.mock.calls[0][1];
    expect(call.dueAt).toBeDefined();
    expect(call.dueHasTime).toBe(true);
  });

  it('rejects --due and --no-due together with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeEdit(
      '7',
      { due: '16.05.2026', noDue: true },
      { client: api, log: l.log, err: l.err, now },
    );
    expect(code).toBe(1);
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(l.errLines.join('\n')).toMatch(/mutually exclusive/);
  });

  it('rejects an empty edit (no flags) with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeEdit('7', {}, { client: api, log: l.log, err: l.err, now });
    expect(code).toBe(1);
    expect(api.updateTask).not.toHaveBeenCalled();
  });
});
