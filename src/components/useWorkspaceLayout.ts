"use client";

import { useCallback, useEffect, useState } from "react";

export type WorkspaceLayout = "comfortable" | "compact";

const STORAGE_KEY = "studio-layout";
const EVENT = "studio-layout-change";

function readStored(): WorkspaceLayout {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

/** Global workspace density preference, persisted per browser. */
export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayout>("comfortable");

  useEffect(() => {
    setLayout(readStored());
    const sync = () => setLayout(readStored());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceLayout>).detail;
      setLayout(detail === "compact" ? "compact" : "comfortable");
    };
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, onChange);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.workspaceLayout = layout;
  }, [layout]);

  const update = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }, []);

  return {
    layout,
    compact: layout === "compact",
    setLayout: update,
    toggle: () => update(layout === "compact" ? "comfortable" : "compact")
  };
}
