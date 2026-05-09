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

  it("evaluates expression source", () => {
    const warn = vi.fn();

    const result = resolveRuntimeValueSync(
      { type: "expression", expression: "1+1" },
      { warn },
    );

    expect(result).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns for invalid expression source", () => {
    const warn = vi.fn();

    const result = resolveRuntimeValueSync(
      { type: "expression", expression: "unknownFn(1)" },
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

  it("returns dependencies for expression source", () => {
    expect(
      getRuntimeValueSourceDependencies({
        type: "expression",
        expression: "tag('Burner.Selected') + lw(20) + internal('ValveIndex')",
      }),
    ).toEqual([
      { type: "tag", tag: "Burner.Selected" },
      { type: "lw", address: 20 },
      { type: "internal", name: "ValveIndex" },
    ]);
  });

  it("returns no dependencies for static source", () => {
    expect(getRuntimeValueSourceDependencies({ type: "static", value: 123 })).toEqual([]);
  });
});