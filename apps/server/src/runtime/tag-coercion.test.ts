import { describe, expect, it } from "vitest";
import type { TagDefinition, TagScalarValue } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";
import { coerceTagValue } from "./tag-coercion.js";

function createTagStore(definitions: TagDefinition[]): TagStore {
  const store = new TagStore();
  store.setDefinitions(definitions);
  return store;
}

describe("coerceTagValue", () => {
  it("returns null as-is", () => {
    const store = createTagStore([{ name: "T1", dataType: "REAL" }]);
    expect(coerceTagValue("T1", null, store)).toBeNull();
  });

  it("skips unknown tag definitions", () => {
    const store = createTagStore([]);
    expect(coerceTagValue("UNKNOWN", "42", store)).toBe("42");
  });

  it("coerces BOOL values", () => {
    const store = createTagStore([{ name: "B1", dataType: "BOOL" }]);
    expect(coerceTagValue("B1", true, store)).toBe(true);
    expect(coerceTagValue("B1", 0, store)).toBe(false);
    expect(coerceTagValue("B1", "yes", store)).toBe(true);
  });

  it("coerces integer values", () => {
    const store = createTagStore([{ name: "I1", dataType: "INT" }]);
    expect(coerceTagValue("I1", 42.9, store)).toBe(42);
    expect(coerceTagValue("I1", "123", store)).toBe(123);
    expect(coerceTagValue("I1", false, store)).toBe(0);
  });

  it("coerces REAL values", () => {
    const store = createTagStore([{ name: "R1", dataType: "REAL" }]);
    expect(coerceTagValue("R1", 12.5, store)).toBe(12.5);
    expect(coerceTagValue("R1", "12.5", store)).toBe(12.5);
    expect(coerceTagValue("R1", true, store)).toBe(1);
  });

  it("coerces STRING values", () => {
    const store = createTagStore([{ name: "S1", dataType: "STRING" }]);
    expect(coerceTagValue("S1", "text", store)).toBe("text");
    expect(coerceTagValue("S1", 100, store)).toBe("100");
    expect(coerceTagValue("S1", false, store)).toBe("false");
  });

  it("throws for invalid conversion", () => {
    const store = createTagStore([{ name: "R1", dataType: "REAL" }]);
    const value: TagScalarValue = "not-a-number";
    expect(() => coerceTagValue("R1", value, store)).toThrow(
      "Macro: cannot convert value 'not-a-number' to dataType REAL for tag 'R1'",
    );
  });
});
