import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/src/platform/db";
import { ensurePersonalOrganization } from "@/src/platform/organizations";
import { resolveRoleFromGroups } from "@/src/platform/organization-sso";

/** Minimal SCIM 2.0 server for per-organization user/group provisioning. */

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const ROLE_RANK = { member: 1, admin: 2, owner: 3 } as const;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ScimContext = {
  organizationId: string;
  config: {
    id: string;
    defaultRole: string;
    groupRoleMap: unknown;
  };
};

export function scimError(status: number, detail: string): Response {
  return Response.json(
    { schemas: [SCIM_ERROR_SCHEMA], detail, status: String(status) },
    { status, headers: { "Content-Type": "application/scim+json" } }
  );
}

function scimJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Content-Type": "application/scim+json", "Cache-Control": "no-store" }
  });
}

export async function authenticateScim(request: Request): Promise<ScimContext | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) return null;
  const token = match[1];
  const actual = Buffer.from(hashToken(token), "hex");
  const configs = await prisma.organizationSsoConfig.findMany({
    where: { scimEnabled: true, scimTokenHash: { not: null } },
    select: { id: true, organizationId: true, scimTokenHash: true, defaultRole: true, groupRoleMap: true }
  });
  for (const config of configs) {
    if (!config.scimTokenHash) continue;
    const expected = Buffer.from(config.scimTokenHash, "hex");
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return {
        organizationId: config.organizationId,
        config: {
          id: config.id,
          defaultRole: config.defaultRole,
          groupRoleMap: config.groupRoleMap
        }
      };
    }
  }
  return null;
}

type ExternalRow = {
  id: string;
  externalId: string;
  userName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; email: string; name: string | null; disabled: boolean };
};

export function userResource(row: ExternalRow) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: row.id,
    externalId: row.externalId,
    userName: row.userName,
    name: { formatted: row.user.name ?? row.user.email },
    displayName: row.user.name ?? row.user.email,
    emails: [{ value: row.user.email, primary: true, type: "work" }],
    active: row.active && !row.user.disabled,
    meta: {
      resourceType: "User",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString()
    }
  };
}

export async function listScimUsers(
  context: ScimContext,
  query: { filter?: string; startIndex?: number; count?: number }
) {
  const where: Record<string, unknown> = { organizationId: context.organizationId };
  const filter = query.filter ?? "";
  const usernameMatch = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
  if (usernameMatch) where.userName = usernameMatch[1];
  const externalMatch = /externalId\s+eq\s+"([^"]+)"/i.exec(filter);
  if (externalMatch) where.externalId = externalMatch[1];
  const startIndex = Math.max(1, query.startIndex ?? 1);
  const count = Math.min(Math.max(query.count ?? 100, 0), 500);
  const [rows, totalResults] = await Promise.all([
    prisma.scimExternalUser.findMany({
      where,
      include: { user: { select: { id: true, email: true, name: true, disabled: true } } },
      orderBy: { createdAt: "asc" },
      skip: startIndex - 1,
      take: count
    }),
    prisma.scimExternalUser.count({ where })
  ]);
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map(userResource)
  };
}

function scimName(body: Record<string, unknown>): string | null {
  const name = body.name as { formatted?: unknown } | undefined;
  if (name && typeof name.formatted === "string") return name.formatted;
  if (typeof body.displayName === "string") return body.displayName;
  return null;
}

function scimEmail(body: Record<string, unknown>, userName: string): string {
  const emails = body.emails;
  if (Array.isArray(emails)) {
    const primary = emails.find((item) => (item as { primary?: boolean })?.primary) ?? emails[0];
    const value = (primary as { value?: unknown })?.value;
    if (typeof value === "string" && value.includes("@")) return value.toLowerCase();
  }
  return userName.toLowerCase();
}

