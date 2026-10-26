import { AppShell } from "@/src/components/AppShell";
import { PopCanvasStudio } from "@/src/components/PopCanvasStudio";
import styles from "@/src/components/PopCanvasStudio.module.css";
import { requireServerWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export default async function PopPage() {
  const workspace = await requireServerWorkspace();
  const products = await workspace.productRegistry.listProducts();

  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.pageHeading}>
          <h1>POP 物料设计</h1>
        </header>
        <PopCanvasStudio products={products} />
      </div>
    </AppShell>
  );
}
