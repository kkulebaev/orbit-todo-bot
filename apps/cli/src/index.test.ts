/**
 * Top-level program assembly tests. AC-P3-7: commander errors → exit 1.
 *
 * We use `.exitOverride()` (already set in main) and `parseAsync` with a
 * crafted argv to assert that commander rejects bad input loudly.
 */
import { describe, expect, it } from 'vitest';
import { CommanderError } from 'commander';

import { buildProgram } from './index.js';

describe('buildProgram', () => {
  it('registers all 11 top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    // 11 commands: login, logout, whoami, list, show, add, done, reopen, edit, rm, tokens
    expect(names).toEqual(
      ['add', 'done', 'edit', 'list', 'login', 'logout', 'reopen', 'rm', 'show', 'tokens', 'whoami'].sort(),
    );
  });

  it('--version prints the package version (via exitOverride + parseAsync)', async () => {
    const program = buildProgram().exitOverride();
    let captured = '';
    program.configureOutput({
      writeOut: (s) => {
        captured += s;
      },
      writeErr: (s) => {
        captured += s;
      },
    });
    try {
      await program.parseAsync(['node', 'orbit', '--version']);
    } catch (e) {
      // commander throws on --version under exitOverride.
      expect(e).toBeInstanceOf(CommanderError);
    }
    expect(captured.trim().length).toBeGreaterThan(0);
  });

  // AC-P3-7
  it('rejects an unknown option with a CommanderError (mapped to exit 1)', async () => {
    const program = buildProgram();
    program.exitOverride();
    for (const sub of program.commands) sub.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    let err: unknown;
    try {
      await program.parseAsync(['node', 'orbit', 'list', '--this-flag-is-bogus']);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CommanderError);
    expect((err as CommanderError).exitCode).not.toBe(0);
  });

  it('rejects an unknown subcommand', async () => {
    const program = buildProgram();
    program.exitOverride();
    for (const sub of program.commands) sub.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    let err: unknown;
    try {
      await program.parseAsync(['node', 'orbit', 'this-does-not-exist']);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CommanderError);
  });
});
