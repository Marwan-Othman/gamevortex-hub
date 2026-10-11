import { Prisma } from "@prisma/client";

import { db } from "@/lib/prisma";

const SERIALIZATION_RETRIES = 4;

/**
 * Serializable transactions can be aborted by PostgreSQL (P2034) when two
 * writers touch the same rows - for example a provider that delivers the same
 * webhook twice at the same instant. That is a lost race, not a failure of the
 * operation, so it is retried before the error is surfaced. Because every VIP
 * operation is idempotent, the retry then sees the winner's result and returns
 * it instead of applying anything twice.
 */
export async function runSerializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2034") throw error;
    }
  }
  throw lastError;
}
