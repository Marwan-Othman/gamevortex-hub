-- ============================================================
-- GameVortex Hub
-- AI Persistent Conversations
-- Stage 5A - Database Migration
-- ============================================================

-- ============================================================
-- ENUM: ChatMessageRole
-- ============================================================

DO $$
BEGIN
  CREATE TYPE "ChatMessageRole" AS ENUM (
    'USER',
    'ASSISTANT',
    'SYSTEM'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;


-- ============================================================
-- ENUM: ChatMessageStatus
-- ============================================================

DO $$
BEGIN
  CREATE TYPE "ChatMessageStatus" AS ENUM (
    'PENDING',
    'STREAMING',
    'COMPLETE',
    'STOPPED',
    'ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;


-- ============================================================
-- TABLE: Conversation
-- ============================================================

CREATE TABLE IF NOT EXISTS "Conversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'New Chat',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Conversation_pkey"
    PRIMARY KEY ("id")
);


-- ============================================================
-- TABLE: Message
-- ============================================================

CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" "ChatMessageRole" NOT NULL,
  "status" "ChatMessageStatus" NOT NULL DEFAULT 'COMPLETE',
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Message_pkey"
    PRIMARY KEY ("id")
);


-- ============================================================
-- INDEXES: Conversation
-- ============================================================

CREATE INDEX IF NOT EXISTS
  "Conversation_userId_updatedAt_idx"
ON "Conversation" (
  "userId",
  "updatedAt"
);


CREATE INDEX IF NOT EXISTS
  "Conversation_userId_createdAt_idx"
ON "Conversation" (
  "userId",
  "createdAt"
);


-- ============================================================
-- INDEXES: Message
-- ============================================================

CREATE INDEX IF NOT EXISTS
  "Message_conversationId_createdAt_idx"
ON "Message" (
  "conversationId",
  "createdAt"
);


CREATE INDEX IF NOT EXISTS
  "Message_conversationId_role_createdAt_idx"
ON "Message" (
  "conversationId",
  "role",
  "createdAt"
);


-- ============================================================
-- FOREIGN KEY: Conversation -> User
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Conversation_userId_fkey'
  ) THEN

    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_userId_fkey"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

  END IF;
END
$$;


-- ============================================================
-- FOREIGN KEY: Message -> Conversation
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Message_conversationId_fkey'
  ) THEN

    ALTER TABLE "Message"
      ADD CONSTRAINT "Message_conversationId_fkey"
      FOREIGN KEY ("conversationId")
      REFERENCES "Conversation"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;

  END IF;
END
$$;
