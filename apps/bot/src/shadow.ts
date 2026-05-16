/**
 * Shadow-mode helpers — P2 schema-canary.
 *
 * Every shadow call is fire-and-forget (void Promise). It NEVER blocks the
 * user-facing Prisma response. Errors are caught and logged as warnings.
 *
 * This is a **schema-canary**, not a data-canary:
 *   - We validate that the API response passes Zod parsing.
 *   - We do NOT compare API data vs Prisma data.
 *   - Users always receive the Prisma result regardless of shadow outcome.
 *
 * Disable: set SHADOW_MODE=false (or unset API_BASE_URL / API_BOT_TOKEN).
 */

import { performance } from 'node:perf_hooks';
import type { ApiClient } from './api-client.js';

export type ShadowConfig = {
  enabled: boolean;
  apiClient: ApiClient | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
};

/**
 * Run `apiCall` as a schema-canary against the API. Fire-and-forget — call
 * with `void` prefix so the Prisma response is never delayed.
 *
 * @param cfg    Shadow configuration (enabled flag + logger).
 * @param label  Human-readable label for log lines (e.g. "listTasks:my").
 * @param apiCall  Zero-arg lambda that performs the API call and Zod parse.
 */
export async function shadowCompare(
  cfg: ShadowConfig,
  label: string,
  apiCall: () => Promise<unknown>,
): Promise<void> {
  if (!cfg.enabled || !cfg.apiClient) return;

  const start = performance.now();
  try {
    await apiCall();
    cfg.logger.info(
      { shadow: label, ms: Math.round(performance.now() - start), status: 'ok' },
      'shadow call',
    );
  } catch (e) {
    cfg.logger.warn(
      {
        shadow: label,
        err: e instanceof Error ? e.message : String(e),
        ms: Math.round(performance.now() - start),
      },
      'shadow call diverged',
    );
  }
}
