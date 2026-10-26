import { prisma } from "@/src/platform/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/src/platform/errors";

/**
 * Organizations (teams): every user gets a personal organization and can be a
 * member of several organizations. The user's `organizationId` is the active
 * tenant used by the workspace.
 */

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export type OrganizationMemberView = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

export type OrganizationOverview = {
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    archivedAt: string | null;
  } | null;
  role: string | null;
  members: OrganizationMemberView[];
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
  personalOrganizationId: string;
  canDelete: boolean;
};

const activeOrganizationCache = new Map<string, string>();

/** Populated by `getSessionUser`; falls back to the deterministic personal org. */
export function rememberActiveOrganization(userId: string, organizationId: string | null): void {
  if (organizationId) {
    activeOrganizationCache.set(userId, organizationId);
  }
}

export function getActiveOrganizationId(userId: string): string {
  return activeOrganizationCache.get(userId) ?? personalOrganizationId(userId);
}

export function personalOrganizationId(userId: string): string {
  return `org_${userId}`;
}

export function personalOrganizationSlug(userId: string): string {
  return `personal-${userId}`;
}

/** Ensure the personal organization exists; returns the user's active org id. */
export async function ensurePersonalOrganization(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      organizationId: true,
      organization: { select: { archivedAt: true } }
    }
  });
  if (!user) throw new NotFoundError("用户不存在。");
  if (user.organizationId && !user.organization?.archivedAt) {
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: user.organizationId,
          userId
        }
      },
      select: { id: true }
    });
    if (membership) return user.organizationId;
  }

  const orgId = personalOrganizationId(userId);
  const name = user.name?.trim() || user.email.split("@")[0] || "Personal";
  await prisma.organization.upsert({
    where: { id: orgId },
    create: { id: orgId, name, slug: personalOrganizationSlug(userId) },
    update: {}
  });
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: orgId, userId }
    },
    create: { organizationId: orgId, userId, role: "owner" },
    update: {}
  });
  await prisma.user.update({ where: { id: userId }, data: { organizationId: orgId } });
  return orgId;
}

async function activeMembership(userId: string): Promise<{
  organizationId: string;
  role: string;
}> {
  const orgId = await ensurePersonalOrganization(userId);
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } }
  });
  if (!membership) {
    throw new ForbiddenError("你不是该组织的成员。");
  }
  return { organizationId: orgId, role: membership.role };
}

function assertManager(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError("需要组织管理员权限。");
  }
}

export async function getOrganizationOverview(userId: string): Promise<OrganizationOverview> {
  const { organizationId, role } = await activeMembership(userId);
  const [organization, members, memberships] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true, name: true } } }
    }),
    prisma.organizationMember.findMany({
      where: { userId, organization: { archivedAt: null } },
      include: { organization: { select: { id: true, name: true, slug: true } } }
    })
  ]);
  return {
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          createdAt: organization.createdAt.toISOString(),
          archivedAt: organization.archivedAt?.toISOString() ?? null
        }
      : null,
    role,
    members: members.map((member) => ({
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      createdAt: member.createdAt.toISOString()
    })),
    organizations: memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role
    })),
    personalOrganizationId: personalOrganizationId(userId),
    canDelete:
      role === "owner" && organizationId !== personalOrganizationId(userId)
  };
}

export async function renameOrganization(userId: string, name: string): Promise<void> {
  const { organizationId, role } = await activeMembership(userId);
  assertManager(role);
  await prisma.organization.update({
    where: { id: organizationId },
    data: { name: name.trim() }
  });
}

export async function switchOrganization(userId: string, organizationId: string): Promise<void> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, organization: { select: { archivedAt: true } } }
  });
  if (!membership) {
    throw new ForbiddenError("你不是该组织的成员。");
  }
  if (membership.organization.archivedAt) {
    throw new ConflictError("该组织已归档，无法切换。");
  }
  await prisma.user.update({ where: { id: userId }, data: { organizationId } });
}

export async function addOrganizationMember(
  actorId: string,
  email: string,
  role: "admin" | "member" = "member"
): Promise<OrganizationMemberView> {
  const { organizationId, role: actorRole } = await activeMembership(actorId);
  assertManager(actorRole);
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, disabled: true }
  });
  if (!user || user.disabled) {
    throw new NotFoundError("该邮箱没有可添加的账号（不支持邀请注册）。");
  }
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    select: { id: true }
  });
  if (existing) {
    throw new ConflictError("该用户已在组织中。");
  }
  const member = await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, role }
  });
  return {
    id: member.id,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: member.role,
    createdAt: member.createdAt.toISOString()
  };
}

async function memberInActiveOrg(
  actorId: string,
  memberId: string
): Promise<{ organizationId: string; role: string; member: { id: string; role: string; userId: string } }> {
  const { organizationId, role } = await activeMembership(actorId);
  assertManager(role);
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true, userId: true }
  });
  if (!member) throw new NotFoundError("成员不存在。");
  return { organizationId, role, member };
}

async function ownerCount(organizationId: string): Promise<number> {
  return prisma.organizationMember.count({ where: { organizationId, role: "owner" } });
}

export async function updateOrganizationMemberRole(
  actorId: string,
  memberId: string,
  role: OrgRole
): Promise<void> {
  const { organizationId, role: actorRole, member } = await memberInActiveOrg(actorId, memberId);
  if (role === "owner" && actorRole !== "owner") {
    throw new ForbiddenError("只有 owner 可以授予 owner。");
  }
  if (member.role === "owner" && role !== "owner" && (await ownerCount(organizationId)) <= 1) {
    throw new ConflictError("组织至少需要保留一位 owner。");
  }
  await prisma.organizationMember.update({ where: { id: memberId }, data: { role } });
}

export async function removeOrganizationMember(actorId: string, memberId: string): Promise<void> {
  const { organizationId, member } = await memberInActiveOrg(actorId, memberId);
  if (member.role === "owner" && (await ownerCount(organizationId)) <= 1) {
    throw new ConflictError("组织至少需要保留一位 owner。");
  }
  await prisma.organizationMember.delete({ where: { id: memberId } });
}

/** Owner-only archive; personal organizations cannot be archived. */
export async function archiveOrganization(userId: string): Promise<void> {
  const { organizationId, role } = await activeMembership(userId);
  if (role !== "owner") throw new ForbiddenError("只有 owner 可以归档组织。");
  if (organizationId === personalOrganizationId(userId)) {
    throw new ConflictError("个人组织不能归档。");
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: { archivedAt: new Date() }
  });
  await ensurePersonalOrganization(userId);
}

/** Owner-only permanent deletion; requires exact organization name. */
export async function deleteOrganization(
  userId: string,
  confirmName: string
): Promise<void> {
  const { organizationId, role } = await activeMembership(userId);
  if (role !== "owner") throw new ForbiddenError("只有 owner 可以删除组织。");
  if (organizationId === personalOrganizationId(userId)) {
    throw new ConflictError("个人组织不能删除。");
  }
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true }
  });
  if (!organization) throw new NotFoundError("组织不存在。");
  if (organization.name !== confirmName.trim()) {
    throw new ConflictError("组织名称不匹配，无法删除。");
  }
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { organizationId },
      data: { organizationId: null }
    }),
    prisma.organization.delete({ where: { id: organizationId } })
  ]);
  await ensurePersonalOrganization(userId);
}
