import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// We deliberately read package.json at runtime instead of using
// `import ... with { type: 'json' }` because tsc emits CJS-vs-ESM warnings
// inconsistently across versions for json imports. The package.json is
// always next to dist/, so this resolves both during dev (tsx) and prod
// (node dist/index.js).
function readPackageVersion(candidates: string[]): string {
  for (const c of candidates) {
    try {
      const json = JSON.parse(readFileSync(c, 'utf8')) as { version?: string };
      if (typeof json.version === 'string' && json.version.length > 0) {
        return json.version;
      }
    } catch {
      // try next
    }
  }
  return '0.0.0';
}

const here = path.dirname(fileURLToPath(import.meta.url));

export const CLI_VERSION = readPackageVersion([
  // dev: src/version.ts → ../package.json
  // built: dist/version.js → ../package.json
  path.join(here, '..', 'package.json'),
  path.join(here, '..', '..', 'package.json'),
]);

// The @orbit/contracts version this CLI was built against. Used to detect
// server contract drift in `orbit whoami`. Both dev (src/) and built (dist/)
// are one directory below apps/cli/, so three levels up always reaches root/.
export const CONTRACTS_VERSION = readPackageVersion([
  path.join(here, '..', '..', '..', 'packages', 'contracts', 'package.json'),
]);
