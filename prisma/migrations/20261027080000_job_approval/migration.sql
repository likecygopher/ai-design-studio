-- AlterTable
ALTER TABLE "User" ADD COLUMN     "requiresJobApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;


-- Existing jobs were created before the approval gate; keep them runnable.
UPDATE "GenerationJob" SET "approvedAt" = CURRENT_TIMESTAMP WHERE "approvedAt" IS NULL;
