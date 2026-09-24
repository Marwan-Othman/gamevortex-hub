import { PrismaClient, Role } from '@prisma/client';
import { createHash, randomBytes, scryptSync } from 'node:crypto';

const db = new PrismaClient();
function hashPassword(password) {
  if (!password || password.length < 12) throw new Error('OWNER_INITIAL_PASSWORD must be at least 12 characters');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

try {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD;
  if (!email || !password) {
    console.log('Production seed: OWNER_EMAIL/OWNER_INITIAL_PASSWORD not set; skipping owner bootstrap.');
    process.exit(0);
  }
  const existingOwners = await db.user.findMany({ where: { role: Role.SUPER_ADMIN }, select: { id: true, email: true } });
  const conflictingOwner = existingOwners.find((u) => u.email !== email);
  if (conflictingOwner) {
    throw new Error('A different SUPER_ADMIN already exists. Refusing to create, replace, or transfer ownership.');
  }
  if (existingOwners.length > 1) {
    throw new Error('Multiple SUPER_ADMIN accounts already exist. Refusing automatic ownership changes; resolve manually before bootstrap.');
  }
  const owner = await db.user.upsert({
    where: { email },
    update: { role: Role.SUPER_ADMIN, sessionVersion: { increment: 1 }, username: process.env.OWNER_USERNAME?.trim() || 'marwan_hoshiya' },
    create: { email, username: process.env.OWNER_USERNAME?.trim() || 'marwan_hoshiya', role: Role.SUPER_ADMIN, passwordHash: hashPassword(password), emailVerifiedAt: new Date() }
  });
  await db.gamerProfile.upsert({ where: { userId: owner.id }, update: { displayName: process.env.OWNER_NAME?.trim() || 'marwan hoshiya' }, create: { userId: owner.id, displayName: process.env.OWNER_NAME?.trim() || 'marwan hoshiya' } });
  await db.ownerWallet.upsert({ where: { ownerId: owner.id }, update: {}, create: { ownerId: owner.id } });
  await db.wallet.upsert({ where: { userId: owner.id }, update: {}, create: { userId: owner.id } });
  console.log(`Production seed: owner ready (${createHash('sha256').update(owner.email).digest('hex').slice(0, 12)}).`);
} finally {
  await db.$disconnect();
}
