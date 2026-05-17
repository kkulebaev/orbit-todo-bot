import { z } from "zod";

export const SessionKindSchema = z.enum([
  "editTitle",
  "addTask",
  "addTaskDraft",
  "setDueDate",
]);
export type SessionKind = z.infer<typeof SessionKindSchema>;

// Opaque payload эволюционирует ADDITIVELY (см. AC-23).
// Bot — единственный producer+consumer; API не валидирует payload.
// НЕТ bump-and-clear `v: 1` версионирования.
export const SessionDtoSchema = z.object({
  id: z.string().uuid(),
  kind: SessionKindSchema,
  payload: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type SessionDto = z.infer<typeof SessionDtoSchema>;

export const CreateSessionInputSchema = z.object({
  kind: SessionKindSchema,
  payload: z.string().max(8000),
  /**
   * Optional task association. When provided, the API resolves the task by
   * `numId` (scoped to the viewer) and stores its internal id on the session.
   * Required for later `POST /v1/sessions/:id/commit` calls (which always
   * carry a `taskPatch`).
   */
  taskNumId: z.number().int().positive().optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const UpdateSessionInputSchema = z.object({
  payload: z.string().max(8000).optional(),
});
export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;

export const CommitSessionInputSchema = z.object({
  taskPatch: z.object({
    title: z.string().min(1).max(500).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    dueHasTime: z.boolean().optional(),
    status: z.enum(["open", "done"]).optional(),
  }),
  deleteSession: z.literal(true),
});
export type CommitSessionInput = z.infer<typeof CommitSessionInputSchema>;
