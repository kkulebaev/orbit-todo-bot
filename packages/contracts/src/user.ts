import { z } from "zod";

export const UserDtoSchema = z.object({
  numId: z.number().int(),
  telegramUserId: z.string().regex(/^\d+$/),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;