export async function createScimUser(context: ScimContext, body: Record<string, unknown>) {
  const userName = typeof body.userName === "string" ? body.userName.trim() : "";
  const externalId =
    typeof body.externalId === "string" && body.externalId.trim()
      ? body.externalId.trim()
      : userName;
  if (!userName) throw new ScimBadRequest("userName is required");
  const email = scimEmail(body, userName);
  const active = body.active !== false;
  const existingMapping = await prisma.scimExternalUser.findUnique({
    where: {
      organizationId_externalId: {
        organizationId: context.organizationId,
        externalId
      }
    }
  });
  if (existingMapping) throw new ScimConflict("externalId already exists");

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: scimName(body) ?? userName,
        passwordHash: await hash(randomBytes(32).toString("base64url"), 12),
        settings: { create: { country: "Mexico", language: "Spanish" } }
      }
    });
    await ensurePersonalOrganization(user.id).catch(() => undefined);
  }
  if (active) {
    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: user.id
        }
      },
      create: {
        organizationId: context.organizationId,
        userId: user.id,
        role: context.config.defaultRole
      },
      update: {}
    });
  }
  const row = await prisma.scimExternalUser.create({
    data: {
      organizationId: context.organizationId,
      externalId,
      userId: user.id,
      userName,
      active
    },
    include: { user: { select: { id: true, email: true, name: true, disabled: true } } }
  });
  return userResource(row);
}

export async function getScimUser(context: ScimContext, id: string) {
  const row = await prisma.scimExternalUser.findFirst({
    where: { id, organizationId: context.organizationId },
    include: { user: { select: { id: true, email: true, name: true, disabled: true } } }
  });
  return row ? userResource(row) : null;
}

export async function patchScimUser(
  context: ScimContext,
  id: string,
  body: Record<string, unknown>
) {
  const row = await prisma.scimExternalUser.findFirst({
    where: { id, organizationId: context.organizationId }
  });
  if (!row) return null;
  const operations = Array.isArray(body.Operations) ? body.Operations : [];
  let active = row.active;
  let userName = row.userName;
  let displayName: string | null = null;
  for (const operation of operations) {
    const op = operation as {
      op?: string;
      path?: string;
      value?: unknown;
    };
    const path = (op.path ?? "").toLowerCase();
    if (path === "active" && typeof op.value === "boolean") {
      active = op.value;
    } else if (path === "username" && typeof op.value === "string") {
      userName = op.value;
    } else if (path === "displayname" && typeof op.value === "string") {
      displayName = op.value;
    }
  }
  await prisma.scimExternalUser.update({
    where: { id: row.id },
    data: { active, userName }
  });
  if (displayName) {
    await prisma.user.update({ where: { id: row.userId }, data: { name: displayName } });
  }
  if (active) {
    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: row.userId
        }
      },
      create: {
        organizationId: context.organizationId,
        userId: row.userId,
        role: context.config.defaultRole
      },
      update: {}
    });
  } else {
    await prisma.organizationMember.deleteMany({
      where: { organizationId: context.organizationId, userId: row.userId }
    });
  }
  return getScimUser(context, id);
}

export async function deleteScimUser(context: ScimContext, id: string): Promise<boolean> {
  const row = await prisma.scimExternalUser.findFirst({
    where: { id, organizationId: context.organizationId }
  });
  if (!row) return false;
  await prisma.organizationMember.deleteMany({
    where: { organizationId: context.organizationId, userId: row.userId }
  });
  await prisma.scimExternalUser.delete({ where: { id: row.id } });
  return true;
}

function groupRole(context: ScimContext, displayName: string, explicit?: unknown): string | null {
  if (typeof explicit === "string" && ["owner", "admin", "member"].includes(explicit)) {
    return explicit;
  }
  const map =
    context.config.groupRoleMap && typeof context.config.groupRoleMap === "object"
      ? (context.config.groupRoleMap as Record<string, unknown>)
      : {};
  const mapped = map[displayName];
  return typeof mapped === "string" ? mapped : null;
}

type GroupRow = {
  id: string;
  externalId: string | null;
  displayName: string;
  role: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: Array<{ userId: string }>;
};

export function groupResource(row: GroupRow) {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: row.id,
    externalId: row.externalId ?? undefined,
    displayName: row.displayName,
    members: row.members.map((member) => ({ value: member.userId })),
    meta: {
      resourceType: "Group",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString()
    }
  };
}

