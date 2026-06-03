import { describe, expect, it } from "vitest";
import { combineTagPrefix, extractBindingKey, isBindingReference, resolveRuntimeAction, resolveTagName } from "../src/render-context";

describe("combineTagPrefix", () => {
  it("combines relative child with parent", () => {
    expect(combineTagPrefix("Burner_1", ".PZK_1")).toBe("Burner_1.PZK_1");
  });

  it("keeps absolute child prefix", () => {
    expect(combineTagPrefix("Burner_1", "Pump_1")).toBe("Pump_1");
  });

  it("uses parent when child missing", () => {
    expect(combineTagPrefix("Burner_1", undefined)).toBe("Burner_1");
  });
});

describe("resolveTagName", () => {
  it("resolves relative tag with prefix", () => {
    expect(resolveTagName(".Opened", { tagPrefix: "Burner_1.PZK_1" })).toBe("Burner_1.PZK_1.Opened");
  });

  it("resolves CloseCmd for PZK_2", () => {
    expect(resolveTagName(".CloseCmd", { tagPrefix: "VALVES.PZK_2" })).toBe("VALVES.PZK_2.CloseCmd");
  });

  it("resolves Fault for KZ", () => {
    expect(resolveTagName(".Fault", { tagPrefix: "VALVES.KZ" })).toBe("VALVES.KZ.Fault");
  });

  it("keeps absolute tag", () => {
    expect(resolveTagName("System.Time", { tagPrefix: "Burner_1.PZK_1" })).toBe("System.Time");
  });

  it("returns relative without dot when prefix missing", () => {
    expect(resolveTagName(".Opened", {})).toBe("Opened");
  });

  it("resolves binding reference from context", () => {
    expect(resolveTagName("$binding.visualState", { bindings: { visualState: "Burner_1.PZK_1.VisualState" } })).toBe(
      "Burner_1.PZK_1.VisualState",
    );
  });

  it("returns undefined for missing binding reference", () => {
    expect(resolveTagName("$binding.visualState", { bindings: {} })).toBeUndefined();
  });
});

describe("frame nested resolving", () => {
  it("resolves nested prefixes for frame tags", () => {
    const nestedPrefix = combineTagPrefix("Burner_1", ".PZK_1");
    const leafPrefix = combineTagPrefix(nestedPrefix, ".Valve");
    expect(resolveTagName(".OpenCmd", { tagPrefix: leafPrefix })).toBe("Burner_1.PZK_1.Valve.OpenCmd");
  });
});

describe("binding helpers", () => {
  it("detects binding references and extracts key", () => {
    expect(isBindingReference("$binding.opened")).toBe(true);
    expect(extractBindingKey("$binding.opened")).toBe("opened");
  });

  it("returns undefined for non-binding tag", () => {
    expect(isBindingReference("Burner_1.PZK_1.Opened")).toBe(false);
    expect(extractBindingKey("Burner_1.PZK_1.Opened")).toBeUndefined();
  });
});

describe("resolveRuntimeAction openPopup", () => {
  it("preserves popup tag index rules while resolving prefix and args", () => {
    const action = resolveRuntimeAction(
      {
        type: "openPopup",
        popupScreenId: "Popup_ValveControl",
        tagPrefix: ".PZK_1",
        args: {
          valveName: "{{name}}",
        },
        tagIndexRules: [
          {
            id: "rule-1",
            enabled: true,
            indexOffset: 3,
            indexMode: {
              type: "arrayIndex",
              occurrence: 0,
              operation: "add",
              valueFrom: "indexOffset",
            },
          },
        ],
      },
      {
        tagPrefix: "VALVES",
        parameters: {
          name: "PZK-1",
        },
      },
    );

    expect(action.type).toBe("openPopup");
    expect(action.tagPrefix).toBe("VALVES.PZK_1");
    expect(action.args).toEqual({ valveName: "PZK-1" });
    expect(action.tagIndexRules).toEqual([
      {
        id: "rule-1",
        enabled: true,
        indexOffset: 3,
        indexMode: {
          type: "arrayIndex",
          occurrence: 0,
          operation: "add",
          valueFrom: "indexOffset",
        },
      },
    ]);
  });

  it("combines parent and relative popup prefix", () => {
    const action = resolveRuntimeAction(
      {
        type: "openPopup",
        popupScreenId: "Popup_ValveControl",
        tagPrefix: ".PZK_1",
      },
      {
        tagPrefix: "VALVES",
      },
    );

    expect(action.type).toBe("openPopup");
    expect(action.tagPrefix).toBe("VALVES.PZK_1");
  });

  it("resolves popup args from parameters", () => {
    const action = resolveRuntimeAction(
      {
        type: "openPopup",
        popupScreenId: "Popup_ValveControl",
        args: {
          valveName: "{{name}}",
          valvePrefix: "{{prefix}}",
        },
      },
      {
        parameters: {
          name: "ПЗК-1",
          prefix: "VALVES.PZK_1",
        },
      },
    );

    expect(action.type).toBe("openPopup");
    expect(action.args).toEqual({
      valveName: "ПЗК-1",
      valvePrefix: "VALVES.PZK_1",
    });
  });
});
