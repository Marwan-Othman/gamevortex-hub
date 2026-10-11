import type { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import { db } from "./prisma";


/**
 * Deterministic lookup of the owner account used for revenue/points credits.
 * Prefers the SUPER_ADMIN whose email matches OWNER_EMAIL; otherwise falls back to the
 * oldest SUPER_ADMIN so the result never depends on arbitrary row order.
 * This is for crediting only, NOT an authorization check (see requireOwner in ./auth).
 */
export async function findOwnerAccount(client: Prisma.TransactionClient = db): Promise<{ id: string } | null> {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();

  if (email) {
    const byEmail = await client.user.findFirst({
      where: { role: Role.SUPER_ADMIN, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (byEmail) return byEmail;
  }

  return client.user.findFirst({
    where: { role: Role.SUPER_ADMIN },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}
