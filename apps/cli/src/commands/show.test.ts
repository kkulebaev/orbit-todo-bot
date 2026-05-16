import { describe, expect, it } from 'vitest';

import { TaskDtoSchema } from '@orbit/contracts';

import { executeShow } from './show.js';
import { makeFakeApi, makeTask } from '../test-helpers/fake-api.js';
import { EXIT_NOT_FOUND, EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

describe('show', () => {
  // AC-P1-5: missing task → exit 3.
  it('returns NOT_FOUND (3) when the api-client returns null (task missing)', async () => {
    const api = makeFakeApi();
    api.getTask.mockResolvedValueOnce(null);
    const l = logs();
    const code = await executeShow('99', {}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_NOT_FOUND);
    expect(l.errLines.join('\n')).toMatch(/not found/);
  });

  // AC-P1-5 (cross-owner): api-client maps cross-owner 404 to null (privacy
  // convention — server returns 404 for both missing and unauthorized tasks).
  it('returns NOT_FOUND (3) when the api-client returns null (cross-owner / privacy 404)', async () => {
    const api = makeFakeApi();
    // Simulate a task owned by another user: server returns 404, client maps to null.
    api.getTask.mockResolvedValueOnce(null);
    const l = logs();
    const code = await executeShow('99', {}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_NOT_FOUND);
    expect(l.errLines.join('\n')).toMatch(/not found/);
  });

  // AC-P3-5
  it('emits TaskDto-shaped JSON for --json', async () => {
    const api = makeFakeApi();
    api.getTask.mockResolvedValueOnce(makeTask({ numId: 7 }));
    const l = logs();
    const code = await executeShow('7', { json: true }, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    const parsed = TaskDtoSchema.safeParse(JSON.parse(l.out[0]));
    expect(parsed.success).toBe(true);
  });

  it('rejects a non-integer numId with exit 1', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeShow('abc', {}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(1);
    expect(api.getTask).not.toHaveBeenCalled();
  });
});
