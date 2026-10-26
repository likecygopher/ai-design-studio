-- CreateTable
CREATE TABLE "OrganizationSsoConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "protocol" TEXT NOT NULL DEFAULT 'oidc',
    "displayName" TEXT,
    "oidcIssuer" TEXT,
    "oidcClientId" TEXT,
    "oidcClientSecretCipher" TEXT,
    "samlEntryPoint" TEXT,
    "samlIssuer" TEXT,
    "samlCert" TEXT,
    "allowedDomains" JSONB NOT NULL DEFAULT '[]',
    "autoProvision" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" TEXT NOT NULL DEFAULT 'member',
    "groupRoleMap" JSONB NOT NULL DEFAULT '{}',
    "scimEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scimTokenHash" TEXT,
    "scimTokenPrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSsoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoLoginState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "nonce" TEXT,
    "codeVerifier" TEXT,
    "returnTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoLoginState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoLoginTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "protocol" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoLoginTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimExternalUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimExternalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSsoConfig_organizationId_key" ON "OrganizationSsoConfig"("organizationId");

-- CreateIndex
CREATE INDEX "SsoLoginState_expiresAt_idx" ON "SsoLoginState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SsoLoginTicket_tokenHash_key" ON "SsoLoginTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "SsoLoginTicket_expiresAt_idx" ON "SsoLoginTicket"("expiresAt");

-- CreateIndex
CREATE INDEX "ScimExternalUser_userId_idx" ON "ScimExternalUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimExternalUser_organizationId_externalId_key" ON "ScimExternalUser"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroup_organizationId_externalId_key" ON "ScimGroup"("organizationId", "externalId");

-- AddForeignKey
ALTER TABLE "OrganizationSsoConfig" ADD CONSTRAINT "OrganizationSsoConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoLoginState" ADD CONSTRAINT "SsoLoginState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoLoginTicket" ADD CONSTRAINT "SsoLoginTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimExternalUser" ADD CONSTRAINT "ScimExternalUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimExternalUser" ADD CONSTRAINT "ScimExternalUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroup" ADD CONSTRAINT "ScimGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ScimExternalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

