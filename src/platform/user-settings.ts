import {
  DEFAULT_SYSTEM_SETTINGS,
  type SystemSettings,
  type SystemSettingsStore
} from "@/src/services/system-settings";
import { prisma } from "@/src/platform/db";

export function createUserSettingsStore(userId: string): SystemSettingsStore {
  return {
    async read(): Promise<SystemSettings> {
      const row = await prisma.userSettings.findUnique({ where: { userId } });
      if (!row) {
        return { ...DEFAULT_SYSTEM_SETTINGS };
      }
      return {
        country: row.country || DEFAULT_SYSTEM_SETTINGS.country,
        language: row.language || DEFAULT_SYSTEM_SETTINGS.language
      };
    },

    async save(settings: SystemSettings): Promise<SystemSettings> {
      const normalized = {
        country: settings.country.trim() || DEFAULT_SYSTEM_SETTINGS.country,
        language: settings.language.trim() || DEFAULT_SYSTEM_SETTINGS.language
      };

      const row = await prisma.userSettings.upsert({
        where: { userId },
        create: { userId, ...normalized },
        update: normalized
      });

      return {
        country: row.country,
        language: row.language
      };
    }
  };
}
