import type { Command } from 'commander';

import type { ApiViewerClient } from '@orbit/api-client';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { EXIT_NOT_FOUND, EXIT_OK, exitFromError } from '../exit-codes.js';
import { getIdempotencyKey } from '../idempotency.js';
import { renderTable } from '../render/table.js';

export type TokensDeps = {
  client?: ApiViewerClient;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  idempotencyKey?: (explicit?: string) => string;
};

export async function executeTokensList(
  opts: { json?: boolean },
  deps: TokensDeps = {},
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

  let tokens;
  try {
    tokens = await client.listCliTokens();
  } catch (e) {
    return exitFromError(e);
  }

  if (opts.json) {
    log(JSON.stringify(tokens));
    return EXIT_OK;
  }

  if (tokens.length === 0) {
    log('No tokens.');
    return EXIT_OK;
  }

  const rows = tokens.map((t) => [
    t.id,
    t.label ?? '',
    t.createdAt,
    t.lastUsedAt ?? '',
    t.expiresAt ?? '',
  ]);
  log(
    renderTable({
      headers: ['ID', 'Label', 'Created', 'Last used', 'Expires'],
      rows,
    }),
  );
  return EXIT_OK;
}

export async function executeTokensRevoke(
  id: string,
  opts: { yes?: boolean; json?: boolean; idempotencyKey?: string },
  deps: TokensDeps = {},
): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const err = deps.err ?? ((m) => process.stderr.write(m + '\n'));
  const keyOf = deps.idempotencyKey ?? getIdempotencyKey;

  if (!opts.yes) {
    err('refusing to revoke without --yes');
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
    ok = await client.revokeCliToken(id, keyOf(opts.idempotencyKey));
  } catch (e) {
    return exitFromError(e);
  }

  if (!ok) {
    err(`error: token ${id} not found`);
    return EXIT_NOT_FOUND;
  }

  if (opts.json) log(JSON.stringify({ ok: true, id }));
  else log(`Revoked token ${id}.`);
  return EXIT_OK;
}

export function registerTokens(program: Command): void {
  const tokens = program
    .command('tokens')
    .description('Manage Personal Access Tokens.');

  tokens
    .command('list')
    .description('List all PATs belonging to the current user.')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const code = await executeTokensList(opts);
      process.exit(code);
    });

  tokens
    .command('revoke <id>')
    .description('Revoke a PAT by id. Requires --yes.')
    .option('--yes', 'Confirm the revocation')
    .option('--idempotency-key <key>', 'Custom Idempotency-Key (default: randomUUID())')
    .option('--json', 'Output as JSON')
    .action(
      async (
        id: string,
        opts: { yes?: boolean; json?: boolean; idempotencyKey?: string },
      ) => {
        const code = await executeTokensRevoke(id, opts);
        process.exit(code);
      },
    );
}
