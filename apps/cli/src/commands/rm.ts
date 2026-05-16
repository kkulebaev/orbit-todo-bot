import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_NOT_FOUND, EXIT_OK, exitFromError } from '../exit-codes.js';
import { getIdempotencyKey } from '../idempotency.js';

export type RmDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  idempotencyKey?: (explicit?: string) => string;
};

export async function executeRm(
  numIdRaw: string,
  opts: { yes?: boolean; json?: boolean; idempotencyKey?: string },
  deps: RmDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const keyOf = deps.idempotencyKey ?? getIdempotencyKey;

  const numId = Number(numIdRaw);
  if (!Number.isInteger(numId) || numId <= 0) {
    err('error: <numId> must be a positive integer');
    return 1;
  }

  if (!opts.yes) {
    err('refusing to delete without --yes');
    return 1;
  }

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

  let ok: boolean;
  try {
    ok = await client.deleteTask(numId, keyOf(opts.idempotencyKey));
  } catch (e) {
    return exitFromError(e);
  }

  if (!ok) {
    err(`error: task #${numId} not found`);
    return EXIT_NOT_FOUND;
  }

  if (opts.json) log(JSON.stringify({ ok: true, numId }));
  else log(`Deleted task #${numId}.`);
  return EXIT_OK;
}

export function registerRm(program: Command): void {
  program
    .command('rm <numId>')
    .description('Delete a task. Requires --yes.')
    .option('--yes', 'Confirm the deletion')
    .option('--idempotency-key <key>', 'Custom Idempotency-Key (default: randomUUID())')
    .option('--json', 'Output as JSON')
    .action(
      async (
        numId: string,
        opts: { yes?: boolean; json?: boolean; idempotencyKey?: string },
      ) => {
        const code = await executeRm(numId, opts);
        process.exit(code);
      },
    );
}
