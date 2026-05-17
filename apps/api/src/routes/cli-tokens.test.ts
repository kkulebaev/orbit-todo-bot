/**
 * Integration tests for /v1/cli/tokens routes.
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
import { randomUUID } from "node:crypto";
import { createApp } from "../server.js";
import {
  startTestDb,
  stopTestDb,
  type TestDb,
} from "../test-helpers/postgres.js";
import { createTestPat } from "../test-helpers/pat.js";

describe("cli-tokens routes", () => {
  let db: TestDb;
  let app: ReturnType<typeof createApp>;
  /** Bot-PAT plaintext (canImpersonate=true) — used to mint user PATs. */
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

  // ---------------------------------------------------------------------------
  // POST /v1/cli/tokens — mint
  // ---------------------------------------------------------------------------

  it("POST /v1/cli/tokens — bot-PAT (canImpersonate=true) mints a user PAT (201)", async () => {
    const telegramUserId = "111222333";
    const res = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": telegramUserId,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId, label: "my laptop", ttlDays: 90 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      token: expect.stringMatching(/^orbit_pat_[A-Za-z0-9_-]{43,}$/),
      label: "my laptop",
    });
    expect(res.body.expiresAt).not.toBeNull();
  });

  it("POST /v1/cli/tokens — minted token plaintext matches AC-P2-12 regex", async () => {
    const telegramUserId = "444555666";
    const res = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": telegramUserId,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^orbit_pat_[A-Za-z0-9_-]{43,}$/);
  });

  it("POST /v1/cli/tokens — minted PAT has canImpersonate=false in DB", async () => {
    const telegramUserId = "777888999";
    const res = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": telegramUserId,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId });

    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };

    const row = await db.prisma.personalAccessToken.findUnique({
      where: { id },
    });
    expect(row).not.toBeNull();
    expect(row!.canImpersonate).toBe(false);
  });

  it("POST /v1/cli/tokens — user-PAT (canImpersonate=false) cannot mint → 403", async () => {
    // Create a user PAT (canImpersonate=false)
    const userFixture = await createTestPat(db.prisma, {
      canImpersonate: false,
      label: "user-pat",
    });

    const res = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${userFixture.plaintext}`,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId: String(userFixture.user.telegramUserId) });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { code: "forbidden" },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /v1/cli/tokens — list
  // ---------------------------------------------------------------------------

  it("GET /v1/cli/tokens — returns only the caller's own tokens", async () => {
    const tgA = "10000001";
    const tgB = "10000002";

    // Mint a token for user A — this upserts the user row for tgA.
    const mintA = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": tgA,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId: tgA, label: "tokenA" });
    expect(mintA.status).toBe(201);

    // Mint a token for user B.
    await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": tgB,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId: tgB, label: "tokenB" });

    // Look up the user A row that was upserted by the mint, then create an
    // auth PAT bound to that user id (avoids unique-constraint collision).
    const userA = await db.prisma.user.findUniqueOrThrow({
      where: { telegramUserId: BigInt(tgA) },
    });
    const userAPatFixture = await createTestPat(db.prisma, {
      canImpersonate: false,
      userId: userA.id,
      label: "userA-auth",
    });

    // List as user A — should only see tokenA (not tokenB)
    const res = await request(app)
      .get("/v1/cli/tokens")
      .set({ Authorization: `Bearer ${userAPatFixture.plaintext}` });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All tokens belong to user A
    const labels = (res.body as Array<{ label: string | null }>).map(
      (t) => t.label,
    );
    // tokenA should be there, tokenB should not
    expect(labels).toContain("tokenA");
    expect(labels).not.toContain("tokenB");
  });

  it("GET /v1/cli/tokens — revoked tokens do not appear in list", async () => {
    const telegramUserId = "20000001";

    // Mint a token for the user (upserts the user row).
    const mintRes = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": telegramUserId,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId, label: "to-revoke" });
    expect(mintRes.status).toBe(201);
    const { id: tokenId } = mintRes.body as { id: string };

    // Look up the upserted user and create an auth PAT bound to that user id.
    const user = await db.prisma.user.findUniqueOrThrow({
      where: { telegramUserId: BigInt(telegramUserId) },
    });
    const userPatFixture = await createTestPat(db.prisma, {
      canImpersonate: false,
      userId: user.id,
      label: "user-auth",
    });

    // Revoke the minted token via bot-PAT acting as the user
    // (bot knows the token id, so we revoke via authenticated user-PAT)
    const revokeRes = await request(app)
      .delete(`/v1/cli/tokens/${tokenId}`)
      .set({ Authorization: `Bearer ${userPatFixture.plaintext}` });
    expect(revokeRes.status).toBe(204);

    // List should be empty (revoked token gone)
    const listRes = await request(app)
      .get("/v1/cli/tokens")
      .set({ Authorization: `Bearer ${userPatFixture.plaintext}` });
    expect(listRes.status).toBe(200);
    const ids = (listRes.body as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(tokenId);
  });

  // ---------------------------------------------------------------------------
  // DELETE /v1/cli/tokens/:id — revoke
  // ---------------------------------------------------------------------------

  it("DELETE /v1/cli/tokens/:id — 404 when trying to revoke another user's token", async () => {
    const tgOwner = "30000001";

    // Mint a token for the owner
    const mintRes = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": tgOwner,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId: tgOwner });
    expect(mintRes.status).toBe(201);
    const { id: ownerTokenId } = mintRes.body as { id: string };

    // Create a different user PAT (attacker)
    const attackerFixture = await createTestPat(db.prisma, {
      canImpersonate: false,
      telegramUserId: BigInt("30000002"),
      label: "attacker",
    });

    // Attacker tries to revoke owner's token → 404 (privacy-preserving)
    const res = await request(app)
      .delete(`/v1/cli/tokens/${ownerTokenId}`)
      .set({ Authorization: `Bearer ${attackerFixture.plaintext}` });

    expect(res.status).toBe(404);
  });

  it("DELETE /v1/cli/tokens/:id — revoke is idempotent (second call still 204)", async () => {
    const telegramUserId = "40000001";

    // Mint token (upserts the user row).
    const mintRes = await request(app)
      .post("/v1/cli/tokens")
      .set({
        Authorization: `Bearer ${botPat}`,
        "X-Telegram-User-Id": telegramUserId,
        "Idempotency-Key": randomUUID(),
      })
      .send({ telegramUserId });
    expect(mintRes.status).toBe(201);
    const { id: tokenId } = mintRes.body as { id: string };

    // Look up the upserted user and create an auth PAT bound to that user id.
    const user = await db.prisma.user.findUniqueOrThrow({
      where: { telegramUserId: BigInt(telegramUserId) },
    });
    const userPatFixture = await createTestPat(db.prisma, {
      canImpersonate: false,
      userId: user.id,
      label: "user-auth",
    });

    // First revoke
    const first = await request(app)
      .delete(`/v1/cli/tokens/${tokenId}`)
      .set({ Authorization: `Bearer ${userPatFixture.plaintext}` });
    expect(first.status).toBe(204);

    // Second revoke — idempotent, still 204
    const second = await request(app)
      .delete(`/v1/cli/tokens/${tokenId}`)
      .set({ Authorization: `Bearer ${userPatFixture.plaintext}` });
    expect(second.status).toBe(204);
  });
});
