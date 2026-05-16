import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ConfigError, configPath, loadConfig, saveConfig } from './config.js';

const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
const ORIGINAL_TOKEN = process.env.ORBIT_TOKEN;
const ORIGINAL_BASE = process.env.ORBIT_API_BASE_URL;

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'orbit-cli-test-'));
  process.env.XDG_CONFIG_HOME = tmpRoot;
  delete process.env.ORBIT_TOKEN;
  delete process.env.ORBIT_API_BASE_URL;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
  if (ORIGINAL_TOKEN === undefined) delete process.env.ORBIT_TOKEN;
  else process.env.ORBIT_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_BASE === undefined) delete process.env.ORBIT_API_BASE_URL;
  else process.env.ORBIT_API_BASE_URL = ORIGINAL_BASE;
});

describe('config', () => {
  it('saveConfig writes a 0600 file under XDG_CONFIG_HOME', async () => {
    await saveConfig({
      baseUrl: 'https://api.example.com',
      token: 'orbit_pat_' + 'a'.repeat(43),
      userLabel: 'alice',
    });
    const p = configPath();
    expect(p.startsWith(tmpRoot)).toBe(true);
    const stat = await fs.stat(p);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('loadConfig round-trips a saved config', async () => {
    const cfg = {
      baseUrl: 'https://api.example.com',
      token: 'orbit_pat_' + 'a'.repeat(43),
      userLabel: 'alice',
    };
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded).toEqual(cfg);
  });

  it('loadConfig refuses a 0644 file with exit code 2', async () => {
    await saveConfig({
      baseUrl: 'https://api.example.com',
      token: 'orbit_pat_' + 'a'.repeat(43),
    });
    await fs.chmod(configPath(), 0o644);
    await expect(loadConfig()).rejects.toMatchObject({
      name: 'ConfigError',
      code: 'BAD_MODE',
      exitCode: 2,
    });
  });

  it('loadConfig throws NO_CONFIG when no file and no env', async () => {
    await expect(loadConfig()).rejects.toMatchObject({
      name: 'ConfigError',
      code: 'NO_CONFIG',
      exitCode: 2,
    });
  });

  it('env override (ORBIT_TOKEN + ORBIT_API_BASE_URL) bypasses the file', async () => {
    process.env.ORBIT_TOKEN = 'orbit_pat_' + 'x'.repeat(43);
    process.env.ORBIT_API_BASE_URL = 'https://override.example.com';
    const loaded = await loadConfig();
    expect(loaded.baseUrl).toBe('https://override.example.com');
    expect(loaded.token).toBe('orbit_pat_' + 'x'.repeat(43));
  });

  it('rejects a malformed json file (PARSE error)', async () => {
    await fs.mkdir(path.dirname(configPath()), { recursive: true });
    await fs.writeFile(configPath(), '{not valid json', { mode: 0o600 });
    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigError);
  });
});
