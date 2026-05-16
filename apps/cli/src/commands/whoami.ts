import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_OK, exitFromError } from '../exit-codes.js';
import { CLI_VERSION } from '../version.js';

export type WhoamiDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
};

function majorOf(v: string): number | null {
  const m = v.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

export async function executeWhoami(
  opts: { json?: boolean },
  deps: WhoamiDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  let client: ApiViewerClient;
  try {
    client = deps.client ?? (await getClient());
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return e.exitCode;
    }
    return exitFromError(e);
  }

  let user;
  try {
    user = await client.upsertMe();
  } catch (e) {
    return exitFromError(e);
  }

  // Version check is best-effort and never fatal.
  let warnLine: string | null = null;
  try {
    const v = await client.getVersion();
    const local = majorOf(CLI_VERSION);
    const remote = majorOf(v.contractsVersion);
    if (local !== null && remote !== null && local !== remote) {
      warnLine =
        `⚠️ CLI is contractsVersion ${CLI_VERSION}, server reports ${v.contractsVersion}; ` +
        `you may need to update.`;
    }
  } catch {
    // ignore version-probe failures
  }

  if (opts.json) {
    log(JSON.stringify(user));
    if (warnLine) err(warnLine);
  } else {
    log(`numId:       ${user.numId}`);
    log(`Username:    ${user.username ?? '(none)'}`);
    log(`Name:        ${user.firstName ?? '(none)'}`);
    log(`Telegram ID: ${user.telegramUserId}`);
    if (warnLine) log(warnLine);
  }
  return EXIT_OK;
}

export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Print the current authenticated user.')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const code = await executeWhoami(opts);
      process.exit(code);
    });
}
