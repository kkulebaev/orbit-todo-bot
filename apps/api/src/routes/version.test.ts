/**
 * Integration tests for GET /v1/version.
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
import { createApp } from "../server.js";
import {
  startTestDb,
  stopTestDb,
  type TestDb,
} from "../test-helpers/postgres.js";
import { createTestPat } from "../test-helpers/pat.js";

describe("version route", () => {
  let db: TestDb;
  let app: ReturnType<typeof createApp>;
  let botPat: string;

  beforeAll(async () => {
    db = await startTestDb();
    app = createApp({
      prisma: db.prisma,
      allowedCidrs: ["fd00::/8", "::1", "127.0.0.1/32"],
      publicExposure: true,
    });
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.personalAccessToken.deleteMany();
    await db.prisma.user.deleteMany();

    const fixture = await createTestPat(db.prisma, {
      canImpersonate: true,
      label: "test-bot",
    });
    botPat = fixture.plaintext;
  });

  it("GET /v1/version — 200 with schema-valid body when authenticated", async () => {
    const res = await request(app)
      .get("/v1/version")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": "123456789",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      contractsVersion: expect.any(String),
      commit: expect.any(String),
      builtAt: expect.any(String),
    });
    // contractsVersion should not be empty
    expect(res.body.contractsVersion.length).toBeGreaterThan(0);
  });

  it("GET /v1/version — 401 without auth", async () => {
    const res = await request(app).get("/v1/version");
    expect(res.status).toBe(401);
  });
});
