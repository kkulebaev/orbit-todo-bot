import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_OK, exitFromError } from '../exit-codes.js';
import { renderTable } from '../render/table.js';
import { renderTaskRow } from '../render/task.js';

const MODES = new Set(['my', 'due-soon', 'done']);

export type ListDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  now?: Date;
};

export async function executeList(
  opts: { mode?: string; page?: string; json?: boolean },
  deps: ListDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const now = deps.now ?? new Date();

  const mode = opts.mode ?? 'my';
  if (!MODES.has(mode)) {
    err(`error: --mode must be one of: my, due-soon, done`);
    return 1;
  }
  let page = 0;
  if (opts.page !== undefined) {
    const n = Number(opts.page);
    if (!Number.isInteger(n) || n < 0) {
      err(`error: --page must be a non-negative integer`);
      return 1;
    }
    page = n;
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

  let resp;
  try {
    resp = await client.listTasks({
      mode: mode as 'my' | 'due-soon' | 'done',
      page,
    });
  } catch (e) {
    return exitFromError(e);
  }

  if (opts.json) {
    log(JSON.stringify(resp));
    return EXIT_OK;
  }

  if (resp.items.length === 0) {
    log('No tasks.');
    return EXIT_OK;
  }

  const rows = resp.items.map((t) => renderTaskRow(t, now));
  log(renderTable({ headers: ['#', 'Title', 'Due', 'Status'], rows }));
  return EXIT_OK;
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List tasks. Default mode is "my".')
    .option('--mode <mode>', 'my | due-soon | done', 'my')
    .option('--page <n>', 'Page index, 0-based', '0')
    .option('--json', 'Output as JSON')
    .action(async (opts: { mode?: string; page?: string; json?: boolean }) => {
      const code = await executeList(opts);
      process.exit(code);
    });
}
