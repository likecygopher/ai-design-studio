-- CreateTable
CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "proxyUrl" TEXT,
    "apiKeyCipher" TEXT,
    "models" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProvider_channel_enabled_priority_idx" ON "AiProvider"("channel", "enabled", "priority");

-- CreateIndex
CREATE INDEX "AiProvider_updatedAt_idx" ON "AiProvider"("updatedAt");

