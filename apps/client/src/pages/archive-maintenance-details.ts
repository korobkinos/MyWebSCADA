import type { ArchiveStatus } from "../services/api";

export function buildTrendMaintenanceHints(status: ArchiveStatus): string[] {
  const hints: string[] = [];
  if (status.statusDetail) {
    hints.push(`Maintenance detail: ${status.statusDetail}`);
  }
  if (status.lastPruneReason) {
    hints.push(`Maintenance reason: ${status.lastPruneReason}`);
  }
  if (status.lastPruneError) {
    hints.push(`Maintenance error: ${status.lastPruneError}`);
  }
  return hints;
}
