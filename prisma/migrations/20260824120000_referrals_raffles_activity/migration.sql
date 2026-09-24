-- Add activity feed event types for the referral reward and raffle (draw) systems.
-- Each ADD VALUE runs as its own statement outside of the value's first use, which is
-- required by PostgreSQL for enum additions.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'REFERRAL_REWARDED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'RAFFLE_ENTERED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'RAFFLE_WON';

-- The Raffle.winnerId column existed with no foreign key; the raffle winner
-- flow now relies on the relation to show/notify the winning user.
CREATE INDEX IF NOT EXISTS "Raffle_winnerId_idx" ON "Raffle"("winnerId");
ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
