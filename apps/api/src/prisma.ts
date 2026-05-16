import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma client.
 *
 * The API is single-replica (AC-9), so we keep one connection pool per
 * process. Routes and middleware import this singleton rather than
 * constructing their own client.
 */
export const prisma = new PrismaClient();
