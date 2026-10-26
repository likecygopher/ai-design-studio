import { AppShell } from "@/src/components/AppShell";
import { WhiteBackgroundRunner } from "@/src/components/WhiteBackgroundRunner";
import styles from "@/src/components/WhiteBackgroundRunner.module.css";

export default function Page() {
  return (
    <AppShell>
      <div className={styles.workspace}>
        <header className={styles.heading}>
          <h1>白底图多角度</h1>
        </header>
        <WhiteBackgroundRunner />
      </div>
    </AppShell>
  );
}
