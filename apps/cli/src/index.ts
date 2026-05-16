#!/usr/bin/env node
import { Command, CommanderError } from 'commander';

import { registerAdd } from './commands/add.js';
import { registerDone } from './commands/done.js';
import { registerEdit } from './commands/edit.js';
import { registerList } from './commands/list.js';
import { registerLogin } from './commands/login.js';
import { registerLogout } from './commands/logout.js';
import { registerReopen } from './commands/reopen.js';
import { registerRm } from './commands/rm.js';
import { registerShow } from './commands/show.js';
import { registerTokens } from './commands/tokens.js';
import { registerWhoami } from './commands/whoami.js';
import { EXIT_GENERIC, exitFromError } from './exit-codes.js';
import { CLI_VERSION } from './version.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('orbit')
    .description('orbit-todo CLI — third client alongside the Telegram bot.')
    .version(CLI_VERSION);

  registerLogin(program);
  registerLogout(program);
  registerWhoami(program);
  registerList(program);
  registerShow(program);
  registerAdd(program);
  registerDone(program);
  registerReopen(program);
  registerEdit(program);
  registerRm(program);
  registerTokens(program);

  return program;
}

async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  // commander applies exitOverride only to the parent program; subcommands
  // still call process.exit on validation errors. Propagate explicitly so
  // bad input → CommanderError → mapped to exit 1.
  for (const sub of program.commands) {
    sub.exitOverride();
    for (const grandchild of sub.commands) grandchild.exitOverride();
  }
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // commander already printed its own message; just translate the code.
      // --version / --help exit 0; bad args exit 1.
      const code = err.exitCode === 0 ? 0 : EXIT_GENERIC;
      process.exit(code);
    }
    const code = exitFromError(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg) process.stderr.write(msg + '\n');
    process.exit(code);
  }
}

// Run only when this module is the entry point (not when imported by tests).
const isEntryPoint =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/index.ts'));

if (isEntryPoint) {
  void main(process.argv);
}
