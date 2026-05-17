import { describe, it, expect } from "vitest";
import { TaskDtoSchema, CreateTaskInputSchema, UpdateTaskInputSchema } from "./task.js";
import { UserDtoSchema } from "./user.js";
import { SessionDtoSchema, CommitSessionInputSchema, CreateSessionInputSchema } from "./session.js";
import { ApiErrorBodySchema } from "./errors.js";

describe("TaskDtoSchema", () => {
  const validTask = {
    numId: 1,
    title: "Buy milk",
    status: "open" as const,
    dueAt: null,
    dueHasTime: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    doneAt: null,
    createdByNumId: 1,
    assignedToNumId: 1,
  };

  it("parses a valid TaskDto", () => {
    const result = TaskDtoSchema.safeParse(validTask);
    expect(result.success).toBe(true);
  });

  it("rejects TaskDto with empty title", () => {
    const result = TaskDtoSchema.safeParse({ ...validTask, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects TaskDto with invalid status", () => {
    const result = TaskDtoSchema.safeParse({ ...validTask, status: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects TaskDto with numId = 0 (must be positive)", () => {
    const result = TaskDtoSchema.safeParse({ ...validTask, numId: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts TaskDto with dueAt as ISO datetime string", () => {
    const result = TaskDtoSchema.safeParse({
      ...validTask,
      dueAt: "2024-12-31T23:59:59.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects TaskDto with dueAt as non-datetime string", () => {
    const result = TaskDtoSchema.safeParse({ ...validTask, dueAt: "not-a-date" });
    expect(result.success).toBe(false);
  });
});

describe("CreateTaskInputSchema", () => {
  it("accepts minimal valid input", () => {
    const result = CreateTaskInputSchema.safeParse({ title: "Buy milk" });
    expect(result.success).toBe(true);
  });

  it("rejects input with title exceeding 500 chars", () => {
    const result = CreateTaskInputSchema.safeParse({ title: "x".repeat(501) });
    expect(result.success).toBe(false);
  });
});

describe("UpdateTaskInputSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = UpdateTaskInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts status change to done", () => {
    const result = UpdateTaskInputSchema.safeParse({ status: "done" });
    expect(result.success).toBe(true);
  });
});

describe("UserDtoSchema", () => {
  it("parses a valid UserDto", () => {
    const result = UserDtoSchema.safeParse({
      numId: 1,
      telegramUserId: "123456789",
    });
    expect(result.success).toBe(true);
  });

  it("rejects telegramUserId with non-digit characters", () => {
    const result = UserDtoSchema.safeParse({
      numId: 1,
      telegramUserId: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects telegramUserId as empty string", () => {
    const result = UserDtoSchema.safeParse({
      numId: 1,
      telegramUserId: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("SessionDtoSchema", () => {
  const validSession = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    kind: "editTitle" as const,
    payload: '{"taskId":42,"panelMessageId":100}',
    expiresAt: "2024-01-01T01:00:00.000Z",
    createdAt: "2024-01-01T00:00:00.000Z",
  };

  it("parses a valid SessionDto", () => {
    const result = SessionDtoSchema.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  it("accepts any string as payload (opaque, no versioning)", () => {
    const result = SessionDtoSchema.safeParse({ ...validSession, payload: "any-arbitrary-string" });
    expect(result.success).toBe(true);
  });

  it("rejects SessionDto with invalid UUID", () => {
    const result = SessionDtoSchema.safeParse({ ...validSession, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects SessionDto with unknown kind", () => {
    const result = SessionDtoSchema.safeParse({ ...validSession, kind: "unknownKind" });
    expect(result.success).toBe(false);
  });
});

describe("CommitSessionInputSchema", () => {
  it("requires deleteSession: true (literal)", () => {
    const result = CommitSessionInputSchema.safeParse({ deleteSession: true });
    expect(result.success).toBe(true);
  });

  it("rejects if deleteSession is false", () => {
    const result = CommitSessionInputSchema.safeParse({ deleteSession: false });
    expect(result.success).toBe(false);
  });

  it("accepts optional taskPatch", () => {
    const result = CommitSessionInputSchema.safeParse({
      deleteSession: true,
      taskPatch: { title: "New title", status: "done" },
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateSessionInputSchema", () => {
  it("defaults ttlSeconds to 3600", () => {
    const result = CreateSessionInputSchema.safeParse({
      kind: "addTask",
      payload: "{}",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ttlSeconds).toBe(3600);
    }
  });

  it("rejects payload exceeding 8000 chars", () => {
    const result = CreateSessionInputSchema.safeParse({
      kind: "addTask",
      payload: "x".repeat(8001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects ttlSeconds below minimum (60)", () => {
    const result = CreateSessionInputSchema.safeParse({
      kind: "addTask",
      payload: "{}",
      ttlSeconds: 30,
    });
    expect(result.success).toBe(false);
  });
});

describe("ApiErrorBodySchema", () => {
  it("parses a valid error body", () => {
    const result = ApiErrorBodySchema.safeParse({
      error: { code: "NOT_FOUND", message: "Task not found" },
    });
    expect(result.success).toBe(true);
  });

  it("parses error body with optional details", () => {
    const result = ApiErrorBodySchema.safeParse({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: { field: "title", reason: "too short" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects error body missing code field", () => {
    const result = ApiErrorBodySchema.safeParse({
      error: { message: "oops" },
    });
    expect(result.success).toBe(false);
  });
});
