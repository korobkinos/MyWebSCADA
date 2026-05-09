import { describe, expect, it } from "vitest";
import {
  applyTagIndexTransform,
  applyTagPrefixTransform,
  resolveLibraryElementInstanceBindingsDetailed,
  resolveLibraryElementInstanceBindings,
} from "../src/element-binding-resolver";

describe("applyTagPrefixTransform", () => {
  it("applies prefix by segment name for Burner", () => {
    expect(
      applyTagPrefixTransform("Burner.PZK_1.VisualState", "_1", {
        type: "segmentByName",
        segmentName: "Burner",
        position: "append",
      }),
    ).toBe("Burner_1.PZK_1.VisualState");
  });

  it("applies prefix by segment name for PZK_1", () => {
    expect(
      applyTagPrefixTransform("Burner.PZK_1.VisualState", "_1", {
        type: "segmentByName",
        segmentName: "PZK_1",
        position: "append",
      }),
    ).toBe("Burner.PZK_1_1.VisualState");
  });

  it("applies prefix to last segment", () => {
    expect(
      applyTagPrefixTransform("Burner.PZK_1.VisualState", "_1", {
        type: "lastSegment",
        position: "append",
      }),
    ).toBe("Burner.PZK_1.VisualState_1");
  });
});

describe("applyTagIndexTransform", () => {
  it("updates first array index with offset", () => {
    expect(
      applyTagIndexTransform("GVL_VALVE[0].VisualState", 32, {
        type: "arrayIndex",
        occurrence: 0,
        operation: "add",
        valueFrom: "indexOffset",
      }),
    ).toBe("GVL_VALVE[32].VisualState");
  });

  it("updates chosen occurrence in nested array path", () => {
    expect(
      applyTagIndexTransform("Burner[0].Valve[1].Opened", 32, {
        type: "arrayIndex",
        occurrence: 1,
        operation: "add",
        valueFrom: "indexOffset",
      }),
    ).toBe("Burner[0].Valve[33].Opened");
  });
});

