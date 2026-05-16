import type { Command } from 'commander';

import { clearConfig, configPath, loadConfig } from '../config.js';
import { EXIT_OK } from '../exit-codes.js';

export type LogoutDeps = {
  log?: (msg: string) => void;
  loadConfig?: typeof loadConfig;
  clearConfig?: typeof clearConfig;
};

export async function executeLogout(deps: LogoutDeps = {}): Promise<number> {
  const log = deps.log ?? ((m) => process.stdout.write(m + '\n'));
  const load = deps.loadConfig ?? loadConfig;
  const clear = deps.clearConfig ?? clearConfig;

  try {
    await load();
  } catch {
    log('Already logged out.');
    return EXIT_OK;
  }

  await clear();
  log('Logged out. Local config deleted.');
  log(`Note: to revoke the token server-side, run 'orbit tokens list' then 'orbit tokens revoke <id>'.`);
  log(`(deleted: ${configPath()})`);
  return EXIT_OK;
}

export function registerLogout(program: Command): void {
  program
    .command('logout')
    .description('Delete the local config file. Does not revoke the PAT server-side.')
    .action(async () => {
      const code = await executeLogout();
      process.exit(code);
    });
}
