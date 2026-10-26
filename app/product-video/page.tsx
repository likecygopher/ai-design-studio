import { AppShell } from "@/src/components/AppShell";
import { ProductVideoStudio } from "@/src/components/ProductVideoStudio";
import { PRODUCT_VIDEO_MODEL_LABEL, PRODUCT_VIDEO_OUTPUT } from "@/src/domain/product-video";
import { requireServerWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export default async function ProductVideoPage() {
  const products = await (await requireServerWorkspace()).productRegistry.listProducts();

  return (
    <AppShell>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 30, margin: "0 0 8px" }}>产品视频</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          {PRODUCT_VIDEO_MODEL_LABEL} · {PRODUCT_VIDEO_OUTPUT.durationSeconds} 秒 · {PRODUCT_VIDEO_OUTPUT.aspectRatio} · {PRODUCT_VIDEO_OUTPUT.resolution}
        </p>
      </header>
      <ProductVideoStudio products={products} />
    </AppShell>
  );
}
