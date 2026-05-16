import { z } from "zod";

export const PersonalAccessTokenDtoSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type PersonalAccessTokenDto = z.infer<typeof PersonalAccessTokenDtoSchema>;

export const MintCliTokenInputSchema = z.object({
  telegramUserId: z.string().regex(/^\d+$/),
  label: z.string().max(80).optional(),
  ttlDays: z.number().int().positive().max(3650).optional(),
});
export type MintCliTokenInput = z.infer<typeof MintCliTokenInputSchema>;

export const MintCliTokenResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string().regex(/^orbit_pat_[A-Za-z0-9_-]{43,}$/),
  label: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type MintCliTokenResponse = z.infer<typeof MintCliTokenResponseSchema>;

export const VersionInfoDtoSchema = z.object({
  contractsVersion: z.string(),
  commit: z.string(),
  builtAt: z.string(),
});
export type VersionInfoDto = z.infer<typeof VersionInfoDtoSchema>;
