import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read contracts version from package.json at module load time.
// Path: from dist/routes/ -> up 4 levels to workspace root -> packages/contracts/package.json
const contractsPkgPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "contracts",
  "package.json",
);

let contractsVersion = "unknown";
try {
  const pkg = JSON.parse(readFileSync(contractsPkgPath, "utf8")) as {
    version?: string;
  };
  contractsVersion = pkg.version ?? "unknown";
} catch {
  // Fall back to "unknown" if the file is missing in some build environments.
}

/**
 * GET /v1/version — authenticated endpoint returning build provenance.
 * Requires auth (mounted under the /v1 authenticated router).
 */
export function versionRoutes(): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    res.json({
      contractsVersion,
      commit: process.env.GIT_COMMIT ?? "unknown",
      builtAt: process.env.BUILT_AT ?? "unknown",
    });
  });

  return r;
}
