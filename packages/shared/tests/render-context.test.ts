import { describe, expect, it } from "vitest";
import { combineTagPrefix, resolveTagName } from "../src/render-context";

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
});

describe("frame nested resolving", () => {
  it("resolves nested prefixes for frame tags", () => {
    const nestedPrefix = combineTagPrefix("Burner_1", ".PZK_1");
    const leafPrefix = combineTagPrefix(nestedPrefix, ".Valve");
    expect(resolveTagName(".OpenCmd", { tagPrefix: leafPrefix })).toBe("Burner_1.PZK_1.Valve.OpenCmd");
  });
});
