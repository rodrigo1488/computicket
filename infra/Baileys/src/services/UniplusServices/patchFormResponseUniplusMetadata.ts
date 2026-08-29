import FormResponse from "../../models/FormResponse";
import { logger } from "../../utils/logger";

export type UniplusSyncStatus =
  | "pending"
  | "synced"
  | "error"
  | "skipped_preflight";

export interface UniplusMetadataPatch {
  uniplusStatus?: UniplusSyncStatus;
  uniplusLastError?: string | null;
  uniplusLastErrorAt?: string | null;
  uniplusContaId?: number | null;
  uniplusSyncedAt?: string | null;
  uniplusAction?: string | null;
  uniplusNumeromesa?: number | null;
  uniplusJobId?: number | null;
  printStatus?: "pending" | "synced" | "error";
  printLastError?: string | null;
  printSyncedAt?: string | null;
}

export async function patchFormResponseUniplusMetadata(
  formResponseId: number | null | undefined,
  patch: UniplusMetadataPatch
): Promise<void> {
  if (!formResponseId) return;
  try {
    const response = await FormResponse.findByPk(formResponseId);
    if (!response) return;
    const meta = {
      ...((response.metadata as Record<string, unknown>) || {}),
      ...patch,
    };
    // Limpa campos null explicitamente
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) {
        meta[k] = null;
      }
    }
    await response.update({ metadata: meta });
  } catch (err: any) {
    logger.warn(
      `patchFormResponseUniplusMetadata(${formResponseId}): ${err?.message}`
    );
  }
}
