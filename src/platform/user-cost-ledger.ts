import type {
  CostLedger,
  CostLedgerRecord,
  CostLedgerRecordInput
} from "@/src/services/cost-ledger";
import { prisma } from "@/src/platform/db";

export function createUserCostLedger(userId: string, jobId?: string): CostLedger {
  return {
    async appendRecord(input: CostLedgerRecordInput): Promise<CostLedgerRecord> {
      const row = await prisma.costRecord.create({
        data: {
          userId,
          jobId,
          taskId: input.taskId,
          task: input.task,
          model: input.model,
          mode: input.mode,
          country: input.country,
          language: input.language,
          estimatedUnits: input.estimatedUnits,
          isFallback: input.isFallback,
          sourceAssetIds: input.sourceAssetIds
        }
      });

      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        taskId: row.taskId,
        task: row.task,
        model: row.model,
        mode: row.mode,
        country: row.country,
        language: row.language,
        estimatedUnits: row.estimatedUnits,
        isFallback: row.isFallback,
        sourceAssetIds: Array.isArray(row.sourceAssetIds)
          ? (row.sourceAssetIds as string[])
          : []
      };
    },

    async readRecords(): Promise<CostLedgerRecord[]> {
      const rows = await prisma.costRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" }
      });

      return rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        taskId: row.taskId,
        task: row.task,
        model: row.model,
        mode: row.mode,
        country: row.country,
        language: row.language,
        estimatedUnits: row.estimatedUnits,
        isFallback: row.isFallback,
        sourceAssetIds: Array.isArray(row.sourceAssetIds)
          ? (row.sourceAssetIds as string[])
          : []
      }));
    }
  };
}
