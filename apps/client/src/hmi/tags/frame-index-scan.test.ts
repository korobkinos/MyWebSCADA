import { describe, expect, it } from "vitest";
import type { FrameTagIndexRule, HmiObject } from "@web-scada/shared";
import { evaluateFrameIndexScanItem, previewFrameIndexTag, scanFrameIndexTags } from "./frame-index-scan";

function createTextObject(patch: Partial<HmiObject> = {}): HmiObject {
  return {
    id: "text-1",
    type: "text",
    name: "Text 1",
    x: 0,
    y: 0,
    width: 120,
    height: 30,
    text: "Value",
    tag: "Burner[1].Valve[3].Open",
    textStyle: {
      fontFamily: "Arial",
      fontSize: 12,
      color: "#fff",
      horizontalAlign: "left",
      verticalAlign: "middle",
    },
    ...patch,
  } as HmiObject;
}

function createRule(rule: Partial<FrameTagIndexRule>): FrameTagIndexRule {
  return {
    id: rule.id ?? "rule-1",
    enabled: rule.enabled ?? true,
    name: rule.name,
    indexOffset: rule.indexOffset ?? 0,
    indexMode: rule.indexMode ?? {
      type: "arrayIndex",
      occurrence: 0,
      operation: "add",
      valueFrom: "indexOffset",
    },
    conflictMode: "skipLocal",
  };
}

describe("frame-index-scan", () => {
  it("finds indexes with occurrence and segmentName", () => {
    const items = scanFrameIndexTags([createTextObject()]);
    expect(items).toHaveLength(1);
    expect(items[0]?.indexTokens).toEqual([
      { occurrence: 0, segmentName: "Burner", value: 1, token: "[1]" },
      { occurrence: 1, segmentName: "Valve", value: 3, token: "[3]" },
    ]);
  });

  it("detects field-level local override", () => {
    const object = createTextObject({
      tagIndexingByField: {
        tag: {
          enabled: true,
          template: "Burner[0].Valve[0].Open",
          bindings: [],
        },
      },
    });
    const items = scanFrameIndexTags([object]);
    expect(items[0]?.hasLocalIndexing).toBe(true);
    expect(items[0]?.localIndexingSource).toBe("tagIndexingByField");
  });

  it("preview applies occurrence rule", () => {
    const result = previewFrameIndexTag("Burner[1].Valve[3].Open", [
      createRule({
        id: "rule-occ",
        indexOffset: 2,
        indexMode: {
          type: "arrayIndex",
          occurrence: 0,
          operation: "add",
          valueFrom: "indexOffset",
        },
      }),
    ]);
    expect(result.resolvedTag).toBe("Burner[3].Valve[3].Open");
    expect(result.matchedRuleIds).toEqual(["rule-occ"]);
  });

  it("preview applies segment rule", () => {
    const result = previewFrameIndexTag("Burner[1].Valve[3].Open", [
      createRule({
        id: "rule-segment",
        indexOffset: 4,
        indexMode: {
          type: "arrayIndexBySegment",
          segmentName: "Valve",
          operation: "add",
          valueFrom: "indexOffset",
        },
      }),
    ]);
    expect(result.resolvedTag).toBe("Burner[1].Valve[7].Open");
    expect(result.matchedRuleIds).toEqual(["rule-segment"]);
  });

  it("preview skips local override", () => {
    const [item] = scanFrameIndexTags([
      createTextObject({
        tagIndexingByField: {
          tag: {
            enabled: true,
            template: "Burner[0].Valve[0].Open",
            bindings: [],
          },
        },
      }),
    ]);
    const result = evaluateFrameIndexScanItem(item!, [
      createRule({
        id: "rule-1",
        indexOffset: 1,
      }),
    ]);
    expect(result.status).toBe("Local override");
    expect(result.preview).toBe("Skipped by local indexing");
  });

  it("preview applies multiple rules sequentially", () => {
    const result = previewFrameIndexTag("A[1].B[2].C", [
      createRule({
        id: "rule-1",
        indexOffset: 1,
        indexMode: {
          type: "arrayIndex",
          occurrence: 0,
          operation: "add",
          valueFrom: "indexOffset",
        },
      }),
      createRule({
        id: "rule-2",
        indexOffset: -2,
        indexMode: {
          type: "arrayIndexBySegment",
          segmentName: "B",
          operation: "add",
          valueFrom: "indexOffset",
        },
      }),
    ]);
    expect(result.resolvedTag).toBe("A[2].B[0].C");
    expect(result.matchedRuleIds).toEqual(["rule-1", "rule-2"]);
  });
});
