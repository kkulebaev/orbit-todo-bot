import { describe, expect, it, vi } from 'vitest';

import { executeLogout } from './logout.js';
import { ConfigError } from '../config.js';
import { EXIT_OK } from '../exit-codes.js';

function logs() {
  const out: string[] = [];
  return { log: (m: string) => out.push(m), out };
}

describe('logout', () => {
  it('prints "Already logged out." when no config exists', async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new ConfigError('NO_CONFIG', 'nope', 2));
    const clear = vi.fn();
    const l = logs();
    const code = await executeLogout({ loadConfig: load, clearConfig: clear, log: l.log });
    expect(code).toBe(EXIT_OK);
    expect(l.out).toContain('Already logged out.');
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears config when present and exits 0', async () => {
    const load = vi.fn().mockResolvedValue({ baseUrl: 'x', token: 'y' });
    const clear = vi.fn().mockResolvedValue(undefined);
    const l = logs();
    const code = await executeLogout({ loadConfig: load, clearConfig: clear, log: l.log });
    expect(code).toBe(EXIT_OK);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(l.out.join('\n')).toContain('Logged out.');
  });
});
