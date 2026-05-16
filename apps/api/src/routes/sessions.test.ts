/**
 * Integration tests for /v1/sessions routes.
 *
 * Covers: POST, GET /latest, PATCH, DELETE (happy paths + owner-check),
 * and the atomic POST /:id/commit endpoint (AC-25).
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

const API_TOKEN = "sessions-test-token";

describe("sessions routes", () => {
  let db: TestDb;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await startTestDb();
    app = createApp({ apiToken: API_TOKEN, prisma: db.prisma });
  }, 120_000);

  afterAll(async () => {
    await stopTestDb(db);
  });

  beforeEach(async () => {
    await db.prisma.pendingAction.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.invite.deleteMany();
    await db.prisma.user.deleteMany();
  });

  function authHeaders(telegramUserId: string): Record<string, string> {
    return {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Telegram-User-Id": telegramUserId,
    };
  }

  // ---------------------------------------------------------------------------
  // Basic CRUD
  // ---------------------------------------------------------------------------

  it("POST /v1/sessions — creates session and returns SessionDto (201)", async () => {
    const res = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("1"))
      .send({ kind: "editTitle", payload: '{"taskId":42}' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "editTitle",
      payload: '{"taskId":42}',
      id: expect.any(String),
      expiresAt: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it("GET /v1/sessions/latest — returns the most recent session for the viewer", async () => {
    await request(app)
      .post("/v1/sessions")
      .set(authHeaders("2"))
      .send({ kind: "addTask", payload: "draft-payload" });

    const res = await request(app)
      .get("/v1/sessions/latest?kind=addTask")
      .set(authHeaders("2"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "addTask", payload: "draft-payload" });
  });

  it("GET /v1/sessions/latest — 404 when user has no sessions", async () => {
    const res = await request(app)
      .get("/v1/sessions/latest")
      .set(authHeaders("3"));
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/sessions/:id — updates payload for the owner", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("4"))
      .send({ kind: "setDueDate", payload: "original" });
    expect(created.status).toBe(201);
    const { id } = created.body as { id: string };

    const res = await request(app)
      .patch(`/v1/sessions/${id}`)
      .set(authHeaders("4"))
      .send({ payload: "updated" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, payload: "updated" });
  });

  it("DELETE /v1/sessions/:id — 204 for the owner, session is gone", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("5"))
      .send({ kind: "addTask", payload: "x" });
    const { id } = created.body as { id: string };

    const del = await request(app)
      .delete(`/v1/sessions/${id}`)
      .set(authHeaders("5"));
    expect(del.status).toBe(204);

    const after = await request(app)
      .get("/v1/sessions/latest")
      .set(authHeaders("5"));
    expect(after.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Owner-check (AC-4): mismatch → 404
  // ---------------------------------------------------------------------------

  it("PATCH /v1/sessions/:id — 404 for a different user", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("6"))
      .send({ kind: "addTask", payload: "locked" });
    const { id } = created.body as { id: string };

    const res = await request(app)
      .patch(`/v1/sessions/${id}`)
      .set(authHeaders("7")) // different user
      .send({ payload: "stolen" });
    expect(res.status).toBe(404);
  });

  it("DELETE /v1/sessions/:id — 404 for a different user", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("8"))
      .send({ kind: "addTask", payload: "protected" });
    const { id } = created.body as { id: string };

    const res = await request(app)
      .delete(`/v1/sessions/${id}`)
      .set(authHeaders("9"));
    expect(res.status).toBe(404);
  });

  it("POST /v1/sessions/:id/commit — 404 for a different user's session", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("10"))
      .send({ kind: "addTask", payload: "x" });
    const { id } = created.body as { id: string };

    const res = await request(app)
      .post(`/v1/sessions/${id}/commit`)
      .set(authHeaders("11")) // wrong user
      .send({ deleteSession: true });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Atomic commit (AC-25): task update + session delete in one $transaction
  // ---------------------------------------------------------------------------

  it("POST /v1/sessions/:id/commit — atomically updates task title and deletes session", async () => {
    // 1. Create a task via API (telegramUserId "20").
    const taskRes = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("20"))
      .send({ title: "Original title" });
    expect(taskRes.status).toBe(201);
    const taskNumId = (taskRes.body as { numId: number }).numId;

    // 2. Look up the Prisma-level ids for task and owner user.
    const task = await db.prisma.task.findUnique({ where: { numId: taskNumId } });
    expect(task).not.toBeNull();
    const user = await db.prisma.user.findFirst({
      where: { telegramUserId: 20n },
    });
    expect(user).not.toBeNull();

    // 3. Create a PendingAction linked to the task directly via Prisma.
    //    POST /v1/sessions doesn't expose taskId — the bot sets it when
    //    initiating an editTitle / setDueDate flow.
    const session = await db.prisma.pendingAction.create({
      data: {
        kind: "editTitle",
        userId: user!.id,
        taskId: task!.id,
        draftTitle: '{"panelPage":0}',
      },
    });

    // 4. Commit: patch task title + delete session in one transaction.
    const res = await request(app)
      .post(`/v1/sessions/${session.id}/commit`)
      .set(authHeaders("20"))
      .send({
        taskPatch: { title: "Committed title" },
        deleteSession: true,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      numId: taskNumId,
      title: "Committed title",
    });

    // 5. Verify atomicity: session is gone.
    const sessionAfter = await db.prisma.pendingAction.findUnique({
      where: { id: session.id },
    });
    expect(sessionAfter).toBeNull();

    // 6. Verify task was actually updated.
    const taskAfter = await db.prisma.task.findUnique({
      where: { id: task!.id },
    });
    expect(taskAfter?.title).toBe("Committed title");
  });

  it("POST /v1/sessions — links session to a task by taskNumId so a later commit can patch it atomically", async () => {
    // 1. Create a task via API (telegramUserId "40").
    const taskRes = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("40"))
      .send({ title: "Initial title" });
    expect(taskRes.status).toBe(201);
    const taskNumId = (taskRes.body as { numId: number }).numId;

    // 2. Create a session linked to the task via the public POST endpoint.
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("40"))
      .send({
        kind: "editTitle",
        payload: '{"panelPage":0}',
        taskNumId,
      });
    expect(created.status).toBe(201);
    const { id } = created.body as { id: string };

    // 3. Commit with a taskPatch — should atomically update task + delete session.
    const commit = await request(app)
      .post(`/v1/sessions/${id}/commit`)
      .set(authHeaders("40"))
      .send({ taskPatch: { title: "Renamed via session" }, deleteSession: true });
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({ numId: taskNumId, title: "Renamed via session" });

    // 4. Session is gone.
    const after = await db.prisma.pendingAction.findUnique({ where: { id } });
    expect(after).toBeNull();
  });

  it("POST /v1/sessions — 404 when taskNumId belongs to another user", async () => {
    // Owner creates a task.
    const owner = await request(app)
      .post("/v1/tasks")
      .set(authHeaders("50"))
      .send({ title: "Owner's task" });
    expect(owner.status).toBe(201);
    const taskNumId = (owner.body as { numId: number }).numId;

    // A different user tries to attach a session to that task.
    const stolen = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("51"))
      .send({ kind: "editTitle", payload: "x", taskNumId });
    expect(stolen.status).toBe(404);
  });

  it("POST /v1/sessions/:id/commit — without taskPatch deletes session and returns 204", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set(authHeaders("30"))
      .send({ kind: "addTask", payload: "ephemeral" });
    const { id } = created.body as { id: string };

    const res = await request(app)
      .post(`/v1/sessions/${id}/commit`)
      .set(authHeaders("30"))
      .send({ deleteSession: true }); // no taskPatch
    expect(res.status).toBe(204);

    // Session should be gone.
    const after = await db.prisma.pendingAction.findUnique({ where: { id } });
    expect(after).toBeNull();
  });
});
