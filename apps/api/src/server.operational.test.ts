/**
 * Operational hardening tests (P2-B).
 *
 * ACs covered:
 *   AC-P2-5  trust proxy + XFF bucketing (piggybacking on rate-limit)
 *   AC-P2-6  API_PUBLIC_EXPOSURE feature flag
 *   AC-P2-7  no CORS headers
 *   AC-P2-9  per-IP rate limit (60 req/min)
 *   AC-P2-10 HSTS on every response class
 *   AC-P2-11 /healthz deep-equal body
 *   AC-P2-14 PAT plaintext absent from pino logs
 *   AC-P2-15..18 log field assertions (auth.path, auth.patId,
 *              auth.canImpersonate, user.agent)
 *   AC-P2-21 429 log line includes rejected IP
 */

import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
} from "vitest";
import request from "supertest";
import { pino } from "pino";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "./server.js";
import { startTestDb, stopTestDb, type TestDb } from "./test-helpers/postgres.js";
import { createTestPat } from "./test-helpers/pat.js";

const DEFAULT_CIDRS = ["fd00::/8", "::1", "127.0.0.1/32"];

// ── AC-P2-11: /healthz body deep-equal ───────────────────────────────────────

describe("AC-P2-11 /healthz body", () => {
  it("returns exactly { ok: true, service: 'api' } — no extra keys", async () => {
    const app = createApp({ prisma: {} as unknown as PrismaClient });
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    // Deep-equal: no extra keys allowed.
    expect(res.body).toStrictEqual({ ok: true, service: "api" });
  });
});

// ── AC-P2-6: API_PUBLIC_EXPOSURE feature flag ─────────────────────────────────

describe("AC-P2-6 API_PUBLIC_EXPOSURE feature flag", () => {
  it("publicExposure=false: /v1/* returns 404, /healthz still 200", async () => {
    const app = createApp({
      prisma: {} as unknown as PrismaClient,
      publicExposure: false,
    });
    const healthz = await request(app).get("/healthz");
    expect(healthz.status).toBe(200);

    const v1 = await request(app).get("/v1/users/me");
    expect(v1.status).toBe(404);
  });

  it("publicExposure=true: /v1/* returns 401 (auth required, not 404)", async () => {
    const app = createApp({
      prisma: {} as unknown as PrismaClient,
      publicExposure: true,
    });
    const res = await request(app).get("/v1/users/me");
    // 401 means the route exists but auth failed — not 404
    expect(res.status).toBe(401);
  });
});

// ── AC-P2-10: HSTS on every response class ───────────────────────────────────

