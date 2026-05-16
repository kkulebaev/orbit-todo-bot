import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { EXIT_AUTH } from './exit-codes.js';

export const ConfigSchema = z.object({
  baseUrl: z.string().url(),
  token: z.string().min(1),
  userLabel: z.string().nullable().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'orbit');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

/**
 * If both `ORBIT_API_BASE_URL` and `ORBIT_TOKEN` are set, returns a synthetic
 * config without reading the file. Otherwise reads the file (refusing modes
 * looser than 0600).
 *
 * Throws a `ConfigError` with `code: 'NO_CONFIG'` if no config is available.
 */
export class ConfigError extends Error {
  constructor(
    public readonly code: 'NO_CONFIG' | 'BAD_MODE' | 'PARSE',
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export async function loadConfig(): Promise<Config> {
  const envBase = process.env.ORBIT_API_BASE_URL;
  const envToken = process.env.ORBIT_TOKEN;
  if (envBase && envToken) {
    return { baseUrl: envBase, token: envToken, userLabel: null };
  }

  const p = configPath();
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(p);
  } catch {
    throw new ConfigError(
      'NO_CONFIG',
      `error: not logged in (no config at ${p}). Run: orbit login --token <pat>`,
      EXIT_AUTH,
    );
  }

  // 0600 enforcement: anything in the "group" or "other" bits is rejected.
  // Only relevant on POSIX. On Windows fs.stat may report 0o666 — accept
  // because permission model differs and the user is on a single-user box.
  if (process.platform !== 'win32') {
    const looseBits = stat.mode & 0o077;
    if (looseBits !== 0) {
      const octal = (stat.mode & 0o777).toString(8).padStart(3, '0');
      throw new ConfigError(
        'BAD_MODE',
        `error: refusing to read ${p} with mode ${octal}; run: chmod 600 ${p}`,
        EXIT_AUTH,
      );
    }
  }

  const raw = await fs.readFile(p, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError('PARSE', `error: failed to parse ${p}: ${String(e)}`, EXIT_GENERIC_PARSE);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      'PARSE',
      `error: invalid config at ${p}: ${JSON.stringify(result.error.issues)}`,
      EXIT_GENERIC_PARSE,
    );
  }
  return result.data;
}

// Used inside config; avoid cyclical import.
const EXIT_GENERIC_PARSE = 1;

export async function saveConfig(cfg: Config): Promise<void> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true });
  const p = configPath();
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  // Belt-and-braces: writeFile mode is honored only on file creation in some
  // implementations; chmod ensures the bits are right on overwrite too.
  try {
    await fs.chmod(p, 0o600);
  } catch {
    // ignore (Windows etc.)
  }
}

export async function clearConfig(): Promise<void> {
  await fs.rm(configPath(), { force: true });
}
