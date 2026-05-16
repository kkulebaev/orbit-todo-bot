import { z } from "zod";

/**
 * API-local input validation schemas.
 *
 * Wire DTOs (TaskDto, UserDto, SessionDto) and request bodies for mutates
 * (CreateTaskInputSchema, UpdateTaskInputSchema, CreateSessionInputSchema,
 * UpdateSessionInputSchema, CommitSessionInputSchema) live in
 * `@orbit/contracts` — import directly from there in route handlers. This
 * file holds only schemas for query strings and URL params that the wire
 * contract does not expose.
 */

export const ListTasksQuerySchema = z.object({
  mode: z.enum(["my", "due-soon"]).default("my"),
  page: z.coerce.number().int().min(0).default(0),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

export const NumIdParamSchema = z.object({
  numId: z.coerce.number().int().positive(),
});
export type NumIdParam = z.infer<typeof NumIdParamSchema>;

export const SessionIdParamSchema = z.object({
  id: z.string().uuid(),
});
export type SessionIdParam = z.infer<typeof SessionIdParamSchema>;

export const LatestSessionQuerySchema = z.object({
  kind: z
    .enum(["editTitle", "addTask", "addTaskDraft", "setDueDate"])
    .optional(),
});
export type LatestSessionQuery = z.infer<typeof LatestSessionQuerySchema>;
