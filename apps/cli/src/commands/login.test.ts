import { describe, expect, it, vi } from 'vitest';

import { executeLogin } from './login.js';
import { EXIT_AUTH, EXIT_GENERIC, EXIT_NETWORK, EXIT_OK } from '../exit-codes.js';

function makeLogs() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    log: (m: string) => out.push(m),
    err: (m: string) => err.push(m),
    out,
    errLines: err,
  };
}

const validPat = 'orbit_pat_' + 'a'.repeat(43);

describe('login', () => {
  it('rejects a malformed token without making any HTTP call (exit 1)', async () => {
    const fetchImpl = vi.fn();
    const save = vi.fn();
    const logs = makeLogs();
    const code = await executeLogin(
      { token: 'not-a-pat' },
      { fetchImpl, saveConfig: save, log: logs.log, err: logs.err },
    );
    expect(code).toBe(EXIT_GENERIC);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(logs.errLines.join('\n')).toContain('PAT format');
  });

  // AC-P2-8: wrong PAT → exit 2.
  it('exits 2 on 401 from the server (wrong PAT)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":{"code":"unauthorized","message":"nope"}}', {
        status: 401,
      }),
    );
    const save = vi.fn();
    const logs = makeLogs();
    const code = await executeLogin(
      { token: validPat },
      { fetchImpl: fetchImpl as unknown as typeof fetch, saveConfig: save, log: logs.log, err: logs.err },
    );
    expect(code).toBe(EXIT_AUTH);
    expect(save).not.toHaveBeenCalled();
  });

  it('exits 4 on network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const save = vi.fn();
    const logs = makeLogs();
    const code = await executeLogin(
      { token: validPat },
      { fetchImpl: fetchImpl as unknown as typeof fetch, saveConfig: save, log: logs.log, err: logs.err },
    );
    expect(code).toBe(EXIT_NETWORK);
    expect(save).not.toHaveBeenCalled();
  });

  it('persists config on success and prints user label', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          numId: 5,
          telegramUserId: '42',
          username: 'alice',
          firstName: 'Alice',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const save = vi.fn().mockResolvedValue(undefined);
    const logs = makeLogs();
    const code = await executeLogin(
      { token: validPat, baseUrl: 'https://api.example.com' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, saveConfig: save, log: logs.log, err: logs.err },
    );
    expect(code).toBe(EXIT_OK);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      baseUrl: 'https://api.example.com',
      token: validPat,
      userLabel: 'alice',
    });
    expect(logs.out.join('\n')).toContain('Logged in as alice');
  });

  // AC-P1-7: token plaintext never appears in stdout / stderr.
  it('does not log the token plaintext on any path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":{"code":"unauthorized"}}', { status: 401 }),
    );
    const save = vi.fn();
    const logs = makeLogs();
    await executeLogin(
      { token: validPat },
      { fetchImpl: fetchImpl as unknown as typeof fetch, saveConfig: save, log: logs.log, err: logs.err },
    );
    const combined = [...logs.out, ...logs.errLines].join('\n');
    expect(combined).not.toContain(validPat);
    expect(combined).not.toMatch(/orbit_pat_/);
  });
});
