-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ssoProvider" TEXT,
ADD COLUMN     "ssoSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_ssoProvider_ssoSubject_key" ON "User"("ssoProvider", "ssoSubject");

