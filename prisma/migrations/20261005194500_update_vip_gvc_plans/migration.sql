ALTER TABLE "VipPlan"
ADD COLUMN "gvcGrant" INTEGER NOT NULL DEFAULT 0;

UPDATE "VipPlan" SET "priceCents" = 499, "gvcGrant" = 500 WHERE "code" = 'VIP_1M';
UPDATE "VipPlan" SET "priceCents" = 1299, "gvcGrant" = 1800 WHERE "code" = 'VIP_3M';
UPDATE "VipPlan" SET "priceCents" = 1999, "gvcGrant" = 4000 WHERE "code" = 'VIP_6M';
UPDATE "VipPlan" SET "priceCents" = 4999, "gvcGrant" = 10000 WHERE "code" = 'VIP_1Y';
