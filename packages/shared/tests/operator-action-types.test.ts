import { describe, expect, it } from "vitest";
import { isOperatorActionEnabledForObject } from "../src/operator-action-types";

describe("isOperatorActionEnabledForObject", () => {
  it("enables logging by default for supported object types", () => {
    expect(isOperatorActionEnabledForObject({ type: "button" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "checkbox" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "slider" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "numeric-input" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "select" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "radio-group" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "switch" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "valueSelect" })).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "value-input" })).toBe(true);
  });

  it("keeps unsupported object types disabled by default", () => {
    expect(isOperatorActionEnabledForObject({ type: "text" })).toBe(false);
  });

  it("respects explicit object-level enable/disable", () => {
    expect(isOperatorActionEnabledForObject({
      type: "text",
      operatorActionLogging: { enabled: true },
    })).toBe(true);
    expect(isOperatorActionEnabledForObject({
      type: "slider",
      operatorActionLogging: { enabled: false },
    })).toBe(false);
  });

  it("respects global project-level disable", () => {
    expect(isOperatorActionEnabledForObject(
      {
        type: "slider",
        operatorActionLogging: { enabled: true },
      },
      {
        operatorActionSettings: { enabled: false },
      },
    )).toBe(false);
  });
});
