import { z } from "zod";

export const TaskStatusSchema = z.enum(["open", "done"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskDtoSchema = z.object({
  numId: z.number().int().positive(),
  title: z.string().min(1).max(500),
  status: TaskStatusSchema,
  dueAt: z.string().datetime().nullable(),
  dueHasTime: z.boolean(),
  createdAt: z.string().datetime(),
  doneAt: z.string().datetime().nullable(),
  createdByNumId: z.number().int(),
  assignedToNumId: z.number().int(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(500),
  dueAt: z.string().datetime().nullable().optional(),
  dueHasTime: z.boolean().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  status: TaskStatusSchema.optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const TaskListResponseSchema = z.object({
  items: z.array(TaskDtoSchema),
  page: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
