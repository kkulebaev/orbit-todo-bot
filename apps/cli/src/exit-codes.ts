import { ApiClientError, ApiNetworkError } from '@orbit/api-client';

export const EXIT_OK = 0;
export const EXIT_GENERIC = 1;
export const EXIT_AUTH = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_NETWORK = 4;

/**
 * Maps a thrown error to a CLI exit code.
 *
 *   ApiClientError(401)  → 2 (auth)
 *   ApiClientError(404)  → 3 (not-found)
 *   ApiNetworkError      → 4 (network)
 *   anything else        → 1 (generic)
 */
export function exitFromError(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401) return EXIT_AUTH;
    if (err.status === 404) return EXIT_NOT_FOUND;
    return EXIT_GENERIC;
  }
  if (err instanceof ApiNetworkError) return EXIT_NETWORK;
  return EXIT_GENERIC;
}
