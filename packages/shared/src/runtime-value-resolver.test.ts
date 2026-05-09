
import { describe, expect, it } from "vitest";
import {
  getRuntimeValueSourceDependencies,
  resolveRuntimeValueSync,
  type RuntimeResolveContext,
} from "./runtime-value-resolver";

describe("runtime-value-resolver expression", () => {
  it("evaluates arithmetic expressions with LW values", () => {
    const context: RuntimeResolveContext = {
      lwStore: {
        getLW(address) {
          if (address === 20) {
            return 2;
          }
          if (address === 10) {
            return 5;
          }
          return undefined;
        },
      },
    };

    const value = resolveRuntimeValueSync(
      {
        type: "expression",
        expression: "lw(20) * 32 + lw(10)",
      },
      context,
    );

    expect(value).toBe(69);
  });

  it("evaluates string expressions", () => {
    const context: RuntimeResolveContext = {
      lwStore: {
        getLW(address) {
          return address === 20 ? 3 : undefined;
        },
      },
    };

    const value = resolveRuntimeValueSync(
      {
        type: "expression",
        expression: "'Burner_' + str(lw(20))",
      },
      context,
    );

    expect(value).toBe("Burner_3");
  });

  it("reads tag and internal values in expressions", () => {
    const context: RuntimeResolveContext = {
      tagValues: {
        "Burner.Selected": { value: 4, quality: "Good" },
        "LW.ValveIndex": { value: 7, quality: "Good" },
      },
    };

    const tagValue = resolveRuntimeValueSync(
      {
        type: "expression",
        expression: "tag('Burner.Selected') * 10",
      },
      context,
    );

    const internalValue = resolveRuntimeValueSync(
      {
        type: "expression",
        expression: "internal('ValveIndex') + 1",
      },
      context,
    );

    expect(tagValue).toBe(40);
    expect(internalValue).toBe(8);
  });

  it("returns undefined and emits warning for invalid expressions", () => {
    const warnings: string[] = [];
    const context: RuntimeResolveContext = {
      warn(warning) {
        warnings.push(warning.message);
      },
    };

    const value = resolveRuntimeValueSync(
      {
        type: "expression",
        expression: "unknownFn(1)",
      },
      context,
    );

    expect(value).toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Unknown function");
  });

  it("extracts dependencies from expression sources", () => {
    const dependencies = getRuntimeValueSourceDependencies({
      type: "expression",
      expression: "tag('Burner.Selected') * 32 + lw(10) + internal('ValveIndex') + lw(20)",
    });

    expect(dependencies).toEqual([
      { type: "tag", tag: "Burner.Selected" },
      { type: "lw", address: 10 },
      { type: "lw", address: 20 },
      { type: "internal", name: "ValveIndex" },
    ]);
  });

  it("returns no dependencies for static values", () => {
    const dependencies = getRuntimeValueSourceDependencies({
      type: "static",
      value: 123,
    });

    expect(dependencies).toEqual([]);
  });
});
