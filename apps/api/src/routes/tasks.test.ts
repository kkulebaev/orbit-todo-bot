/**
 * Integration tests for /v1/tasks routes.
 *
 * Each `describe` block runs against a dedicated PostgreSQL testcontainer so
 * DB state is fully isolated from other test files. Rows are wiped in
 * `beforeEach` to isolate individual tests within this file.
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

describe("tasks routes", () => {
  let db: TestDb;
  let app: ReturnType<typeof createApp>;
  /** Bot-PAT plaintext for impersonation-style auth (canImpersonate=true). */
  let botPat: string;

  beforeAll(async () => {
    db = await startTestDb();
    app = createApp({
      prisma: db.prisma,
      allowedCidrs: ["fd00::/8", "::1", "127.0.0.1/32"],
    });
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    // Delete in FK-safe order: child tables first.
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.personalAccessToken.deleteMany();
    await db.prisma.invite.deleteMany();
    await db.prisma.user.deleteMany();

    // Mint a fresh bot PAT per test. canImpersonate=true so the
    // X-Telegram-User-Id header is honored (matches bot-on-behalf-of-user
    // request shape, same semantics as the pre-P2 service-token + header).
    const fixture = await createTestPat(db.prisma, {
      canImpersonate: true,
      label: "test-bot",
    });
    botPat = fixture.plaintext;
  });

  /** Build standard auth headers for a given Telegram user id. */
  function authHeaders(
    telegramUserId: string,
    extra?: Record<string, string>,
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${botPat}`,
      "X-Telegram-User-Id": telegramUserId,
      ...extra,
    };
  }

  // ---------------------------------------------------------------------------
  // Basic CRUD
  // ---------------------------------------------------------------------------

  it("GET /v1/tasks — returns empty list when user has no tasks", async () => {
    const res = await request(app)
      .get("/v1/tasks")
      .set(authHeaders("100"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], page: 0, total: 0 });
  });

  it("POST /v1/tasks — creates a task and returns TaskDto (201)", async () => {
    const res = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("101"))
      .send({ title: "Buy groceries" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Buy groceries",
      status: "open",
      numId: expect.any(Number),
      createdAt: expect.any(String),
      doneAt: null,
      dueAt: null,
      dueHasTime: false,
    });
  });

  it("GET /v1/tasks/:numId — 200 for the owner", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("200"))
      .send({ title: "My task" });
    expect(created.status).toBe(201);
    const { numId } = created.body as { numId: number };

    const res = await request(app)
      .get(`/v1/tasks/${numId}`)
      .set(authHeaders("200"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ numId, title: "My task" });
  });

  it("PATCH /v1/tasks/:numId — updates title for the owner", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("201"))
      .send({ title: "Old title" });
    const { numId } = created.body as { numId: number };

    const res = await request(app)
      .patch(`/v1/tasks/${numId}`)
      .set(authHeaders("201"))
      .send({ title: "New title" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ numId, title: "New title" });
  });

  it("DELETE /v1/tasks/:numId — 204 for the owner", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("202"))
      .send({ title: "To remove" });
    const { numId } = created.body as { numId: number };

    const del = await request(app)
      .delete(`/v1/tasks/${numId}`)
      .set(authHeaders("202"));
    expect(del.status).toBe(204);

    // Confirm it's gone
    const get = await request(app)
      .get(`/v1/tasks/${numId}`)
      .set(authHeaders("202"));
    expect(get.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Owner-check (AC-4, AC-5): mismatch always yields 404, never 403
  // ---------------------------------------------------------------------------

  it("GET /v1/tasks/:numId — 404 for a different user (owner-check)", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("300"))
      .send({ title: "User A task" });
    const { numId } = created.body as { numId: number };

    const res = await request(app)
      .get(`/v1/tasks/${numId}`)
      .set(authHeaders("301")); // User B
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/tasks/:numId — 404 for a different user", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("400"))
      .send({ title: "Locked" });
    const { numId } = created.body as { numId: number };

    const res = await request(app)
      .patch(`/v1/tasks/${numId}`)
      .set(authHeaders("401"))
      .send({ title: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("DELETE /v1/tasks/:numId — 404 for a different user", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("500"))
      .send({ title: "Protected" });
    const { numId } = created.body as { numId: number };

    const res = await request(app)
      .delete(`/v1/tasks/${numId}`)
      .set(authHeaders("501"));
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Cascade delete (AC-22): deleting a Task removes its PendingAction rows
  // ---------------------------------------------------------------------------

  it("DELETE /v1/tasks/:numId — cascades to linked PendingAction rows", async () => {
    const created = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("600"))
      .send({ title: "Will cascade" });
    expect(created.status).toBe(201);
    const { numId } = created.body as { numId: number };

    const task = await db.prisma.task.findUnique({ where: { numId } });
    expect(task).not.toBeNull();

    // Create a PendingAction referencing this task directly via Prisma.
    // (The POST /v1/sessions API doesn't expose taskId; the bot sets it.)
    await db.prisma.pendingAction.create({
      data: {
        kind: "editTitle",
        userId: task!.assignedToId,
        taskId: task!.id,
      },
    });
    expect(
      await db.prisma.pendingAction.count({ where: { taskId: task!.id } }),
    ).toBe(1);

    const del = await request(app)
      .delete(`/v1/tasks/${numId}`)
      .set(authHeaders("600"));
    expect(del.status).toBe(204);

    // PendingAction should be gone via ON DELETE CASCADE.
    expect(
      await db.prisma.pendingAction.count({ where: { taskId: task!.id } }),
    ).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Idempotency (AC-6): duplicate POST with same Idempotency-Key = one DB write
  // ---------------------------------------------------------------------------

  it("POST /v1/tasks — duplicate Idempotency-Key returns cached 201, only one row written", async () => {
    const idempotencyKey = randomUUID();

    const first = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("700", { "Idempotency-Key": idempotencyKey }))
      .send({ title: "Idempotent" });
    expect(first.status).toBe(201);

    // Second call: same key, intentionally different body.
    const second = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("700", { "Idempotency-Key": idempotencyKey }))
      .send({ title: "Should be ignored" });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body); // identical cached response

    // Exactly one task persisted in DB.
    const count = await db.prisma.task.count();
    expect(count).toBe(1);
  });
});
