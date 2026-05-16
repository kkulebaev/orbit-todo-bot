import { createApiClient, type ApiViewerClient } from '@orbit/api-client';

import { loadConfig } from './config.js';
import { CLI_VERSION } from './version.js';

/**
 * Builds an `ApiViewerClient` from the on-disk config (or env overrides).
 *
 * `asViewer('0')` — the X-Telegram-User-Id header is ignored on user PATs
 * (server resolves the viewer from PAT.userId), so any placeholder string
 * satisfies the api-client interface.
 */
export async function getClient(): Promise<ApiViewerClient> {
  const cfg = await loadConfig();
  const client = createApiClient({
    baseUrl: cfg.baseUrl,
    credential: { kind: 'pat', token: cfg.token },
    userAgent: `orbit-cli/${CLI_VERSION}`,
  });
  return client.asViewer('0');
}

/**
 * Like `getClient` but lets the caller override config / base URL — useful
 * for the `login` flow that needs to probe a PAT before persisting it.
 */
export function getClientWithToken(opts: {
  baseUrl: string;
  token: string;
}): ApiViewerClient {
  const client = createApiClient({
    baseUrl: opts.baseUrl,
    credential: { kind: 'pat', token: opts.token },
    userAgent: `orbit-cli/${CLI_VERSION}`,
  });
  return client.asViewer('0');
}
