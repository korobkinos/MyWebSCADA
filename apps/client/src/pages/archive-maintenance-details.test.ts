import { describe, expect, it } from "vitest";
import { buildTrendMaintenanceHints } from "./archive-maintenance-details";

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
});
