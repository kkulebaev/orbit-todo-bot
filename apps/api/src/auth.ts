import type { Request, Response, NextFunction } from "express";
import type { PrismaClient, User } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";

declare module "express-serve-static-core" {
  interface Request {
    viewer?: User;
    auth?: AuthContext;
  }
}

/**
 * `req.auth` shape attached by `resolveCredential`.
 *
 * `impersonation` is present iff `canImpersonate === true` — emitted on every
 * authed pino log line so we have an audit trail of bot-PAT-on-behalf-of-user
 * calls (AC-P2-20).
 */
export type AuthContext = {
  path: "pat";
  patId: string;
  canImpersonate: boolean;
  impersonation?: {
    subjectTelegramUserId: string;
    callerPatId: string;
    path: string;
    method: string;
    ts: string;
  };
};

type AuthLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

export type ResolveCredentialOpts = {
  /** Comma-friendly list of CIDRs allowed for `canImpersonate=true` PATs. */
  allowedCidrs: string[];
  logger?: AuthLogger;
};

function unauthorized(res: Response): void {
  res
    .status(401)
    .json({ error: { code: "unauthorized", message: "unauthorized" } });
}

function missingIdentity(res: Response): void {
  res.status(401).json({
    error: {
      code: "missing_identity",
      message: "X-Telegram-User-Id required",
    },
  });
}

/**
 * PAT-only credential middleware (P2 replacement for `requireBearer`+`resolveViewer`).
 *
 * Flow:
 *   1. Read `Authorization: Bearer <plaintext>`. Missing/malformed → 401 opaque.
 *   2. SHA-256(plaintext) → lookup non-revoked / non-expired `PersonalAccessToken`.
 *   3. `crypto.timingSafeEqual` against the stored hash buffer (AC-P2-13).
 *   4a. `canImpersonate=true`  → caller IP must be inside `opts.allowedCidrs`,
 *       `X-Telegram-User-Id` header is required, viewer is upserted by TG id.
 *       Emits pino log entry with `auth.impersonation` (AC-P2-20).
 *   4b. `canImpersonate=false` → ignore the header entirely (AC-P2-24); viewer
 *       is `PAT.userId`.
 *   5. Fire-and-forget `lastUsedAt = NOW()` update (AC-P2-19).
 */
export function resolveCredential(
  prisma: PrismaClient,
  opts: ResolveCredentialOpts,
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const auth = req.header("authorization");
    if (!auth?.startsWith("Bearer ")) {
      unauthorized(res);
      return;
    }
    const plaintext = auth.slice(7);
    if (!plaintext) {
      unauthorized(res);
      return;
    }
    const hashHex = createHash("sha256").update(plaintext).digest("hex");

    // We look up by hashHex (an indexed unique column) and then ALSO run
    // crypto.timingSafeEqual on the buffer pair. Index lookups themselves are
    // not constant-time, but two PATs with the same hash collision probability
    // is 1/2^256 — the timingSafeEqual call exists per AC-P2-13.
    const row = await prisma.personalAccessToken.findFirst({
      where: {
        tokenHash: hashHex,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!row) {
      unauthorized(res);
      return;
    }
    const computed = Buffer.from(hashHex, "hex");
    const stored = Buffer.from(row.tokenHash, "hex");
    if (
      computed.length !== stored.length ||
      !timingSafeEqual(computed, stored)
    ) {
      unauthorized(res);
      return;
    }

    if (row.canImpersonate) {
      const remote = req.ip ?? "";
      if (!isIpInAnyCidr(remote, opts.allowedCidrs)) {
        unauthorized(res);
        return;
      }
      const tgHeader = req.header("x-telegram-user-id");
      if (!tgHeader || !/^\d+$/.test(tgHeader)) {
        missingIdentity(res);
        return;
      }
      try {
        const telegramUserId = BigInt(tgHeader);
        const user = await prisma.user.upsert({
          where: { telegramUserId },
          update: {},
          create: { telegramUserId },
        });
        req.viewer = user;
        req.auth = {
          path: "pat",
          patId: row.id,
          canImpersonate: true,
          impersonation: {
            subjectTelegramUserId: tgHeader,
            callerPatId: row.id,
            path: req.path,
            method: req.method,
            ts: new Date().toISOString(),
          },
        };
        opts.logger?.info({ auth: req.auth }, "auth.impersonation");
      } catch (e) {
        next(e);
        return;
      }
    } else {
      // User PAT: ignore X-Telegram-User-Id header entirely (AC-P2-24).
      const user = await prisma.user.findUnique({
        where: { id: row.userId },
      });
      if (!user) {
        unauthorized(res);
        return;
      }
      req.viewer = user;
      req.auth = { path: "pat", patId: row.id, canImpersonate: false };
    }

    // Fire-and-forget lastUsedAt update (AC-P2-19). Errors are swallowed —
    // an auth success should not be blocked on this side-effect.
    void prisma.personalAccessToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        /* swallow */
      });

    next();
  };
}

