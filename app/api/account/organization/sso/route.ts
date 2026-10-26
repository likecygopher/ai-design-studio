import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import {
  ORG_ROLE_VALUES,
  SSO_PROTOCOLS,
  getOrganizationSsoConfig,
  saveOrganizationSsoConfig
} from "@/src/platform/organization-sso";

export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
  protocol: z.enum(SSO_PROTOCOLS),
  displayName: z.string().trim().max(80).nullable().optional(),
  oidcIssuer: z.string().url().max(500).nullable().optional(),
  oidcClientId: z.string().trim().max(300).nullable().optional(),
  oidcClientSecret: z.string().trim().max(500).nullable().optional(),
  samlEntryPoint: z.string().url().max(1000).nullable().optional(),
  samlIssuer: z.string().trim().max(500).nullable().optional(),
  samlCert: z.string().trim().max(10000).nullable().optional(),
  allowedDomains: z.array(z.string().trim().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).max(50).optional(),
  autoProvision: z.boolean().optional(),
  defaultRole: z.enum(ORG_ROLE_VALUES).optional(),
  groupRoleMap: z.record(z.string().max(200), z.enum(ORG_ROLE_VALUES)).optional(),
  scimEnabled: z.boolean().optional()
});

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:sso:read", limit: 60 } },
    async (ctx) => {
      const config = await getOrganizationSsoConfig(ctx.userId as string);
      return NextResponse.json({ config }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

export function PUT(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:sso:update", limit: 20 } },
    async (ctx) => {
      const body = await ctx.body(schema);
      const config = await saveOrganizationSsoConfig(ctx.userId as string, body);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.sso_update",
        targetType: "organization_sso_config",
        targetId: config.organizationId,
        metadata: { enabled: config.enabled, protocol: config.protocol },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ config });
    }
  );
}
