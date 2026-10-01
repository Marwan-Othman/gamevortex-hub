/**
 * One-time fix: resolve an accidental SUPER_ADMIN ownership conflict.
 *
 * seed-production.mjs deliberately REFUSES to auto-fix this situation
 * (see its "conflictingOwner" check) because silently transferring
 * ownership is dangerous. This script is the deliberate, explicit fix:
 * it makes the account with OWNER_EMAIL the only SUPER_ADMIN, and
 * demotes any other account that currently holds that role.
 *
 * Usage (dry run first — makes NO changes, just shows what it would do):
 *   node scripts/fix-owner-conflict.mjs
 *
 * Usage (apply the fix for real):
 *   node scripts/fix-owner-conflict.mjs --apply
 *
 * Run this from the project root where DATABASE_URL is set (e.g. in the
 * Codespace terminal, or `vercel env pull` locally first).
 */
import { PrismaClient, Role } from '@prisma/client';

const db = new PrismaClient();
const apply = process.argv.includes('--apply');

try {
  const targetEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!targetEmail) {
    throw new Error('OWNER_EMAIL is not set in this environment. Set it first (e.g. to marwan.hoshiya.2002@gmail.com), then re-run.');
  }

  const targetUser = await db.user.findUnique({ where: { email: targetEmail } });
  if (!targetUser) {
    throw new Error(`No user found with email ${targetEmail}. That account must already exist (register it first) — this script never creates accounts.`);
  }

  const currentOwners = await db.user.findMany({
    where: { role: Role.SUPER_ADMIN },
    select: { id: true, email: true, username: true },
  });

  const toDemote = currentOwners.filter((u) => u.id !== targetUser.id);
  const targetNeedsPromotion = targetUser.role !== Role.SUPER_ADMIN;

  console.log('--- Current SUPER_ADMIN accounts ---');
  if (!currentOwners.length) console.log('  (none)');
  for (const u of currentOwners) {
    console.log(`  ${u.email} (${u.username || 'no username'})${u.id === targetUser.id ? '  <- intended owner' : '  <- WILL BE DEMOTED'}`);
  }
  console.log('');
  console.log(`Target owner: ${targetEmail} — ${targetNeedsPromotion ? 'needs promotion to SUPER_ADMIN' : 'already SUPER_ADMIN'}`);
  console.log('');

  if (!apply) {
    console.log('Dry run only — no changes made. Re-run with --apply to actually fix this.');
    process.exit(0);
  }

  await db.$transaction(async (tx) => {
    if (targetNeedsPromotion) {
      await tx.user.update({
        where: { id: targetUser.id },
        data: { role: Role.SUPER_ADMIN, sessionVersion: { increment: 1 } },
      });
    }

    for (const u of toDemote) {
      // sessionVersion increment invalidates that account's existing login
      // session immediately, since requireUser() compares it against the
      // token's stored version.
      await tx.user.update({
        where: { id: u.id },
        data: { role: Role.USER, sessionVersion: { increment: 1 } },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: targetUser.id,
        action: 'OWNER_ROLE_CONFLICT_RESOLVED',
        entityType: 'User',
        entityId: targetUser.id,
        metadata: {
          restoredOwnerEmail: targetEmail,
          demotedAccounts: toDemote.map((u) => u.email),
        },
      },
    });
  });

  console.log('Done.');
  console.log(`- ${targetEmail} is now the only SUPER_ADMIN.`);
  if (toDemote.length) {
    console.log(`- Demoted to USER and logged out: ${toDemote.map((u) => u.email).join(', ')}`);
  } else {
    console.log('- No other accounts needed demotion.');
  }
} catch (error) {
  console.error('Fix aborted:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
