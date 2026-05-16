/**
 * Unit-level smoke tests for server.ts that do NOT require a real database.
 *
 * All code paths tested here return before touching Prisma:
 *  - /healthz has no auth and no DB interaction
 *  - requireBearer rejects before resolveViewer runs
 *  - resolveViewer rejects missing X-Telegram-User-Id before calling prisma.user.upsert
 *
 * So we pass a stub `{}` cast as PrismaClient to createApp.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "./server.js";

const API_TOKEN = "test-secret-token";
const app = createApp({
  apiToken: API_TOKEN,
  prisma: {} as unknown as PrismaClient,
});

describe("GET /healthz", () => {
  it("returns 200 { ok, service } without any auth", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "api" });
  });
});

describe("auth middleware — requireBearer", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const res = await request(app).get("/v1/tasks");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed Authorization header (no Bearer prefix)", async () => {
    const res = await request(app)
      .get("/v1/tasks")
      .set("Authorization", API_TOKEN);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a wrong Bearer token", async () => {
    const res = await request(app)
      .get("/v1/tasks")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });
});

describe("auth middleware — resolveViewer", () => {
  it("returns 401 when X-Telegram-User-Id is absent (correct Bearer)", async () => {
    // Correct Bearer passes requireBearer but resolveViewer rejects the missing
    // identity header before calling prisma.user.upsert (no DB needed here).
    const res = await request(app)
      .get("/v1/tasks")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Telegram-User-Id is non-numeric", async () => {
    const res = await request(app)
      .get("/v1/tasks")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .set("X-Telegram-User-Id", "not-a-number");
    expect(res.status).toBe(401);
  });
});
