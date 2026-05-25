import { describe, expect, it } from "vitest";
import {
  buildTrendMaintenanceHints,
  defaultArchiveSectionOpenState,
  trendCompactFieldLabels,
} from "./archive-maintenance-details";

describe("buildTrendMaintenanceHints", () => {
  it("includes maintenance detail and error text when present", () => {
    const hints = buildTrendMaintenanceHints({
      enabled: true,
      queuedSamples: 0,
      statusDetail: "delete_failed",
      lastPruneReason: "size pruning delete failed",
      lastPruneError: "canceling statement due to statement timeout",
    });

    expect(hints).toEqual([
      "Maintenance detail: delete_failed",
      "Maintenance reason: size pruning delete failed",
      "Maintenance error: canceling statement due to statement timeout",
    ]);
  });

  it("defaults advanced diagnostics as hidden and provides compact trend labels", () => {
    const sections = defaultArchiveSectionOpenState();
    expect(sections).toEqual({
      trend: true,
      event: false,
      operator: false,
      trendAdvancedDiagnostics: false,
      eventAdvancedDiagnostics: false,
      operatorAdvancedDiagnostics: false,
    });
    expect(trendCompactFieldLabels()).toContain("Cleanup speed");
    expect(trendCompactFieldLabels()).toContain("Maintenance detail");
    expect(trendCompactFieldLabels()).not.toContain("Start threshold");
    expect(trendCompactFieldLabels()).not.toContain("Actual records");
  });
});
