import { describe, expect, it } from 'vitest';

import { PersonalAccessTokenDtoSchema } from '@orbit/contracts';
import { z } from 'zod';

import { executeTokensList, executeTokensRevoke } from './tokens.js';
import { makeFakeApi } from '../test-helpers/fake-api.js';
import { EXIT_NOT_FOUND, EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

describe('tokens list', () => {
  // AC-P3-8
  it('prints fields per token in table form', async () => {
    const api = makeFakeApi();
    api.listCliTokens.mockResolvedValueOnce([
      {
        id: '11111111-1111-1111-1111-111111111111',
        label: 'laptop',
        createdAt: '2026-05-01T10:00:00.000Z',
        lastUsedAt: '2026-05-15T10:00:00.000Z',
        expiresAt: null,
      },
    ]);
    const l = logs();
    const code = await executeTokensList({}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    const stdout = l.out.join('\n');
    expect(stdout).toContain('laptop');
    expect(stdout).toContain('2026-05-01T10:00:00.000Z');
    expect(stdout).toContain('11111111-1111-1111-1111-111111111111');
  });

  // AC-P3-5: --json validates against schema
  it('--json output validates against PersonalAccessTokenDto[]', async () => {
    const api = makeFakeApi();
    api.listCliTokens.mockResolvedValueOnce([
      {
        id: '11111111-1111-1111-1111-111111111111',
        label: 'laptop',
        createdAt: '2026-05-01T10:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
      },
    ]);
    const l = logs();
    const code = await executeTokensList(
      { json: true },
      { client: api, log: l.log, err: l.err },
    );
    expect(code).toBe(EXIT_OK);
    const parsed = z.array(PersonalAccessTokenDtoSchema).safeParse(JSON.parse(l.out[0]));
    expect(parsed.success).toBe(true);
  });

  it('prints "No tokens." on empty list (human)', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeTokensList({}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    expect(l.out).toContain('No tokens.');
  });
});

describe('tokens revoke', () => {
  // AC-P3-8 / AC-P3-9
  it('without --yes exits 1 and does not call revokeCliToken', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeTokensRevoke(
      'abc',
      {},
      { client: api, log: l.log, err: l.err },
    );
    expect(code).toBe(1);
    expect(api.revokeCliToken).not.toHaveBeenCalled();
  });

  it('with --yes revokes and exits 0', async () => {
    const api = makeFakeApi();
    api.revokeCliToken.mockResolvedValueOnce(true);
    const l = logs();
    const code = await executeTokensRevoke(
      'abc',
      { yes: true },
      { client: api, log: l.log, err: l.err },
    );
    expect(code).toBe(EXIT_OK);
    expect(api.revokeCliToken).toHaveBeenCalledWith('abc', expect.any(String));
  });

  it('returns NOT_FOUND (3) when revokeCliToken returns false', async () => {
    const api = makeFakeApi();
    api.revokeCliToken.mockResolvedValueOnce(false);
    const l = logs();
    const code = await executeTokensRevoke(
      'missing',
      { yes: true },
      { client: api, log: l.log, err: l.err },
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  // AC-P3-9
  it('forwards --idempotency-key verbatim', async () => {
    const api = makeFakeApi();
    api.revokeCliToken.mockResolvedValueOnce(true);
    await executeTokensRevoke(
      'abc',
      { yes: true, idempotencyKey: 'tok-key' },
      { client: api, log: () => {}, err: () => {} },
    );
    expect(api.revokeCliToken.mock.calls[0][1]).toBe('tok-key');
  });
});
