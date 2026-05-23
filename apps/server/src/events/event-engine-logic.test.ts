import { describe, expect, it } from "vitest";
import {
  evaluateTransition,
  normalizeEventDefinition,
  type EventRuntimeState,
} from "./event-engine-logic";

function createBaseDefinition(overrides?: Partial<ReturnType<typeof normalizeEventDefinition>>) {
  return {
    ...normalizeEventDefinition({
      id: "ev-1",
      enabled: true,
      sourceTagName: "Tag1",
      conditionMode: "bit",
      bitTrigger: "ON",
    }),
    ...overrides,
  };
}

function evaluateLevelAction(
  previous: EventRuntimeState,
  nextConditionActive: boolean,
): "activate" | "clear" | "none" {
  if (!previous.previousConditionActive && nextConditionActive) {
    return "activate";
  }
  if (previous.previousConditionActive && !nextConditionActive) {
    return "clear";
  }
  return "none";
}

describe("event engine condition evaluation", () => {
  it("evaluates bit ON", () => {
    const definition = createBaseDefinition({ bitTrigger: "ON" });
    const result = evaluateTransition({
      definition,
      state: { previousConditionActive: false, startupReadyAt: 0 },
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    expect(result.conditionActive).toBe(true);
  });

  it("evaluates bit OFF", () => {
    const definition = createBaseDefinition({ bitTrigger: "OFF" });
    const result = evaluateTransition({
      definition,
      state: { previousConditionActive: false, startupReadyAt: 0 },
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: false,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    expect(result.conditionActive).toBe(true);
  });

  it("detects OFF_TO_ON edge", () => {
    const definition = createBaseDefinition({ bitTrigger: "OFF_TO_ON" });
    const result = evaluateTransition({
      definition,
      state: {
        previousConditionActive: false,
        previousRawValue: false,
        startupReadyAt: 0,
      },
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    expect(result.edgeTriggered).toBe(true);
  });

  it("detects ON_TO_OFF edge", () => {
    const definition = createBaseDefinition({ bitTrigger: "ON_TO_OFF" });
    const result = evaluateTransition({
      definition,
      state: {
        previousConditionActive: false,
        previousRawValue: true,
        startupReadyAt: 0,
      },
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: false,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    expect(result.edgeTriggered).toBe(true);
  });

  it("evaluates word operators", () => {
    const cases: Array<["<" | ">" | "=" | "<>" | ">=" | "<=", number, number, boolean]> = [
      ["<", 1, 2, true],
      [">", 3, 2, true],
      ["=", 2, 2, true],
      ["<>", 2, 3, true],
      [">=", 2, 2, true],
      ["<=", 2, 2, true],
    ];

    for (const [op, value, threshold, expected] of cases) {
      const definition = createBaseDefinition({
        conditionMode: "word",
        wordOperator: op,
        wordValue: threshold,
      });

      const result = evaluateTransition({
        definition,
        state: { previousConditionActive: false, startupReadyAt: 0 },
        nowMs: 1,
        sourceValue: {
          name: "Tag1",
          value,
          quality: "Good",
          timestamp: 1,
          source: "test",
        },
      });

      expect(result.conditionActive).toBe(expected);
    }
  });

  it("does not duplicate activation while condition remains active", () => {
    const definition = createBaseDefinition({ bitTrigger: "ON" });
    const firstState: EventRuntimeState = {
      previousConditionActive: false,
      startupReadyAt: 0,
    };

    const first = evaluateTransition({
      definition,
      state: firstState,
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    const second = evaluateTransition({
      definition,
      state: first.nextState,
      nowMs: 2,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 2,
        source: "test",
      },
    });

    expect(evaluateLevelAction(firstState, first.conditionActive)).toBe("activate");
    expect(evaluateLevelAction(first.nextState, second.conditionActive)).toBe("none");
  });

  it("clears when level condition becomes false", () => {
    const definition = createBaseDefinition({ bitTrigger: "ON" });

    const first = evaluateTransition({
      definition,
      state: { previousConditionActive: false, startupReadyAt: 0 },
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    const second = evaluateTransition({
      definition,
      state: first.nextState,
      nowMs: 2,
      sourceValue: {
        name: "Tag1",
        value: false,
        quality: "Good",
        timestamp: 2,
        source: "test",
      },
    });

    expect(evaluateLevelAction(first.nextState, second.conditionActive)).toBe("clear");
  });

  it("blocks with security condition", () => {
    const definition = createBaseDefinition({
      securityEnabled: true,
      securityTagName: "Security",
      securityBitValue: true,
      bitTrigger: "ON",
    });

    const result = evaluateTransition({
      definition,
      state: { previousConditionActive: false, startupReadyAt: 0 },
      nowMs: 1,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
      securityValue: {
        name: "Security",
        value: false,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    });

    expect(result.conditionActive).toBe(false);
  });

  it("respects startup delay", () => {
    const definition = createBaseDefinition({ startupDelayMs: 1000, bitTrigger: "ON" });
    const result = evaluateTransition({
      definition,
      state: { previousConditionActive: false, startupReadyAt: 1000 },
      nowMs: 500,
      sourceValue: {
        name: "Tag1",
        value: true,
        quality: "Good",
        timestamp: 500,
        source: "test",
      },
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("startup-delay");
  });
});
