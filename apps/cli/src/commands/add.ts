import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';
import { parseDueDateInput } from '@orbit/contracts';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_OK, exitFromError } from '../exit-codes.js';
import { getIdempotencyKey } from '../idempotency.js';
import { renderTaskDetail } from '../render/task.js';

export type AddDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  now?: Date;
  idempotencyKey?: (explicit?: string) => string;
};

export async function executeAdd(
  text: string[],
  opts: { due?: string; json?: boolean; idempotencyKey?: string },
  deps: AddDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const now = deps.now ?? new Date();
  const keyOf = deps.idempotencyKey ?? getIdempotencyKey;

  const title = text.join(' ').trim();
  if (!title) {
    err('error: <text...> is required');
    return 1;
  }

  let dueAt: string | undefined;
  let dueHasTime = false;
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
    dueAt = parsed.dueAt.toISOString();
    dueHasTime = parsed.dueHasTime;
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

  const key = keyOf(opts.idempotencyKey);

  let created;
  try {
    created = await client.createTask(
      { title, ...(dueAt !== undefined ? { dueAt, dueHasTime } : {}) },
      key,
    );
  } catch (e) {
    return exitFromError(e);
  }

  if (opts.json) {
    log(JSON.stringify(created));
  } else {
    log(renderTaskDetail(created, now));
  }
  return EXIT_OK;
}

export function registerAdd(program: Command): void {
  program
    .command('add <text...>')
    .description('Create a new task. Multi-word title supported.')
    .option('--due <date>', '"DD.MM.YYYY" or "DD.MM.YYYY HH:MM" (Europe/Moscow)')
    .option('--idempotency-key <key>', 'Custom Idempotency-Key (default: randomUUID())')
    .option('--json', 'Output as JSON')
    .action(
      async (
        text: string[],
        opts: { due?: string; json?: boolean; idempotencyKey?: string },
      ) => {
        const code = await executeAdd(text, opts);
        process.exit(code);
      },
    );
}
