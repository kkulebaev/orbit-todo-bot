import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';
import { PAGE_SIZE, type TaskDto } from '@orbit/contracts';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_OK, exitFromError } from '../exit-codes.js';
import { renderTable } from '../render/table.js';
import { renderTaskRow } from '../render/task.js';

const MODES = new Set(['my', 'done']);

export type ListDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  now?: Date;
};

export async function executeList(
  opts: { mode?: string; page?: string; all?: boolean; json?: boolean },
  deps: ListDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const now = deps.now ?? new Date();

  const mode = opts.mode ?? 'my';
  if (!MODES.has(mode)) {
    err(`error: --mode must be one of: my, done`);
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
  if (opts.all && opts.page !== undefined) {
    err(`error: --all cannot be combined with --page`);
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

  const typedMode = mode as 'my' | 'done';

  if (opts.all) {
    const collected: TaskDto[] = [];
    let total = 0;
    let p = 0;
    while (true) {
      let resp;
      try {
        resp = await client.listTasks({ mode: typedMode, page: p });
      } catch (e) {
        return exitFromError(e);
      }
      total = resp.total;
      collected.push(...resp.items);
      if (collected.length >= resp.total || resp.items.length === 0) break;
      p += 1;
    }
    if (opts.json) {
      log(JSON.stringify({ items: collected, page: 0, total }));
      return EXIT_OK;
    }
    if (collected.length === 0) {
      log('No tasks.');
      return EXIT_OK;
    }
    const rows = collected.map((t) => renderTaskRow(t, now));
    log(renderTable({ headers: ['#', 'Title', 'Due', 'Status'], rows }));
    return EXIT_OK;
  }

  let resp;
  try {
    resp = await client.listTasks({ mode: typedMode, page });
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
  log(renderPager({ page: resp.page, total: resp.total, mode: typedMode }));
  return EXIT_OK;
}

function renderPager(opts: {
  page: number;
  total: number;
  mode: 'my' | 'done';
}): string {
  const { page, total, mode } = opts;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const human = `Страница ${page + 1} из ${totalPages} · всего ${total}`;
  if (page + 1 >= totalPages) return human;
  const modeFlag = mode === 'my' ? '' : ` --mode ${mode}`;
  return `${human} · далее: orbit list${modeFlag} --page ${page + 1}`;
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List tasks. Default mode is "my".')
    .option('--mode <mode>', 'my | done', 'my')
    .option('--page <n>', 'Page index, 0-based')
    .option('--all', 'Fetch all pages and print as a single table')
    .option('--json', 'Output as JSON')
    .action(
      async (opts: {
        mode?: string;
        page?: string;
        all?: boolean;
        json?: boolean;
      }) => {
        const code = await executeList(opts);
        process.exit(code);
      },
    );
}