export async function listScimGroups(context: ScimContext) {
  const rows = await prisma.scimGroup.findMany({
    where: { organizationId: context.organizationId },
    include: { members: { select: { userId: true } } },
    orderBy: { createdAt: "asc" }
  });
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: rows.length,
    startIndex: 1,
    itemsPerPage: rows.length,
    Resources: rows.map(groupResource)
  };
}

async function applyGroupRole(context: ScimContext, groupId: string, role: string | null) {
  if (!role) return;
  const group = await prisma.scimGroup.findFirst({
    where: { id: groupId, organizationId: context.organizationId },
    include: { members: { include: { user: true } } }
  });
  if (!group) return;
  for (const member of group.members) {
    const userId = member.user.userId;
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId
        }
      }
    });
    const mapped = role as keyof typeof ROLE_RANK;
    if (membership) {
      const current = membership.role as keyof typeof ROLE_RANK;
      const next =
        (ROLE_RANK[current] ?? 0) > (ROLE_RANK[mapped] ?? 0) ? membership.role : role;
      await prisma.organizationMember.update({
        where: { id: membership.id },
        data: { role: next }
      });
    }
  }
}

export async function createScimGroup(context: ScimContext, body: Record<string, unknown>) {
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) throw new ScimBadRequest("displayName is required");
  const externalId =
    typeof body.externalId === "string" && body.externalId.trim()
      ? body.externalId.trim()
      : null;
  const role = groupRole(context, displayName, body.role);
  const members = Array.isArray(body.members)
    ? body.members
        .map((member) => (member as { value?: unknown }).value)
        .filter((value): value is string => typeof value === "string")
    : [];
  const group = await prisma.scimGroup.create({
    data: {
      organizationId: context.organizationId,
      externalId,
      displayName,
      role,
      members: { create: members.map((userId) => ({ userId })) }
    },
    include: { members: { select: { userId: true } } }
  });
  await applyGroupRole(context, group.id, role);
  return groupResource(group);
}

export async function patchScimGroup(
  context: ScimContext,
  id: string,
  body: Record<string, unknown>
) {
  const group = await prisma.scimGroup.findFirst({
    where: { id, organizationId: context.organizationId }
  });
  if (!group) return null;
  const operations = Array.isArray(body.Operations) ? body.Operations : [];
  for (const operation of operations) {
    const op = operation as { op?: string; path?: string; value?: unknown };
    const path = (op.path ?? "").toLowerCase();
    if (path === "members") {
      const members = Array.isArray(op.value) ? op.value : [];
      if ((op.op ?? "").toLowerCase() === "add") {
        for (const member of members) {
          const userId = (member as { value?: unknown }).value;
          if (typeof userId === "string") {
            await prisma.scimGroupMember
              .create({ data: { groupId: group.id, userId } })
              .catch(() => undefined);
          }
        }
      } else if ((op.op ?? "").toLowerCase() === "remove") {
        const userId = (members[0] as { value?: unknown } | undefined)?.value;
        if (typeof userId === "string") {
          await prisma.scimGroupMember.deleteMany({
            where: { groupId: group.id, userId }
          });
        }
      }
    } else if (path === "displayname" && typeof op.value === "string") {
      await prisma.scimGroup.update({
        where: { id: group.id },
        data: {
          displayName: op.value,
          role: groupRole(context, op.value, group.role)
        }
      });
    }
  }
  await applyGroupRole(context, group.id, group.role);
  const updated = await prisma.scimGroup.findUnique({
    where: { id: group.id },
    include: { members: { select: { userId: true } } }
  });
  return updated ? groupResource(updated) : null;
}

export async function getScimGroup(context: ScimContext, id: string) {
  const group = await prisma.scimGroup.findFirst({
    where: { id, organizationId: context.organizationId },
    include: { members: { select: { userId: true } } }
  });
  return group ? groupResource(group) : null;
}

export async function deleteScimGroup(context: ScimContext, id: string): Promise<boolean> {
  const result = await prisma.scimGroup.deleteMany({
    where: { id, organizationId: context.organizationId }
  });
  return result.count > 0;
}

export class ScimBadRequest extends Error {}
export class ScimConflict extends Error {}
