-- CreateTable baseline generated from prisma/schema.prisma

CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'STAFF', 'USER');
CREATE TYPE "SourceStatus" AS ENUM ('VERIFIED', 'NEEDS_SOURCE', 'PENDING_REVIEW', 'UNPUBLISHED', 'OFFICIAL_SOURCE', 'NEEDS_LICENSE', 'STREAM_ONLY');
CREATE TYPE "LibraryStatus" AS ENUM ('WANT', 'PLAYING', 'BEATEN', 'ARCHIVED');
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'PENDING', 'PROCESSING', 'PAID', 'SETTLED', 'FAILED', 'REJECTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "LedgerType" AS ENUM ('CREDIT_POINTS', 'CREDIT_REVENUE', 'DEBIT_PAYOUT', 'REFUND', 'REVERSAL', 'ADJUSTMENT', 'PENDING', 'SETTLED', 'POINTS_WITHDRAWAL_REQUESTED', 'POINTS_RESERVED', 'POINTS_DEBITED', 'PAYOUT_PENDING', 'PAYOUT_SETTLED', 'PAYOUT_FAILED', 'POINTS_RETURNED');
CREATE TYPE "AchievementRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');
CREATE TYPE "ActivityType" AS ENUM ('FAVORITED_GAME', 'WISHLISTED_GAME', 'REVIEWED_GAME', 'ADDED_TO_LIBRARY', 'COMPLETED_GAME', 'ACHIEVEMENT_UNLOCKED', 'LEVEL_UP');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLING', 'COMPLETED', 'REFUNDED', 'CANCELLED', 'FAILED');
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'REFUNDED');
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'ABUSE', 'FRAUD', 'COPYRIGHT', 'NSFW', 'MISLEADING', 'OTHER');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "username" TEXT,
  "role" "Role" NOT NULL DEFAULT 'USER',
  "passwordHash" TEXT,
  "emailVerifiedAt" TIMESTAMP(3),
  "points" INTEGER NOT NULL DEFAULT 0,
  "ownerPoints" INTEGER NOT NULL DEFAULT 0,
  "wallet" TEXT,
  "ownerWallet" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "gamerProfile" TEXT,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");
CREATE UNIQUE INDEX "User_username_key" ON "User" ("username");

CREATE TABLE "Wallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pendingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet" ("userId");

CREATE TABLE "OwnerWallet" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "availablePoints" INTEGER NOT NULL DEFAULT 0,
  "pendingPoints" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerWallet_ownerId_key" ON "OwnerWallet" ("ownerId");

CREATE TABLE "OwnerLedger" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "type" "LedgerType" NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "usdAmount" DECIMAL(18,2),
  "currency" TEXT,
  "conversionRate" INTEGER,
  "withdrawalId" TEXT,
  "provider" TEXT,
  "providerTransactionId" TEXT,
  "transactionHash" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerLedger_idempotencyKey_key" ON "OwnerLedger" ("idempotencyKey");

CREATE TABLE "Game" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "titleAr" TEXT NOT NULL,
  "titleEn" TEXT NOT NULL,
  "description" TEXT,
  "platform" TEXT,
  "genre" TEXT,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "discountPercent" INTEGER NOT NULL DEFAULT 0,
  "coverUrl" TEXT,
  "officialUrl" TEXT,
  "downloadSource" TEXT,
  "sourceStatus" "SourceStatus" NOT NULL DEFAULT 'NEEDS_SOURCE',
  "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "playCount" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "published" BOOLEAN NOT NULL DEFAULT FALSE,
  "featured" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Game_slug_key" ON "Game" ("slug");

CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "text" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Review_userId_gameId_key" ON "Review" ("userId", "gameId");
CREATE INDEX "Review_gameId_rating_idx" ON "Review" ("gameId", "rating");
CREATE INDEX "Review_userId_createdAt_idx" ON "Review" ("userId", "createdAt");

CREATE TABLE "GameLibraryItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "status" "LibraryStatus" NOT NULL DEFAULT 'WANT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameLibraryItem_userId_gameId_key" ON "GameLibraryItem" ("userId", "gameId");
CREATE INDEX "GameLibraryItem_userId_status_updatedAt_idx" ON "GameLibraryItem" ("userId", "status", "updatedAt");
CREATE INDEX "GameLibraryItem_gameId_status_idx" ON "GameLibraryItem" ("gameId", "status");

