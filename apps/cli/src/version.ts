import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// We deliberately read package.json at runtime instead of using
// `import ... with { type: 'json' }` because tsc emits CJS-vs-ESM warnings
// inconsistently across versions for json imports. The package.json is
// always next to dist/, so this resolves both during dev (tsx) and prod
// (node dist/index.js).
function readPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dev: src/version.ts → ../package.json
  // built: dist/version.js → ../package.json
  const candidates = [
    path.join(here, '..', 'package.json'),
    path.join(here, '..', '..', 'package.json'),
  ];
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

export const CLI_VERSION = readPackageVersion();
