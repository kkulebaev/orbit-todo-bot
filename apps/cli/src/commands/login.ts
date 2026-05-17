import type { Command } from 'commander';

import { createApiClient } from '@orbit/api-client';

import { saveConfig } from '../config.js';
import { EXIT_OK, exitFromError } from '../exit-codes.js';
import { CLI_VERSION } from '../version.js';

const DEFAULT_BASE_URL = 'https://orbit-todo-api.up.railway.app';
const PAT_REGEX = /^orbit_pat_[A-Za-z0-9_-]{43,}$/;

export type LoginDeps = {
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  saveConfig?: typeof saveConfig;
};

export async function executeLogin(
  opts: { token: string; baseUrl?: string },
  deps: LoginDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const save = deps.saveConfig ?? saveConfig;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

  if (!PAT_REGEX.test(opts.token)) {
    err('error: token does not match expected PAT format (orbit_pat_<base64url>)');
    return 1;
  }

  const client = createApiClient({
    baseUrl,
    credential: { kind: 'pat', token: opts.token },
    userAgent: `orbit-cli/${CLI_VERSION}`,
    fetchImpl: deps.fetchImpl,
  });

  let user;
  try {
    user = await client.asViewer('0').upsertMe();
  } catch (e) {
    return exitFromError(e);
  }

  const label = String(user.numId);
  await save({
    baseUrl,
    token: opts.token,
    userLabel: label,
  });

  log(`Logged in as ${label}.`);
  return EXIT_OK;
}

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('Log in by saving a Personal Access Token to the config file.')
    .requiredOption('--token <pat>', 'PAT minted via /cli_link in the bot')
    .option('--base-url <url>', 'API base URL', DEFAULT_BASE_URL)
    .action(async (opts: { token: string; baseUrl?: string }) => {
      const code = await executeLogin(opts);
      process.exit(code);
    });
}