describe("AC-P2-10 HSTS header", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    await db.prisma.personalAccessToken.deleteMany();
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.invite.deleteMany();
    await db.prisma.user.deleteMany();
  });

  const HSTS_VALUE = "max-age=15552000; includeSubDomains";

  it("present on GET /healthz (200)", async () => {
    const app = createApp({ prisma: db.prisma, publicExposure: true, allowedCidrs: DEFAULT_CIDRS });
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe(HSTS_VALUE);
  });

  it("present on GET /v1/users/me without auth (401)", async () => {
    const app = createApp({ prisma: db.prisma, publicExposure: true, allowedCidrs: DEFAULT_CIDRS });
    const res = await request(app).get("/v1/users/me");
    expect(res.status).toBe(401);
    expect(res.headers["strict-transport-security"]).toBe(HSTS_VALUE);
  });

  it("present on GET /v1/users/me with valid auth (200)", async () => {
    const app = createApp({ prisma: db.prisma, publicExposure: true, allowedCidrs: DEFAULT_CIDRS });
    const { plaintext } = await createTestPat(db.prisma, { canImpersonate: false });
    const res = await request(app)
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${plaintext}`);
    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe(HSTS_VALUE);
  });
});

// ── AC-P2-7: no CORS headers ─────────────────────────────────────────────────

describe("AC-P2-7 no CORS headers", () => {
  it("OPTIONS /v1/tasks with Origin emits no Access-Control-* headers", async () => {
    const app = createApp({
      prisma: {} as unknown as PrismaClient,
      publicExposure: true,
    });
    const res = await request(app)
      .options("/v1/tasks")
      .set("Origin", "https://example.com");
    // No Access-Control-* headers should be present.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-methods"]).toBeUndefined();
    expect(res.headers["access-control-allow-headers"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

// ── AC-P2-5 + AC-P2-9: trust proxy + rate limit bucketing ───────────────────

describe("AC-P2-5 + AC-P2-9 trust proxy + rate limit", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    await db.prisma.personalAccessToken.deleteMany();
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.invite.deleteMany();
    await db.prisma.user.deleteMany();
  });

  it("61st request from same IP hits 429 with Retry-After", async () => {
    // Use RATE_LIMIT_PER_MIN env override via createApp to keep window small.
    // We temporarily set env to 3 for this test by passing a custom limiter.
    // Since createApp reads RATE_LIMIT_PER_MIN from env, we test the real flow
    // with a 3-req limit configured via env override.
    const origEnv = process.env.RATE_LIMIT_PER_MIN;
    process.env.RATE_LIMIT_PER_MIN = "3";

    try {
      const { plaintext } = await createTestPat(db.prisma, { canImpersonate: false });
      const app = createApp({ prisma: db.prisma, publicExposure: true, allowedCidrs: DEFAULT_CIDRS });

      let last429 = false;
      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .get("/v1/users/me")
          .set("Authorization", `Bearer ${plaintext}`);
        if (i < 3) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(429);
          expect(res.headers["retry-after"]).toBeDefined();
          last429 = true;
        }
      }
      expect(last429).toBe(true);
    } finally {
      if (origEnv === undefined) {
        delete process.env.RATE_LIMIT_PER_MIN;
      } else {
        process.env.RATE_LIMIT_PER_MIN = origEnv;
      }
    }
  }, 30_000);

  it("AC-P2-5: spoofed X-Forwarded-For produces an independent rate-limit bucket", async () => {
    const origEnv = process.env.RATE_LIMIT_PER_MIN;
    process.env.RATE_LIMIT_PER_MIN = "2";

    try {
      const { plaintext } = await createTestPat(db.prisma, { canImpersonate: false });
      const app = createApp({ prisma: db.prisma, publicExposure: true, allowedCidrs: DEFAULT_CIDRS });

      // Exhaust the loopback bucket (2 requests).
      for (let i = 0; i < 2; i++) {
        const res = await request(app)
          .get("/v1/users/me")
          .set("Authorization", `Bearer ${plaintext}`);
        expect(res.status).toBe(200);
      }

      // Next request from loopback → 429.
      const rateLimited = await request(app)
        .get("/v1/users/me")
        .set("Authorization", `Bearer ${plaintext}`);
      expect(rateLimited.status).toBe(429);

      // But a different XFF IP should still be allowed (its bucket is fresh).
      // With trust proxy=1, X-Forwarded-For overrides the IP.
      const spoofedRes = await request(app)
        .get("/v1/users/me")
        .set("Authorization", `Bearer ${plaintext}`)
        .set("X-Forwarded-For", "203.0.113.1");
      // 203.0.113.1 bucket is empty — should get 200 (or 401 if auth reset, but
      // PAT is still valid).
      expect(spoofedRes.status).toBe(200);
    } finally {
      if (origEnv === undefined) {
        delete process.env.RATE_LIMIT_PER_MIN;
      } else {
        process.env.RATE_LIMIT_PER_MIN = origEnv;
      }
    }
  }, 30_000);

  it("canImpersonate=true PAT is exempt from rate limiting", async () => {
    const origEnv = process.env.RATE_LIMIT_PER_MIN;
    process.env.RATE_LIMIT_PER_MIN = "2";

    try {
      const { plaintext } = await createTestPat(db.prisma, { canImpersonate: true, label: "bot" });
      const app = createApp({ prisma: db.prisma, publicExposure: true, allowedCidrs: DEFAULT_CIDRS });
      const tgId = String(Date.now());

      // 3 requests (over the limit of 2) — should all succeed for bot PAT.
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .get("/v1/users/me")
          .set("Authorization", `Bearer ${plaintext}`)
          .set("X-Telegram-User-Id", tgId);
        expect(res.status).toBe(200);
      }
    } finally {
      if (origEnv === undefined) {
        delete process.env.RATE_LIMIT_PER_MIN;
      } else {
        process.env.RATE_LIMIT_PER_MIN = origEnv;
      }
    }
  }, 30_000);
});

// ── AC-P2-14 + AC-P2-15..18: log fields + PAT plaintext absent ───────────────

describe("AC-P2-14..18 pino log enrichment", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    await db.prisma.personalAccessToken.deleteMany();
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.invite.deleteMany();
    await db.prisma.user.deleteMany();
  });

  it("AC-P2-14: PAT plaintext never appears in pino log output", async () => {
    const captured: string[] = [];
    const captureStream = {
      write: (s: string) => {
        captured.push(s);
      },
    };
    const testLogger = pino({ level: "trace" }, captureStream);

    const { plaintext } = await createTestPat(db.prisma, { canImpersonate: false });
    const app = createApp({
      prisma: db.prisma,
      publicExposure: true,
      allowedCidrs: DEFAULT_CIDRS,
      logger: testLogger,
    });

    await request(app)
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${plaintext}`)
      .set("User-Agent", "orbit-cli/1.0.0");

    const allOutput = captured.join("\n");
    // AC-P2-14: the PAT plaintext must NEVER appear in logs.
    const patRegex = /orbit_pat_[A-Za-z0-9_-]+/;
    expect(patRegex.test(allOutput)).toBe(false);
  }, 30_000);

  it("AC-P2-15..18: auth.path, auth.patId, auth.canImpersonate, user.agent in log", async () => {
    const captured: Record<string, unknown>[] = [];
    const captureStream = {
      write: (s: string) => {
        try {
          captured.push(JSON.parse(s) as Record<string, unknown>);
        } catch {
          // ignore non-JSON lines
        }
      },
    };
    const testLogger = pino({ level: "trace" }, captureStream);

    const { plaintext, row } = await createTestPat(db.prisma, { canImpersonate: false });
    const app = createApp({
      prisma: db.prisma,
      publicExposure: true,
      allowedCidrs: DEFAULT_CIDRS,
      logger: testLogger,
    });

    const userAgent = "orbit-cli/1.0.0";
    await request(app)
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${plaintext}`)
      .set("User-Agent", userAgent);

    // Find the request-completed log line (has res.statusCode).
    const reqLog = captured.find(
      (l) => typeof l["res"] === "object" && l["res"] !== null,
    );
    expect(reqLog).toBeDefined();
    expect(reqLog!["auth.path"]).toBe("pat");
    expect(reqLog!["auth.patId"]).toBe(row.id);
    expect(reqLog!["auth.canImpersonate"]).toBe(false);
    expect(reqLog!["user.agent"]).toBe(userAgent);
  }, 30_000);

  it("AC-P2-20: auth.impersonation present on canImpersonate=true request", async () => {
    const captured: Record<string, unknown>[] = [];
    const captureStream = {
      write: (s: string) => {
        try {
          captured.push(JSON.parse(s) as Record<string, unknown>);
        } catch {
          // ignore non-JSON lines
        }
      },
    };
    const testLogger = pino({ level: "trace" }, captureStream);

    const { plaintext } = await createTestPat(db.prisma, { canImpersonate: true, label: "bot" });
    const app = createApp({
      prisma: db.prisma,
      publicExposure: true,
      allowedCidrs: DEFAULT_CIDRS,
      logger: testLogger,
    });

    const tgId = String(Date.now());
    await request(app)
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${plaintext}`)
      .set("X-Telegram-User-Id", tgId);

    const reqLog = captured.find(
      (l) => typeof l["res"] === "object" && l["res"] !== null,
    );
    expect(reqLog).toBeDefined();
    expect(reqLog!["auth.path"]).toBe("pat");
    expect(reqLog!["auth.canImpersonate"]).toBe(true);
    expect(reqLog!["auth.impersonation"]).toBeDefined();
    const imp = reqLog!["auth.impersonation"] as Record<string, unknown>;
    expect(imp["subjectTelegramUserId"]).toBe(tgId);
  }, 30_000);

  it("AC-P2-20 negative: auth.impersonation absent on user PAT request", async () => {
    const captured: Record<string, unknown>[] = [];
    const captureStream = {
      write: (s: string) => {
        try {
          captured.push(JSON.parse(s) as Record<string, unknown>);
        } catch {
          // ignore non-JSON lines
        }
      },
    };
    const testLogger = pino({ level: "trace" }, captureStream);

    const { plaintext } = await createTestPat(db.prisma, { canImpersonate: false });
    const app = createApp({
      prisma: db.prisma,
      publicExposure: true,
      allowedCidrs: DEFAULT_CIDRS,
      logger: testLogger,
    });

    await request(app)
      .get("/v1/users/me")
      .set("Authorization", `Bearer ${plaintext}`);

    const reqLog = captured.find(
      (l) => typeof l["res"] === "object" && l["res"] !== null,
    );
    expect(reqLog).toBeDefined();
    expect(reqLog!["auth.impersonation"]).toBeUndefined();
  }, 30_000);
});