CREATE TABLE "WithdrawalRequest" (
  "id" TEXT NOT NULL,
  "ownerWalletId" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "usdAmount" DECIMAL(18,2) NOT NULL,
  "conversionRate" INTEGER NOT NULL DEFAULT 30,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "provider" TEXT,
  "providerTransactionId" TEXT,
  "transactionHash" TEXT,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
  "failureReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WithdrawalRequest_idempotencyKey_key" ON "WithdrawalRequest" ("idempotencyKey");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "ip" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog" ("entityType", "entityId");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog" ("actorUserId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");

CREATE TABLE "QuranReciter" (
  "id" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "riwayah" TEXT,
  "style" TEXT,
  "quality" TEXT,
  "provider" TEXT NOT NULL,
  "legalSourceUrl" TEXT NOT NULL,
  "licenseUrl" TEXT,
  "licenseStatus" TEXT NOT NULL,
  "sourceVerificationStatus" "SourceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "verificationDate" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "audioBaseUrl" TEXT NOT NULL,
  "availableSurahs" JSONB,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "QuranReciter_active_sourceVerificationStatus_sortOrder_idx" ON "QuranReciter" ("active", "sourceVerificationStatus", "sortOrder");

CREATE TABLE "FavoriteGame" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FavoriteGame_userId_gameId_key" ON "FavoriteGame" ("userId", "gameId");
CREATE INDEX "FavoriteGame_gameId_idx" ON "FavoriteGame" ("gameId");
CREATE INDEX "FavoriteGame_userId_createdAt_idx" ON "FavoriteGame" ("userId", "createdAt");

CREATE TABLE "WishlistGame" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WishlistGame_userId_gameId_key" ON "WishlistGame" ("userId", "gameId");
CREATE INDEX "WishlistGame_gameId_idx" ON "WishlistGame" ("gameId");
CREATE INDEX "WishlistGame_userId_createdAt_idx" ON "WishlistGame" ("userId", "createdAt");

CREATE TABLE "GamerProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" TEXT,
  "bio" TEXT,
  "avatarUrl" TEXT,
  "bannerUrl" TEXT,
  "favoritePlatform" TEXT,
  "country" TEXT,
  "level" INTEGER NOT NULL DEFAULT 1,
  "xp" INTEGER NOT NULL DEFAULT 0,
  "totalPlayMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GamerProfile_userId_key" ON "GamerProfile" ("userId");
CREATE INDEX "GamerProfile_level_idx" ON "GamerProfile" ("level");
CREATE INDEX "GamerProfile_xp_idx" ON "GamerProfile" ("xp");

CREATE TABLE "Achievement" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT,
  "rarity" "AchievementRarity" NOT NULL DEFAULT 'COMMON',
  "xpReward" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement" ("key");

CREATE TABLE "UserAchievement" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "achievementId" TEXT NOT NULL,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserAchievement_profileId_achievementId_key" ON "UserAchievement" ("profileId", "achievementId");
CREATE INDEX "UserAchievement_profileId_idx" ON "UserAchievement" ("profileId");

CREATE TABLE "XpEvent" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "XpEvent_profileId_createdAt_idx" ON "XpEvent" ("profileId", "createdAt");

CREATE TABLE "UserFollow" (
  "id" TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "followingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserFollow_followerId_followingId_key" ON "UserFollow" ("followerId", "followingId");
CREATE INDEX "UserFollow_followingId_createdAt_idx" ON "UserFollow" ("followingId", "createdAt");
CREATE INDEX "UserFollow_followerId_createdAt_idx" ON "UserFollow" ("followerId", "createdAt");

CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "ActivityType" NOT NULL,
  "gameId" TEXT,
  "message" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity" ("userId", "createdAt");
CREATE INDEX "Activity_gameId_createdAt_idx" ON "Activity" ("gameId", "createdAt");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "readAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification" ("userId", "readAt", "createdAt");

CREATE TABLE "GameProduct" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "inventory" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameProduct_sku_key" ON "GameProduct" ("sku");
CREATE INDEX "GameProduct_gameId_active_idx" ON "GameProduct" ("gameId", "active");

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "subtotalCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "paymentProvider" TEXT,
  "providerOrderId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order" ("idempotencyKey");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order" ("userId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order" ("status", "createdAt");

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPriceCents" INTEGER NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem" ("productId");

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "rawEvent" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "Payment_provider_providerPaymentId_idx" ON "Payment" ("provider", "providerPaymentId");
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment" ("orderId", "createdAt");

CREATE TABLE "Entitlement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Entitlement_userId_gameId_key" ON "Entitlement" ("userId", "gameId");
CREATE INDEX "Entitlement_userId_revokedAt_idx" ON "Entitlement" ("userId", "revokedAt");

CREATE TABLE "ContentReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" "ReportReason" NOT NULL,
  "details" TEXT,
  "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
  "moderatorId" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  PRIMARY KEY ("id")
);
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport" ("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport" ("targetType", "targetId");

CREATE TABLE "ModerationAction" (
  "id" TEXT NOT NULL,
  "moderatorId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "ModerationAction_targetType_targetId_createdAt_idx" ON "ModerationAction" ("targetType", "targetId", "createdAt");

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerWallet" ADD CONSTRAINT "OwnerWallet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerLedger" ADD CONSTRAINT "OwnerLedger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "OwnerWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameLibraryItem" ADD CONSTRAINT "GameLibraryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameLibraryItem" ADD CONSTRAINT "GameLibraryItem_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_ownerWalletId_fkey" FOREIGN KEY ("ownerWalletId") REFERENCES "OwnerWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FavoriteGame" ADD CONSTRAINT "FavoriteGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteGame" ADD CONSTRAINT "FavoriteGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistGame" ADD CONSTRAINT "WishlistGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistGame" ADD CONSTRAINT "WishlistGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GamerProfile" ADD CONSTRAINT "GamerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GamerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GamerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameProduct" ADD CONSTRAINT "GameProduct_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GameProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
