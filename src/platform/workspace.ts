import type { CostLedger } from "@/src/services/cost-ledger";
import type { LocalAssetStore } from "@/src/services/local-asset-store";
import type { ProductRegistry } from "@/src/services/product-registry";
import type { SystemSettingsStore } from "@/src/services/system-settings";
import { createUserAssetStore } from "@/src/platform/user-asset-store";
import { createUserCostLedger } from "@/src/platform/user-cost-ledger";
import { createUserProductRegistry } from "@/src/platform/user-product-registry";
import { createUserSettingsStore } from "@/src/platform/user-settings";

export type UserWorkspace = {
  userId: string;
  imageStore: LocalAssetStore;
  productRegistry: ProductRegistry;
  costLedger: CostLedger;
  settingsStore: SystemSettingsStore;
};

export function createUserWorkspace(
  userId: string,
  jobId?: string,
  organizationId?: string
): UserWorkspace {
  const imageStore = createUserAssetStore(userId, { organizationId });
  return {
    userId,
    imageStore,
    productRegistry: createUserProductRegistry(userId, imageStore, organizationId),
    costLedger: createUserCostLedger(userId, jobId),
    settingsStore: createUserSettingsStore(userId)
  };
}
