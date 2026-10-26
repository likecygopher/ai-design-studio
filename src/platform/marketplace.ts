import { prisma } from "@/src/platform/db";
import { NotFoundError } from "@/src/platform/errors";

/** Template marketplace: publish → review → clone into a personal template library. */

export const MARKETPLACE_CATEGORIES = ["style", "pop", "pdp", "prompt"] as const;
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

export type MarketplaceItemView = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  prompt: string;
  coverUrl: string | null;
  status: string;
  clones: number;
  authorName: string;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublishInput = {
  title: string;
  description?: string | null;
  category: MarketplaceCategory;
  prompt: string;
  coverUrl?: string | null;
};

type Row = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  prompt: string;
  coverUrl: string | null;
  status: string;
  clones: number;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { name: string | null; email: string };
};

function toView(row: Row): MarketplaceItemView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    prompt: row.prompt,
    coverUrl: row.coverUrl,
    status: row.status,
    clones: row.clones,
    authorName: row.author.name?.trim() || row.author.email.split("@")[0] || "user",
    reviewNote: row.reviewNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

const includeAuthor = { author: { select: { name: true, email: true } } } as const;

export async function publishMarketplaceItem(
  authorId: string,
  input: PublishInput
): Promise<MarketplaceItemView> {
  const row = await prisma.marketplaceItem.create({
    data: {
      authorId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      prompt: input.prompt.trim(),
      coverUrl: input.coverUrl ?? null,
      status: "pending"
    },
    include: includeAuthor
  });
  return toView(row);
}

export async function listMarketplace(input: {
  q?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: MarketplaceItemView[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 12, 1), 48);
  const where: Record<string, unknown> = { status: "approved" };
  if (input.category && MARKETPLACE_CATEGORIES.includes(input.category as never)) {
    where.category = input.category;
  }
  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [{ title: { contains: q } }, { description: { contains: q } }];
  }
  const [rows, total] = await Promise.all([
    prisma.marketplaceItem.findMany({
      where,
      orderBy: [{ clones: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: includeAuthor
    }),
    prisma.marketplaceItem.count({ where })
  ]);
  return { items: rows.map(toView), total, page, pageSize };
}

export async function getApprovedMarketplaceItem(id: string): Promise<MarketplaceItemView> {
  const row = await prisma.marketplaceItem.findFirst({
    where: { id, status: "approved" },
    include: includeAuthor
  });
  if (!row) {
    throw new NotFoundError("模板不存在或尚未通过审核。");
  }
  return toView(row);
}

export async function cloneMarketplaceItem(
  userId: string,
  itemId: string
): Promise<{ templateId: string; item: MarketplaceItemView }> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.marketplaceItem.findFirst({
      where: { id: itemId, status: "approved" },
      include: includeAuthor
    });
    if (!item) {
      throw new NotFoundError("模板不存在或尚未通过审核。");
    }
    const template = await tx.userTemplate.create({
      data: {
        userId,
        itemId: item.id,
        title: item.title,
        prompt: item.prompt,
        category: item.category
      }
    });
    const updated = await tx.marketplaceItem.update({
      where: { id: item.id },
      data: { clones: { increment: 1 } },
      include: includeAuthor
    });
    return { templateId: template.id, item: toView(updated) };
  });
}

export async function listUserTemplates(userId: string): Promise<
  Array<{ id: string; title: string; prompt: string; category: string; itemId: string | null; createdAt: string }>
> {
  const rows = await prisma.userTemplate.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    category: row.category,
    itemId: row.itemId,
    createdAt: row.createdAt.toISOString()
  }));
}

export async function listAdminMarketplace(input: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: MarketplaceItemView[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
  const where = input.status && input.status !== "all" ? { status: input.status } : {};
  const [rows, total] = await Promise.all([
    prisma.marketplaceItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: includeAuthor
    }),
    prisma.marketplaceItem.count({ where })
  ]);
  return { items: rows.map(toView), total, page, pageSize };
}

export async function reviewMarketplaceItem(
  reviewerId: string,
  id: string,
  input: { status: "approved" | "rejected"; reviewNote?: string | null }
): Promise<MarketplaceItemView> {
  const existing = await prisma.marketplaceItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new NotFoundError("模板不存在。");
  }
  const row = await prisma.marketplaceItem.update({
    where: { id },
    data: {
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedBy: reviewerId
    },
    include: includeAuthor
  });
  return toView(row);
}