describe("resolveLibraryElementInstanceBindings", () => {
  const element = {
    bindings: [
      {
        id: "b1",
        key: "visualState",
        displayName: "Visual state",
        kind: "state" as const,
        dataType: "INT" as const,
        required: true,
        defaultBaseTag: "Burner_1.PZK_1.VisualState",
      },
      {
        id: "b2",
        key: "opened",
        displayName: "Opened",
        kind: "tag" as const,
        dataType: "BOOL" as const,
        required: false,
        defaultBaseTag: "Burner_1.PZK_1.Opened",
      },
      {
        id: "b3",
        key: "fault",
        displayName: "Fault",
        kind: "tag" as const,
        dataType: "BOOL" as const,
        required: false,
        defaultBaseTag: "Burner_1.PZK_1.Fault",
      },
      {
        id: "b4",
        key: "fallbackOnly",
        displayName: "Fallback",
        kind: "tag" as const,
        dataType: "BOOL" as const,
        required: false,
        defaultBaseTag: "Burner_1.PZK_1.Closed",
      },
    ],
  };

  it("prefers overrideTag over baseTag and transforms", () => {
    const resolved = resolveLibraryElementInstanceBindings(element, {
      bindingAssignments: {
        visualState: {
          baseTag: "Burner_1.PZK_1.VisualState",
          prefix: "_X",
          prefixMode: { type: "lastSegment", position: "append" },
          overrideTag: "System.Override.VisualState",
        },
      },
    });

    expect(resolved.visualState).toBe("System.Override.VisualState");
  });

  it("applies baseTag + prefixMode", () => {
    const resolved = resolveLibraryElementInstanceBindings(element, {
      bindingAssignments: {
        opened: {
          baseTag: "Burner_1.PZK_1.Opened",
          prefix: "DEV_",
          prefixMode: { type: "segmentByName", segmentName: "PZK_1", position: "prepend" },
        },
      },
    });

    expect(resolved.opened).toBe("Burner_1.DEV_PZK_1.Opened");
  });

  it("applies baseTag + indexOffset + indexMode", () => {
    const resolved = resolveLibraryElementInstanceBindings(element, {
      bindingAssignments: {
        fault: {
          baseTag: "GVL_VALVE[0].Fault",
          indexOffset: 32,
          indexMode: { type: "arrayIndex", occurrence: 0, operation: "add", valueFrom: "indexOffset" },
        },
      },
    });

    expect(resolved.fault).toBe("GVL_VALVE[32].Fault");
  });

  it("uses defaultBaseTag when assignment is missing", () => {
    const resolved = resolveLibraryElementInstanceBindings(element, { bindingAssignments: {} });
    expect(resolved.fallbackOnly).toBe("Burner_1.PZK_1.Closed");
  });

  it("uses overrideTagSource with highest priority", () => {
    const resolved = resolveLibraryElementInstanceBindings(
      element,
      {
        bindingAssignments: {
          visualState: {
            baseTag: "Burner.PZK_1.VisualState",
            overrideTag: "Legacy.Override.Tag",
            overrideTagSource: { type: "internal", name: "selectedVisualOverride" },
          },
        },
      },
      {
        tagValues: {
          "LW.selectedVisualOverride": "Runtime.Override.Tag",
        },
      },
    );

    expect(resolved.visualState).toBe("Runtime.Override.Tag");
  });

  it("uses prefixSource over legacy prefix", () => {
    const resolved = resolveLibraryElementInstanceBindings(
      element,
      {
        bindingAssignments: {
          opened: {
            baseTag: "Burner.PZK_1.Opened",
            prefix: "_LEGACY",
            prefixSource: { type: "lw", address: 20 },
            prefixMode: { type: "segmentByName", segmentName: "Burner", position: "append" },
          },
        },
      },
      {
        tagValues: {
          LW20: "_2",
        },
      },
    );

    expect(resolved.opened).toBe("Burner_2.PZK_1.Opened");
  });

  it("uses indexOffsetSource over legacy indexOffset", () => {
    const resolved = resolveLibraryElementInstanceBindings(
      element,
      {
        bindingAssignments: {
          fault: {
            baseTag: "Burner[0].Valve[1].Fault",
            indexOffset: 1,
            indexOffsetSource: { type: "internal", name: "selectedValveOffset" },
            indexMode: { type: "arrayIndex", occurrence: 1, operation: "add", valueFrom: "indexOffset" },
          },
        },
      },
      {
        tagValues: {
          "LW.selectedValveOffset": 32,
        },
      },
    );

    expect(resolved.fault).toBe("Burner[0].Valve[33].Fault");
  });

  it("uses expression indexOffsetSource for burner and valve selection", () => {
    const resolved = resolveLibraryElementInstanceBindings(
      element,
      {
        bindingAssignments: {
          visualState: {
            baseTag: "GVL_VALVE.valves[0].VisualState",
            indexOffsetSource: {
              type: "expression",
              expression: "lw(20) * 32 + lw(10)",
            },
            indexMode: {
              type: "arrayIndex",
              occurrence: 0,
              operation: "add",
              valueFrom: "indexOffset",
            },
          },
        },
      },
      {
        tagValues: {
          LW20: 2,
          LW10: 5,
        },
      },
    );

    expect(resolved.visualState).toBe("GVL_VALVE.valves[69].VisualState");
  });

  it("returns debug info for expression-resolved binding", () => {
    const detailed = resolveLibraryElementInstanceBindingsDetailed(
      element,
      {
        bindingAssignments: {
          visualState: {
            baseTag: "GVL_VALVE.valves[0].VisualState",
            indexOffsetSource: {
              type: "expression",
              expression: "lw(20) * 32 + lw(10)",
            },
            indexMode: {
              type: "arrayIndex",
              occurrence: 0,
              operation: "add",
              valueFrom: "indexOffset",
            },
          },
        },
      },
      {
        tagValues: {
          LW20: 2,
          LW10: 5,
          "GVL_VALVE.valves[69].VisualState": {
            value: 3,
            quality: "Good",
            timestamp: 123,
            source: "test",
          },
        },
      },
    );

    expect(detailed.resolvedBindings.visualState).toBe("GVL_VALVE.valves[69].VisualState");
    expect(detailed.debug.visualState).toMatchObject({
      baseTag: "GVL_VALVE.valves[0].VisualState",
      indexOffsetValue: 69,
      resolvedTag: "GVL_VALVE.valves[69].VisualState",
      tagExists: true,
      tagValue: 3,
      tagQuality: "Good",
    });
  });

  it("returns issue for missing required binding", () => {
    const detailed = resolveLibraryElementInstanceBindingsDetailed(
      {
        bindings: [
          {
            id: "req1",
            key: "requiredTag",
            displayName: "Required tag",
            kind: "tag",
            required: true,
          },
        ],
      },
      { bindingAssignments: {} },
    );

    expect(detailed.resolvedBindings.requiredTag).toBeUndefined();
    expect(detailed.issues).toEqual([
      {
        key: "requiredTag",
        displayName: "Required tag",
        required: true,
        reason: "missing-required",
        fallbackBaseTag: undefined,
      },
    ]);
  });
});
