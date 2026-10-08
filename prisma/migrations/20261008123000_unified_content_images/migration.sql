CREATE TABLE "ContentImage" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "gameId" TEXT,
  "appId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentImage_url_key" ON "ContentImage"("url");
CREATE INDEX "ContentImage_gameId_sortOrder_idx" ON "ContentImage"("gameId", "sortOrder");
CREATE INDEX "ContentImage_appId_sortOrder_idx" ON "ContentImage"("appId", "sortOrder");

ALTER TABLE "ContentImage"
  ADD CONSTRAINT "ContentImage_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentImage"
  ADD CONSTRAINT "ContentImage_appId_fkey"
  FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