// ── CIDR matcher ─────────────────────────────────────────────────────────────
//
// Inline matcher avoids a new dep (`ipaddr.js`). Handles IPv4, IPv6, and the
// IPv4-mapped-IPv6 form ("::ffff:127.0.0.1") that supertest/Node sees on a
// dual-stack listener.

/** Parse "1.2.3.4" into 4 octets, or null on malformed input. */
function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Parse an IPv6 address (including `::` compression) into 16 bytes, or null. */
function parseIPv6(ip: string): number[] | null {
  // Strip zone id (e.g. "fe80::1%eth0").
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  // IPv4-mapped form: "::ffff:1.2.3.4" — convert the v4 tail to two v6 groups.
  const lastColon = ip.lastIndexOf(":");
  if (lastColon !== -1 && ip.includes(".", lastColon)) {
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    const hi = (v4[0]! << 8) | v4[1]!;
    const lo = (v4[2]! << 8) | v4[3]!;
    ip = `${ip.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const dbl = ip.indexOf("::");
  let head: string[] = [];
  let tail: string[] = [];
  if (dbl === -1) {
    head = ip.split(":");
  } else {
    head = ip.slice(0, dbl) === "" ? [] : ip.slice(0, dbl).split(":");
    tail = ip.slice(dbl + 2) === "" ? [] : ip.slice(dbl + 2).split(":");
  }
  if (head.length + tail.length > 8) return null;
  const fillCount = 8 - head.length - tail.length;
  const groups = [
    ...head,
    ...Array(fillCount).fill("0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/** Returns a 16-byte buffer for any IPv4 or IPv6 input (IPv4 → mapped). */
function ipToBytes(ip: string): number[] | null {
  // Bare IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const v4 = parseIPv4(ip);
    if (!v4) return null;
    // IPv4-mapped IPv6: ::ffff:<v4>
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...v4];
  }
  return parseIPv6(ip);
}

/**
 * Check whether `ip` is inside any of the supplied CIDRs.
 *
 * CIDR forms accepted:
 *   - `1.2.3.0/24`   (IPv4)
 *   - `fd00::/8`     (IPv6)
 *   - `::1`          (no prefix → exact match, treated as /128)
 *   - `127.0.0.1`    (no prefix → exact match, treated as /32 → /128 mapped)
 *
 * IPv4 CIDRs are matched against IPv4-mapped IPv6 (prefix length is shifted
 * by 96 to account for the `::ffff:` prefix).
 */
export function isIpInAnyCidr(ip: string, cidrs: string[]): boolean {
  if (!ip) return false;
  const ipBytes = ipToBytes(ip);
  if (!ipBytes) return false;
  for (const raw of cidrs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (cidrMatches(ipBytes, trimmed)) return true;
  }
  return false;
}

function cidrMatches(ipBytes: number[], cidr: string): boolean {
  const slash = cidr.indexOf("/");
  let addr: string;
  let prefix: number | null;
  if (slash === -1) {
    addr = cidr;
    prefix = null;
  } else {
    addr = cidr.slice(0, slash);
    prefix = Number(cidr.slice(slash + 1));
    if (!Number.isFinite(prefix) || prefix < 0) return false;
  }
  const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(addr);
  const cidrBytes = ipToBytes(addr);
  if (!cidrBytes) return false;

  let bits: number;
  if (prefix === null) {
    bits = isV4 ? 128 : 128; // exact match
  } else if (isV4) {
    if (prefix > 32) return false;
    bits = 96 + prefix; // account for ::ffff: prefix
  } else {
    if (prefix > 128) return false;
    bits = prefix;
  }

  const fullBytes = Math.floor(bits / 8);
  const remBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== cidrBytes[i]) return false;
  }
  if (remBits > 0) {
    const mask = (0xff << (8 - remBits)) & 0xff;
    if (((ipBytes[fullBytes] ?? 0) & mask) !== ((cidrBytes[fullBytes] ?? 0) & mask)) {
      return false;
    }
  }
  return true;
}

/** Parse env var `BOT_PAT_ALLOWED_CIDR` into a clean array. */
export function parseCidrsFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
