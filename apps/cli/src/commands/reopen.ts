import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_NOT_FOUND, EXIT_OK, exitFromError } from '../exit-codes.js';
import { getIdempotencyKey } from '../idempotency.js';
import { renderTaskDetail } from '../render/task.js';

export type ReopenDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  now?: Date;
  idempotencyKey?: (explicit?: string) => string;
};

export async function executeReopen(
  numIdRaw: string,
  opts: { json?: boolean; idempotencyKey?: string },
  deps: ReopenDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const now = deps.now ?? new Date();
  const keyOf = deps.idempotencyKey ?? getIdempotencyKey;

  const numId = Number(numIdRaw);
  if (!Number.isInteger(numId) || numId <= 0) {
    err('error: <numId> must be a positive integer');
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

  let task;
  try {
    task = await client.updateTask(numId, { status: 'open' }, keyOf(opts.idempotencyKey));
  } catch (e) {
    return exitFromError(e);
  }

  if (task === null) {
    err(`error: task #${numId} not found`);
    return EXIT_NOT_FOUND;
  }

  if (opts.json) log(JSON.stringify(task));
  else log(renderTaskDetail(task, now));
  return EXIT_OK;
}

export function registerReopen(program: Command): void {
  program
    .command('reopen <numId>')
    .description('Reopen a done task.')
    .option('--idempotency-key <key>', 'Custom Idempotency-Key (default: randomUUID())')
    .option('--json', 'Output as JSON')
    .action(async (numId: string, opts: { json?: boolean; idempotencyKey?: string }) => {
      const code = await executeReopen(numId, opts);
      process.exit(code);
    });
}
