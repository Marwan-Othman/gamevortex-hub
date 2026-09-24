import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { db?: PrismaClient };
export const db = globalForPrisma.db ?? new PrismaClient();
// Compatibility alias for existing feature modules. New code should prefer `db`.
export const prisma = db;
if (process.env.NODE_ENV !== 'production') globalForPrisma.db = db;
