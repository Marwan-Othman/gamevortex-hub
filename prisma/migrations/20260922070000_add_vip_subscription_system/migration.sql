/*
  GameVortex Hub
  VIP Subscription System
  Safe production migration

  IMPORTANT:
  The VIP tables may already exist in the production database.
  Therefore this migration is intentionally idempotent.

  FIX (applied):
  The original migration referenced the enum type "PaymentStatus" in the
  VipPurchase table definition, but never created it. That caused
  Postgres to fail with "type PaymentStatus does not exist" partway
  through the migration, which produced Prisma error P3009.
  The missing enum is now created below, before it is used.
*/

-- =========================================================
-- ENUMS
-- =========================================================

DO $$
BEGIN
  CREATE TYPE "VipSubscriptionStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'EXPIRED',
    'CANCELED',
    'REFUNDED',
    'PAYMENT_FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "VipSubscriptionEventType" AS ENUM (
    'CREATED',
    'PAYMENT_SUCCEEDED',
    'PAYMENT_FAILED',
    'ACTIVATED',
    'RENEWED',
    'UPGRADED',
    'CANCELED',
    'EXPIRED',
    'REFUNDED',
    'CREDITS_RESET'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "AiUsageType" AS ENUM (
    'CHAT',
    'IMAGE',
    'VIDEO'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;

-- NEW: this type was missing from the original migration and caused
-- the P3009 failure when creating VipPurchase further below.
DO $$
BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM (
    'CREATED',
    'PENDING',
    'PAID',
    'FAILED',
    'REFUNDED',
    'CANCELED'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;


-- =========================================================
-- VIP PLAN
-- =========================================================

CREATE TABLE IF NOT EXISTS "VipPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "durationMonths" INTEGER,
  "pointsMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
  "chatCredits" INTEGER NOT NULL DEFAULT 0,
  "imageCredits" INTEGER NOT NULL DEFAULT 0,
  "videoCredits" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VipPlan_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING VIPPLAN COMPATIBILITY
-- =========================================================
-- The production database may already contain VipPlan from an earlier
-- version of the VIP system. Ensure the column used by the new index exists.
DO $$
BEGIN
  IF to_regclass('"VipPlan"') IS NOT NULL THEN
    ALTER TABLE "VipPlan"
      ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipPlan_code_key"
ON "VipPlan"("code");

CREATE INDEX IF NOT EXISTS
  "VipPlan_active_sortOrder_idx"
ON "VipPlan"("active", "sortOrder");


-- =========================================================
-- VIP SUBSCRIPTION
-- =========================================================

CREATE TABLE IF NOT EXISTS "VipSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "VipSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "paymentId" TEXT,
  "provider" TEXT,
  "providerSubscriptionId" TEXT,
  "chatCredits" INTEGER NOT NULL DEFAULT 0,
  "imageCredits" INTEGER NOT NULL DEFAULT 0,
  "videoCredits" INTEGER NOT NULL DEFAULT 0,
  "lastRewardAt" TIMESTAMP(3),
  "nextRewardAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VipSubscription_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING VIPSUBSCRIPTION COMPATIBILITY
-- =========================================================
-- The production database may already contain VipSubscription from an
-- earlier, differently-shaped version of the VIP system. Ensure every
-- column referenced by the indexes/constraints below actually exists.
DO $$
BEGIN
  IF to_regclass('"VipSubscription"') IS NOT NULL THEN
    ALTER TABLE "VipSubscription"
      ADD COLUMN IF NOT EXISTS "status" "VipSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "paymentId" TEXT,
      ADD COLUMN IF NOT EXISTS "provider" TEXT,
      ADD COLUMN IF NOT EXISTS "providerSubscriptionId" TEXT,
      ADD COLUMN IF NOT EXISTS "chatCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "imageCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "videoCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "lastRewardAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "nextRewardAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipSubscription_paymentId_key"
ON "VipSubscription"("paymentId");

CREATE INDEX IF NOT EXISTS
  "VipSubscription_userId_status_expiresAt_idx"
ON "VipSubscription"("userId", "status", "expiresAt");

CREATE INDEX IF NOT EXISTS
  "VipSubscription_planId_status_idx"
ON "VipSubscription"("planId", "status");

CREATE INDEX IF NOT EXISTS
  "VipSubscription_expiresAt_status_idx"
ON "VipSubscription"("expiresAt", "status");

CREATE INDEX IF NOT EXISTS
  "VipSubscription_provider_providerSubscriptionId_idx"
ON "VipSubscription"("provider", "providerSubscriptionId");


-- =========================================================
-- SUBSCRIPTION EVENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS "VipSubscriptionEvent" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "type" "VipSubscriptionEventType" NOT NULL,
  "provider" TEXT,
  "providerEventId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VipSubscriptionEvent_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING VIPSUBSCRIPTIONEVENT COMPATIBILITY
-- =========================================================
DO $$
BEGIN
  IF to_regclass('"VipSubscriptionEvent"') IS NOT NULL THEN
    ALTER TABLE "VipSubscriptionEvent"
      ADD COLUMN IF NOT EXISTS "provider" TEXT,
      ADD COLUMN IF NOT EXISTS "providerEventId" TEXT,
      ADD COLUMN IF NOT EXISTS "metadata" JSONB,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipSubscriptionEvent_provider_providerEventId_key"
ON "VipSubscriptionEvent"("provider", "providerEventId");

CREATE INDEX IF NOT EXISTS
  "VipSubscriptionEvent_subscriptionId_createdAt_idx"
ON "VipSubscriptionEvent"("subscriptionId", "createdAt");

CREATE INDEX IF NOT EXISTS
  "VipSubscriptionEvent_type_createdAt_idx"
ON "VipSubscriptionEvent"("type", "createdAt");


-- =========================================================
-- AI USAGE
-- =========================================================

CREATE TABLE IF NOT EXISTS "AiUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "type" "AiUsageType" NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiUsage_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING AIUSAGE COMPATIBILITY
-- =========================================================
DO $$
BEGIN
  IF to_regclass('"AiUsage"') IS NOT NULL THEN
    ALTER TABLE "AiUsage"
      ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT,
      ADD COLUMN IF NOT EXISTS "amount" INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "metadata" JSONB,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "AiUsage_idempotencyKey_key"
ON "AiUsage"("idempotencyKey");

CREATE INDEX IF NOT EXISTS
  "AiUsage_userId_type_createdAt_idx"
ON "AiUsage"("userId", "type", "createdAt");

CREATE INDEX IF NOT EXISTS
  "AiUsage_subscriptionId_type_createdAt_idx"
ON "AiUsage"("subscriptionId", "type", "createdAt");


-- =========================================================
-- VIP REWARDS
-- =========================================================

CREATE TABLE IF NOT EXISTS "VipReward" (
  "id" TEXT NOT NULL,
  "planId" TEXT,
  "code" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "chatCredits" INTEGER NOT NULL DEFAULT 0,
  "imageCredits" INTEGER NOT NULL DEFAULT 0,
  "videoCredits" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VipReward_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING VIPREWARD COMPATIBILITY
-- =========================================================
DO $$
BEGIN
  IF to_regclass('"VipReward"') IS NOT NULL THEN
    ALTER TABLE "VipReward"
      ADD COLUMN IF NOT EXISTS "planId" TEXT,
      ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "chatCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "imageCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "videoCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "metadata" JSONB,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipReward_code_key"
ON "VipReward"("code");

CREATE INDEX IF NOT EXISTS
  "VipReward_planId_active_idx"
ON "VipReward"("planId", "active");


-- =========================================================
-- VIP REWARD CLAIMS
-- =========================================================

CREATE TABLE IF NOT EXISTS "VipRewardClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "points" INTEGER NOT NULL DEFAULT 0,
  "chatCredits" INTEGER NOT NULL DEFAULT 0,
  "imageCredits" INTEGER NOT NULL DEFAULT 0,
  "videoCredits" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,

  CONSTRAINT "VipRewardClaim_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING VIPREWARDCLAIM COMPATIBILITY
-- =========================================================
DO $$
BEGIN
  IF to_regclass('"VipRewardClaim"') IS NOT NULL THEN
    ALTER TABLE "VipRewardClaim"
      ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT,
      ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "chatCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "imageCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "videoCredits" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "metadata" JSONB;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipRewardClaim_idempotencyKey_key"
ON "VipRewardClaim"("idempotencyKey");

CREATE INDEX IF NOT EXISTS
  "VipRewardClaim_userId_claimedAt_idx"
ON "VipRewardClaim"("userId", "claimedAt");

CREATE INDEX IF NOT EXISTS
  "VipRewardClaim_rewardId_claimedAt_idx"
ON "VipRewardClaim"("rewardId", "claimedAt");


-- =========================================================
-- VIP PURCHASE
-- =========================================================

CREATE TABLE IF NOT EXISTS "VipPurchase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VipPurchase_pkey"
    PRIMARY KEY ("id")
);

-- =========================================================
-- EXISTING VIPPURCHASE COMPATIBILITY
-- =========================================================
DO $$
BEGIN
  IF to_regclass('"VipPurchase"') IS NOT NULL THEN
    ALTER TABLE "VipPurchase"
      ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
      ADD COLUMN IF NOT EXISTS "metadata" JSONB,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipPurchase_subscriptionId_key"
ON "VipPurchase"("subscriptionId");

CREATE UNIQUE INDEX IF NOT EXISTS
  "VipPurchase_provider_providerPaymentId_key"
ON "VipPurchase"("provider", "providerPaymentId");

CREATE INDEX IF NOT EXISTS
  "VipPurchase_userId_createdAt_idx"
ON "VipPurchase"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS
  "VipPurchase_status_createdAt_idx"
ON "VipPurchase"("status", "createdAt");


-- =========================================================
-- FOREIGN KEYS
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipSubscription_userId_fkey'
  ) THEN

    ALTER TABLE "VipSubscription"
      ADD CONSTRAINT
        "VipSubscription_userId_fkey"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipSubscription_planId_fkey'
  ) THEN

    ALTER TABLE "VipSubscription"
      ADD CONSTRAINT
        "VipSubscription_planId_fkey"
      FOREIGN KEY ("planId")
      REFERENCES "VipPlan"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipSubscriptionEvent_subscriptionId_fkey'
  ) THEN

    ALTER TABLE "VipSubscriptionEvent"
      ADD CONSTRAINT
        "VipSubscriptionEvent_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId")
      REFERENCES "VipSubscription"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'AiUsage_userId_fkey'
  ) THEN

    ALTER TABLE "AiUsage"
      ADD CONSTRAINT
        "AiUsage_userId_fkey"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'AiUsage_subscriptionId_fkey'
  ) THEN

    ALTER TABLE "AiUsage"
      ADD CONSTRAINT
        "AiUsage_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId")
      REFERENCES "VipSubscription"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipReward_planId_fkey'
  ) THEN

    ALTER TABLE "VipReward"
      ADD CONSTRAINT
        "VipReward_planId_fkey"
      FOREIGN KEY ("planId")
      REFERENCES "VipPlan"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipRewardClaim_userId_fkey'
  ) THEN

    ALTER TABLE "VipRewardClaim"
      ADD CONSTRAINT
        "VipRewardClaim_userId_fkey"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipRewardClaim_rewardId_fkey'
  ) THEN

    ALTER TABLE "VipRewardClaim"
      ADD CONSTRAINT
        "VipRewardClaim_rewardId_fkey"
      FOREIGN KEY ("rewardId")
      REFERENCES "VipReward"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipRewardClaim_subscriptionId_fkey'
  ) THEN

    ALTER TABLE "VipRewardClaim"
      ADD CONSTRAINT
        "VipRewardClaim_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId")
      REFERENCES "VipSubscription"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipPurchase_userId_fkey'
  ) THEN

    ALTER TABLE "VipPurchase"
      ADD CONSTRAINT
        "VipPurchase_userId_fkey"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;

  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'VipPurchase_subscriptionId_fkey'
  ) THEN

    ALTER TABLE "VipPurchase"
      ADD CONSTRAINT
        "VipPurchase_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId")
      REFERENCES "VipSubscription"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;

  END IF;
