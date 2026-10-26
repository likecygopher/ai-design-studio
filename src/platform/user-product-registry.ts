import type { Asset, ProductWithProfile, SellingPoint } from "@/src/domain/types";
import type {
  CreateProductInput,
  ProductRegistry,
  RecognizeResult
} from "@/src/services/product-registry";
import { parseSellingPoints } from "@/src/services/product-registry";
import type { LocalAssetStore } from "@/src/services/local-asset-store";
import { prisma } from "@/src/platform/db";
import { getActiveOrganizationId } from "@/src/platform/organizations";

function asSellingPoints(value: unknown): SellingPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as SellingPoint[];
}

function buildUserProduct(
  record: {
    id: string;
    name: string;
    category: string;
    brand: string | null;
    modelName: string | null;
    sellingPoints: unknown;
  },
  assets: Asset[]
): ProductWithProfile {
  const sellingPoints = asSellingPoints(record.sellingPoints);
  return {
    id: record.id,
    projectId: "project-user-workspace",
    category: record.category,
    brand: record.brand ?? undefined,
    modelName: record.modelName ?? undefined,
    displayName: record.name,
    profileId: `profile-${record.id}`,
    profile: {
      id: `profile-${record.id}`,
      productId: record.id,
      category: record.category,
      detectedFeatures: sellingPoints,
      localizationHints: [],
      confidence: sellingPoints.length ? 0.9 : 0.5
    },
    assets: assets.filter((asset) => asset.productId === record.id),
    acceptsUserUploads: true
  };
}

export function createUserProductRegistry(
  userId: string,
  assetStore: LocalAssetStore,
  organizationId?: string
): ProductRegistry {
  const activeOrganizationId = organizationId ?? getActiveOrganizationId(userId);
  const scope = { OR: [{ organizationId: activeOrganizationId }, { userId }] };
  return {
    async listProducts() {
      const [rows, manifest] = await Promise.all([
        prisma.product.findMany({
          where: scope,
          orderBy: { createdAt: "desc" }
        }),
        assetStore.readAssetManifest()
      ]);
      return rows.map((row) => buildUserProduct(row, manifest));
    },

    async getProduct(productId) {
      const row = await prisma.product.findFirst({
        where: { id: productId, ...scope }
      });
      if (!row) {
        return null;
      }
      const manifest = await assetStore.readAssetManifest();
      return buildUserProduct(row, manifest);
    },

    async createProduct(input: CreateProductInput) {
      const row = await prisma.product.create({
        data: {
          userId,
          organizationId: activeOrganizationId,
          name: input.name,
          category: input.category,
          brand: input.brand,
          modelName: input.modelName,
          sellingPoints: []
        }
      });
      return buildUserProduct(row, []);
    },

    async updateSellingPoints(productId, points) {
      const existing = await prisma.product.findFirst({
        where: { id: productId, ...scope }
      });
      if (!existing) {
        throw new Error(`Unknown product: ${productId}`);
      }

      const row = await prisma.product.update({
        where: { id: productId },
        data: { sellingPoints: points }
      });
      const manifest = await assetStore.readAssetManifest();
      return buildUserProduct(row, manifest);
    },

    async deleteProduct(productId) {
      const existing = await prisma.product.findFirst({
        where: { id: productId, ...scope }
      });
      if (!existing) {
        return false;
      }

      const manifest = await assetStore.readAssetManifest();
      for (const asset of manifest.filter((item) => item.productId === productId)) {
        await assetStore.removeAsset(asset.id);
      }

      await prisma.product.delete({ where: { id: productId } });
      return true;
    },

    async recognizeSellingPoints(productId): Promise<RecognizeResult> {
      const product = await this.getProduct(productId);
      if (!product) {
        throw new Error(`Unknown product: ${productId}`);
      }

      const documents = product.assets
        .filter((asset) => asset.type === "document" && asset.source === "uploaded")
        .reverse();
      const documentAsset = documents[0];
      if (!documentAsset) {
        throw new Error("未找到产品信息文档,请先在素材库上传产品信息(txt/json)。");
      }

      const file = await assetStore.readAssetBytes(documentAsset.id);
      if (!file) {
        throw new Error("产品信息文档读取失败,请重新上传。");
      }

      const isPdf =
        file.contentType === "application/pdf" ||
        documentAsset.filename.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const { extractSellingPointsFromPdf } = await import(
          "@/src/services/selling-point-extractor"
        );
        const extraction = await extractSellingPointsFromPdf({
          pdfBytes: file.bytes,
          filename: documentAsset.filename,
          productName: product.displayName
        });
        if (!extraction.sellingPoints.length) {
          throw new Error(extraction.failureReason ?? "PDF 中未识别到卖点。");
        }
        const updated = await this.updateSellingPoints(productId, extraction.sellingPoints);
        return {
          product: updated,
          recognizedFrom: documentAsset.filename,
          model: extraction.model,
          isFallback: extraction.isFallback,
          failureReason: extraction.failureReason
        };
      }

      const points = parseSellingPoints(file.bytes.toString("utf8"));
      if (!points.length) {
        throw new Error(
          "产品信息文档中未识别到卖点,请使用每行“标题|短标签|说明|技术佐证”或 JSON 数组格式。"
        );
      }

      const updated = await this.updateSellingPoints(productId, points);
      return {
        product: updated,
        recognizedFrom: documentAsset.filename,
        model: "rule-parser",
        isFallback: false
      };
    }
  };
}
