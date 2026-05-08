import { describe, expect, it, vi } from "vitest";
import { getRuntimeValueSourceDependencies, resolveRuntimeValueSync } from "../src/runtime-value-resolver";

describe("resolveRuntimeValueSync", () => {
  it("resolves static source", () => {
    expect(resolveRuntimeValueSync({ type: "static", value: "_2" }, {})).toBe("_2");
  });

  it("resolves internal source via tagValues", () => {
    expect(
      resolveRuntimeValueSync(
        { type: "internal", name: "selectedBurnerPrefix" },
        {
          tagValues: {
            "LW.selectedBurnerPrefix": "_3",
          },
        },
      ),
    ).toBe("_3");
  });

  it("resolves lw source via tagValues", () => {
    expect(
      resolveRuntimeValueSync(
        { type: "lw", address: 20 },
        {
          tagValues: {
            LW20: 10,
          },
        },
      ),
    ).toBe(10);
  });

  it("warns for expression source", () => {
    const warn = vi.fn();
    const result = resolveRuntimeValueSync(
      { type: "expression", expression: "1+1" },
      { warn },
    );
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("getRuntimeValueSourceDependencies", () => {
  it("returns dependency for internal source", () => {
    expect(getRuntimeValueSourceDependencies({ type: "internal", name: "selectedBurnerPrefix" })).toEqual([
      { type: "internal", name: "selectedBurnerPrefix" },
    ]);
  });
});

