import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';
import { parseDueDateInput, type UpdateTaskInput } from '@orbit/contracts';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_NOT_FOUND, EXIT_OK, exitFromError } from '../exit-codes.js';
import { getIdempotencyKey } from '../idempotency.js';
import { renderTaskDetail } from '../render/task.js';

export type EditDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  now?: Date;
  idempotencyKey?: (explicit?: string) => string;
};

export type EditOpts = {
  title?: string;
  due?: string;
  noDue?: boolean;
  json?: boolean;
  idempotencyKey?: string;
};

export async function executeEdit(
  numIdRaw: string,
  opts: EditOpts,
  deps: EditDeps = {},
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

  if (opts.due && opts.noDue) {
    err('error: --due and --no-due are mutually exclusive');
    return 1;
  }

  if (!opts.title && !opts.due && !opts.noDue) {
    err('error: supply at least one of --title, --due, --no-due');
    return 1;
  }

  const patch: UpdateTaskInput = {};
  if (opts.title !== undefined) {
    if (opts.title.trim().length === 0) {
      err('error: --title must not be empty');
      return 1;
    }
    patch.title = opts.title;
  }
  if (opts.due) {
    const parsed = parseDueDateInput(opts.due, now);
    if (!parsed.ok) {
      err(
        parsed.error === 'past'
          ? 'error: --due is in the past'
          : 'error: --due format must be DD.MM.YYYY or "DD.MM.YYYY HH:MM"',
      );
      return 1;
    }
    patch.dueAt = parsed.dueAt.toISOString();
    patch.dueHasTime = parsed.dueHasTime;
  }
  if (opts.noDue) {
    patch.dueAt = null;
    patch.dueHasTime = false;
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
    task = await client.updateTask(numId, patch, keyOf(opts.idempotencyKey));
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

export function registerEdit(program: Command): void {
  program
    .command('edit <numId>')
    .description('Edit a task. Provide --title and/or --due (or --no-due to clear).')
    .option('--title <title>', 'New title')
    .option('--due <date>', '"DD.MM.YYYY" or "DD.MM.YYYY HH:MM" (Europe/Moscow)')
    .option('--no-due', 'Clear the due date')
    .option('--idempotency-key <key>', 'Custom Idempotency-Key (default: randomUUID())')
    .option('--json', 'Output as JSON')
    .action(async (numId: string, opts: EditOpts) => {
      const code = await executeEdit(numId, opts);
      process.exit(code);
    });
}
