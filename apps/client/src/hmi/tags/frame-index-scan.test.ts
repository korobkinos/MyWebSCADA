import { describe, expect, it } from "vitest";
import type { ElementLibrary, FrameTagIndexRule, HmiObject } from "@web-scada/shared";
import { evaluateFrameIndexScanItem, previewFrameIndexTag, scanFrameIndexTags, scanFrameIndexTagsDetailed } from "./frame-index-scan";

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
    indexOffsetSource: rule.indexOffsetSource,
    indexMode: rule.indexMode ?? {
      type: "arrayIndex",
      occurrence: 0,
      operation: "add",
      valueFrom: "indexOffset",
    },
    conflictMode: "skipLocal",
  };
}

function createLibraryWithChildTag(tag: string): ElementLibrary {
  return {
    id: "lib-1",
    name: "Main library",
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [],
    elements: [
      {
        id: "element-1",
        libraryId: "lib-1",
        name: "Element",
        width: 100,
        height: 100,
        objects: [
          {
            id: "child-text",
            type: "text",
            name: "Child text",
            x: 0,
            y: 0,
            width: 90,
            height: 20,
            text: "Child",
            tag,
            textStyle: {
              fontFamily: "Arial",
              fontSize: 12,
              color: "#fff",
              horizontalAlign: "left",
              verticalAlign: "middle",
            },
          },
        ],
        bindings: [
          {
            id: "bind-1",
            key: "stateTag",
            displayName: "State tag",
            kind: "state",
            defaultBaseTag: "Station[1].Pump[2].Run",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
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

  it("preview uses static source value", () => {
    const result = previewFrameIndexTag("A[2].B", [
      createRule({
        id: "rule-static",
        indexOffset: 1,
        indexOffsetSource: { type: "static", value: 5 },
      }),
    ]);
    expect(result.resolvedTag).toBe("A[7].B");
  });

  it("preview falls back when source is non-numeric", () => {
    const result = previewFrameIndexTag(
      "A[2].B",
      [
        createRule({
          id: "rule-bad-source",
          indexOffset: 3,
          indexOffsetSource: { type: "expression", expression: "\"abc\"" },
        }),
      ],
      { runtimeValues: {} },
    );
    expect(result.resolvedTag).toBe("A[5].B");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("scanner finds indexed tags inside libraryElementInstance and resolves bindings", () => {
    const library = createLibraryWithChildTag("$binding.stateTag");
    const items = scanFrameIndexTags(
      [{
        id: "instance-1",
        type: "libraryElementInstance",
        name: "Pump instance",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        libraryId: "lib-1",
        elementId: "element-1",
        bindingAssignments: {
          stateTag: {
            baseTag: "Station[1].Pump[2].Run",
          },
        },
      } as HmiObject],
      { libraries: [library] },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.rawTag).toBe("Station[1].Pump[2].Run");
    expect(items[0]?.objectName).toBe("Pump instance / Child text");
  });

  it("scanner applies parameterValues in libraryElementInstance", () => {
    const library = createLibraryWithChildTag("{{targetTag}}");
    const [element] = library.elements;
    element!.parameters = [{ name: "targetTag", type: "tag", defaultValue: "Station[0].Pump[0].Run" }];
    const items = scanFrameIndexTags(
      [{
        id: "instance-2",
        type: "libraryElementInstance",
        name: "Param instance",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        libraryId: "lib-1",
        elementId: "element-1",
        parameterValues: {
          targetTag: "Station[5].Pump[9].Run",
        },
      } as HmiObject],
      { libraries: [library] },
    );
    expect(items[0]?.rawTag).toBe("Station[5].Pump[9].Run");
  });

  it("scanner reports unresolved binding without crashing", () => {
    const library = createLibraryWithChildTag("$binding.missing");
    const [item] = scanFrameIndexTags(
      [{
        id: "instance-3",
        type: "libraryElementInstance",
        name: "Broken instance",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        libraryId: "lib-1",
        elementId: "element-1",
      } as HmiObject],
      { libraries: [library] },
    );
    const evaluation = evaluateFrameIndexScanItem(item!, []);
    expect(evaluation.status).toBe("Unresolved binding");
    expect(evaluation.preview).toBe("$binding.missing");
  });

  it("scanner keeps local override inside library child object", () => {
    const library = createLibraryWithChildTag("Line[1].State");
    const [element] = library.elements;
    const [child] = element!.objects;
    (child as HmiObject).tagIndexingByField = {
      tag: {
        enabled: true,
        template: "Line[0].State",
        bindings: [],
      },
    };
    const [item] = scanFrameIndexTags(
      [{
        id: "instance-4",
        type: "libraryElementInstance",
        name: "Override instance",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        libraryId: "lib-1",
        elementId: "element-1",
      } as HmiObject],
      { libraries: [library] },
    );
    expect(item?.hasLocalIndexing).toBe(true);
  });

  it("scanner returns diagnostics if library element is missing", () => {
    const result = scanFrameIndexTagsDetailed(
      [{
        id: "instance-5",
        type: "libraryElementInstance",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        libraryId: "missing-lib",
        elementId: "missing-element",
      } as HmiObject],
      { libraries: [] },
    );
    expect(result.items).toHaveLength(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
