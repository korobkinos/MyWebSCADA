import { describe, expect, it } from "vitest";
import { isOperatorActionEnabledForObject } from "../src/operator-action-types";

const projectEnabled = { operatorActionSettings: { enabled: true } };
const projectDisabled = { operatorActionSettings: { enabled: false } };

describe("isOperatorActionEnabledForObject", () => {
  it("enables logging by default for supported object types", () => {
    expect(isOperatorActionEnabledForObject({ type: "button" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "checkbox" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "slider" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "numeric-input" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "select" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "radio-group" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "switch" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "valueSelect" }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({ type: "value-input" }, projectEnabled)).toBe(true);
  });

  it("keeps unsupported object types disabled by default", () => {
    expect(isOperatorActionEnabledForObject({ type: "text" }, projectEnabled)).toBe(false);
  });

  it("respects explicit object-level enable/disable", () => {
    expect(isOperatorActionEnabledForObject({
      type: "text",
      operatorActionLogging: { enabled: true },
    }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({
      type: "button",
      operatorActionLogging: { enabled: true },
    }, projectEnabled)).toBe(true);
    expect(isOperatorActionEnabledForObject({
      type: "button",
      operatorActionLogging: { enabled: false },
    }, projectEnabled)).toBe(false);
    expect(isOperatorActionEnabledForObject({
      type: "slider",
      operatorActionLogging: { enabled: false },
    }, projectEnabled)).toBe(false);
  });

  it("respects global project-level disable", () => {
    expect(isOperatorActionEnabledForObject({ type: "button" }, projectDisabled)).toBe(false);
    expect(isOperatorActionEnabledForObject(
      {
        type: "slider",
        operatorActionLogging: { enabled: true },
      },
      projectDisabled,
    )).toBe(false);
  });
});
