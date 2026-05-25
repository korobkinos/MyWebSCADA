import type { ArchiveStatus } from "../services/api";

export type ArchiveSectionOpenState = {
  trend: boolean;
  event: boolean;
  operator: boolean;
  trendAdvancedDiagnostics: boolean;
  eventAdvancedDiagnostics: boolean;
  operatorAdvancedDiagnostics: boolean;
};

export function defaultArchiveSectionOpenState(): ArchiveSectionOpenState {
  return {
    trend: true,
    event: false,
    operator: false,
    trendAdvancedDiagnostics: false,
    eventAdvancedDiagnostics: false,
    operatorAdvancedDiagnostics: false,
  };
}

export function trendCompactFieldLabels(): string[] {
  return [
    "Status",
    "Maintenance detail",
    "DB Size",
    "Max DB",
    "Records",
    "Deleted last batch",
    "Deleted in run",
    "Cleanup speed",
    "Last batch duration",
    "Next run",
  ];
}

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
