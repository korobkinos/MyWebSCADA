import type { TagValue } from "@web-scada/shared";
import { describe, expect, it } from "vitest";
import {
  createRuntimeDependencyTagSignature,
  haveSameRuntimeSubscriptionTags,
} from "./runtime-subscription-state";

function tag(value: TagValue["value"], quality: TagValue["quality"] = "Good"): TagValue {
  return {
    name: "SelectedIndex",
    value,
    quality,
    timestamp: 1,
    source: "test",
  };
}

describe("createRuntimeDependencyTagSignature", () => {
  it("ignores timestamp and source changes when value and quality are unchanged", () => {
    const previous = tag(2);
    const next = { ...previous, timestamp: 2, source: "ws" };

    expect(createRuntimeDependencyTagSignature(["SelectedIndex"], { SelectedIndex: previous }))
      .toBe(createRuntimeDependencyTagSignature(["SelectedIndex"], { SelectedIndex: next }));
  });

  it("changes when dependency value, quality, or presence changes", () => {
    const current = createRuntimeDependencyTagSignature(["SelectedIndex"], { SelectedIndex: tag(2) });

    expect(createRuntimeDependencyTagSignature(["SelectedIndex"], { SelectedIndex: tag(3) })).not.toBe(current);
    expect(createRuntimeDependencyTagSignature(["SelectedIndex"], { SelectedIndex: tag(2, "Bad") })).not.toBe(current);
    expect(createRuntimeDependencyTagSignature(["SelectedIndex"], {})).not.toBe(current);
  });
});

describe("haveSameRuntimeSubscriptionTags", () => {
  it("treats reordered and duplicated tag lists as the same subscription", () => {
    expect(haveSameRuntimeSubscriptionTags(["B", "A"], [" A ", "B", "A"])).toBe(true);
  });

  it("detects a changed subscription list", () => {
    expect(haveSameRuntimeSubscriptionTags(["A", "B"], ["A", "C"])).toBe(false);
  });
});
