import { describe, expect, it, vi } from 'vitest';

import { UserDtoSchema } from '@orbit/contracts';

import { executeWhoami } from './whoami.js';
import { makeFakeApi } from '../test-helpers/fake-api.js';
import { EXIT_AUTH, EXIT_OK } from '../exit-codes.js';
import { ApiClientError } from '@orbit/api-client';

// Mock the version module so tests can control CONTRACTS_VERSION independently
// of whatever the actual packages/contracts/package.json says.
vi.mock('../version.js', () => ({
  CLI_VERSION: '0.1.0',
  CONTRACTS_VERSION: '0.1.0',
}));

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (m: string) => out.push(m), err: (m: string) => err.push(m), out, errLines: err };
}

describe('whoami', () => {
  // AC-P1-3: human format
  it('prints UserDto in human format', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeWhoami({}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    const joined = l.out.join('\n');
    expect(joined).toContain('numId:');
    expect(joined).toContain('Telegram ID:');
  });

  // AC-P1-3 / AC-P3-5: --json validates against UserDtoSchema.
  it('emits UserDto-shaped JSON when --json is set', async () => {
    const api = makeFakeApi();
    const l = logs();
    const code = await executeWhoami({ json: true }, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    // Exactly one stdout line — the JSON.
    expect(l.out).toHaveLength(1);
    const parsed = UserDtoSchema.safeParse(JSON.parse(l.out[0]));
    expect(parsed.success).toBe(true);
  });

  it('returns AUTH (2) on 401 from server', async () => {
    const api = makeFakeApi();
    api.upsertMe.mockRejectedValueOnce(new ApiClientError(401, {}));
    const l = logs();
    const code = await executeWhoami({}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_AUTH);
  });

  // AC-P2-29: warn on major contractsVersion mismatch.
  // The CLI's built-time CONTRACTS_VERSION is mocked to '0.1.0'; server reports
  // '99.0.0' (different major) → warning fires.
  it('warns when the server reports a different major contractsVersion', async () => {
    const api = makeFakeApi();
    api.getVersion.mockResolvedValueOnce({
      contractsVersion: '99.0.0',
      commit: 'abc',
      builtAt: '2026-05-16T00:00:00.000Z',
    });
    const l = logs();
    const code = await executeWhoami({}, { client: api, log: l.log, err: l.err });
    expect(code).toBe(EXIT_OK);
    // Warning mentions both the CLI built-against version and the server version.
    expect(l.out.join('\n')).toMatch(/@orbit\/contracts/);
    expect(l.out.join('\n')).toMatch(/99\.0\.0/);
  });

  // AC-P2-29: no warning when major versions match.
  it('does not warn when major versions match', async () => {
    const api = makeFakeApi();
    // Default fake reports 0.1.0 which matches the mocked CONTRACTS_VERSION 0.1.0.
    const l = logs();
    await executeWhoami({}, { client: api, log: l.log, err: l.err });
    expect(l.out.join('\n')).not.toMatch(/@orbit\/contracts/);
  });
});
