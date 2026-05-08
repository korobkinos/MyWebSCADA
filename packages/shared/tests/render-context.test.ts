import { describe, expect, it } from "vitest";
import { combineTagPrefix, extractBindingKey, isBindingReference, resolveTagName } from "../src/render-context";

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
