import React from 'react';
import { render } from 'ink';

import { getClient } from '../client.js';
import { ConfigError } from '../config.js';
import { getIdempotencyKey } from '../idempotency.js';
import { App } from './App.js';

/**
 * Launch the interactive TUI. Returns the process exit code so the caller
 * (`index.ts`) can `process.exit` once Ink has unmounted.
 */
export async function runTui(): Promise<number> {
  let client;
  try {
    client = await getClient();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(e.message + '\n');
      return e.exitCode;
    }
    throw e;
  }

  const instance = render(
    React.createElement(App, {
      client,
      idempotencyKey: getIdempotencyKey,
      now: new Date(),
    }),
  );
  await instance.waitUntilExit();
  return 0;
}