// ── AC-P2-21: 429 log line includes rejected IP ───────────────────────────────

describe("AC-P2-21 rate-limit 429 log includes rejected IP", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    await db.prisma.personalAccessToken.deleteMany();
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.invite.deleteMany();
    await db.prisma.user.deleteMany();
  });

  it("warn log on 429 contains the rejected IP", async () => {
    const origEnv = process.env.RATE_LIMIT_PER_MIN;
    process.env.RATE_LIMIT_PER_MIN = "1";

    try {
      const captured: Record<string, unknown>[] = [];
      const captureStream = {
        write: (s: string) => {
          try {
            captured.push(JSON.parse(s) as Record<string, unknown>);
          } catch {
            // ignore
          }
        },
      };
      const testLogger = pino({ level: "trace" }, captureStream);

      const { plaintext } = await createTestPat(db.prisma, { canImpersonate: false });
      const app = createApp({
        prisma: db.prisma,
        publicExposure: true,
        allowedCidrs: DEFAULT_CIDRS,
        logger: testLogger,
      });

      // First request consumes the limit.
      await request(app)
        .get("/v1/users/me")
        .set("Authorization", `Bearer ${plaintext}`);

      // Second request should be 429.
      const res = await request(app)
        .get("/v1/users/me")
        .set("Authorization", `Bearer ${plaintext}`);
      expect(res.status).toBe(429);

      // Find the warn log line with "rate limit exceeded".
      const warnLog = captured.find(
        (l) => l["msg"] === "rate limit exceeded" || l["message"] === "rate limit exceeded",
      );
      expect(warnLog).toBeDefined();
      // The IP should be present in the log line.
      expect(warnLog!["ip"]).toBeDefined();
    } finally {
      if (origEnv === undefined) {
        delete process.env.RATE_LIMIT_PER_MIN;
      } else {
        process.env.RATE_LIMIT_PER_MIN = origEnv;
      }
    }
  }, 30_000);
});