END
$$;


-- =========================================================
-- DEFAULT VIP PLANS
-- =========================================================

INSERT INTO "VipPlan" (
  "id",
  "code",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "priceCents",
  "currency",
  "durationMonths",
  "pointsMultiplier",
  "chatCredits",
  "imageCredits",
  "videoCredits",
  "active",
  "sortOrder",
  "updatedAt"
)
VALUES
(
  'vip_plan_free',
  'FREE',
  'مجاني',
  'Free',
  'الباقة المجانية',
  'Free plan',
  0,
  'USD',
  NULL,
  1.00,
  100,
  10,
  2,
  true,
  0,
  CURRENT_TIMESTAMP
),
(
  'vip_plan_1m',
  'VIP_1M',
  'VIP شهر',
  'VIP 1 Month',
  'عضوية VIP لمدة شهر',
  'VIP membership for 1 month',
  299,
  'USD',
  1,
  1.25,
  500,
  50,
  5,
  true,
  1,
  CURRENT_TIMESTAMP
),
(
  'vip_plan_3m',
  'VIP_3M',
  'VIP 3 أشهر',
  'VIP 3 Months',
  'عضوية VIP لمدة ثلاثة أشهر',
  'VIP membership for 3 months',
  749,
  'USD',
  3,
  1.50,
  1500,
  180,
  15,
  true,
  2,
  CURRENT_TIMESTAMP
),
(
  'vip_plan_6m',
  'VIP_6M',
  'VIP 6 أشهر',
  'VIP 6 Months',
  'عضوية VIP لمدة ستة أشهر',
  'VIP membership for 6 months',
  1999,
  'USD',
  6,
  1.75,
  5000,
  500,
  40,
  true,
  3,
  CURRENT_TIMESTAMP
),
(
  'vip_plan_1y',
  'VIP_1Y',
  'VIP سنة',
  'VIP 1 Year',
  'عضوية VIP لمدة سنة',
  'VIP membership for 1 year',
  4999,
  'USD',
  12,
  2.00,
  12000,
  1200,
  100,
  true,
  4,
  CURRENT_TIMESTAMP
),
(
  'vip_plan_owner',
  'OWNER',
  'Owner VIP',
  'Owner VIP',
  'عضوية المالك الدائمة',
  'Permanent owner VIP',
  0,
  'USD',
  NULL,
  1.00,
  0,
  0,
  0,
  true,
  99,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code")
DO UPDATE SET
  "nameAr" =
    EXCLUDED."nameAr",
  "nameEn" =
    EXCLUDED."nameEn",
  "descriptionAr" =
    EXCLUDED."descriptionAr",
  "descriptionEn" =
    EXCLUDED."descriptionEn",
  "priceCents" =
    EXCLUDED."priceCents",
  "currency" =
    EXCLUDED."currency",
  "durationMonths" =
    EXCLUDED."durationMonths",
  "pointsMultiplier" =
    EXCLUDED."pointsMultiplier",
  "chatCredits" =
    EXCLUDED."chatCredits",
  "imageCredits" =
    EXCLUDED."imageCredits",
  "videoCredits" =
    EXCLUDED."videoCredits",
  "active" =
    EXCLUDED."active",
  "sortOrder" =
    EXCLUDED."sortOrder",
  "updatedAt" =
    CURRENT_TIMESTAMP;
