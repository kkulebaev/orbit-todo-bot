import { describe, expect, it } from 'vitest';

import { executeRm } from './rm.js';
import { makeFakeApi } from '../test-helpers/fake-api.js';
import { EXIT_NOT_FOUND, EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

describe('rm', () => {
  // AC-P3-4
  it('without --yes exits 1 and does not call deleteTask', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeRm('7', {}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(1);
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(l.errLines.join('\n')).toContain('refusing to delete without --yes');
  });

  it('with --yes calls deleteTask and exits 0', async () => {
    const api = makeFakeApi();
    api.deleteTask.mockResolvedValueOnce(true);
    const l = logs();
    const code = await executeRm('7', { yes: true }, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    expect(api.deleteTask).toHaveBeenCalledWith(7, expect.any(String));
  });

  it('returns NOT_FOUND (3) when deleteTask returns false', async () => {
    const api = makeFakeApi();
    api.deleteTask.mockResolvedValueOnce(false);
    const l = logs();
    const code = await executeRm('99', { yes: true }, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  // AC-P3-9
  it('forwards --idempotency-key verbatim', async () => {
    const api = makeFakeApi();
    api.deleteTask.mockResolvedValueOnce(true);
    await executeRm(
      '7',
      { yes: true, idempotencyKey: 'rm-key' },
      { client: api, log: () => {}, err: () => {} },
    );
    expect(api.deleteTask.mock.calls[0][1]).toBe('rm-key');
  });
});
