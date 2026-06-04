import { describe, expect, it } from "vitest";
import {
  shouldRunRuntimeAnimationTick,
  shouldUpdateRuntimeFlowFrame,
} from "./runtime-animation-policy";

describe("shouldRunRuntimeAnimationTick", () => {
  it("does not run configured animations while inactive or stopped", () => {
    expect(shouldRunRuntimeAnimationTick(true, false, 80)).toBe(false);
    expect(shouldRunRuntimeAnimationTick(true, true, 0)).toBe(false);
  });

  it("runs active animations with a finite non-zero speed", () => {
    expect(shouldRunRuntimeAnimationTick(true, true, 80)).toBe(true);
    expect(shouldRunRuntimeAnimationTick(true, true, -80)).toBe(true);
  });
});

describe("shouldUpdateRuntimeFlowFrame", () => {
  it("throttles marker animations by marker count", () => {
    expect(shouldUpdateRuntimeFlowFrame(1_030, 1_000, true, 49)).toBe(false);
    expect(shouldUpdateRuntimeFlowFrame(1_034, 1_000, true, 49)).toBe(true);
    expect(shouldUpdateRuntimeFlowFrame(1_060, 1_000, true, 50)).toBe(false);
    expect(shouldUpdateRuntimeFlowFrame(1_067, 1_000, true, 50)).toBe(true);
    expect(shouldUpdateRuntimeFlowFrame(1_099, 1_000, true, 150)).toBe(false);
    expect(shouldUpdateRuntimeFlowFrame(1_100, 1_000, true, 150)).toBe(true);
    expect(shouldUpdateRuntimeFlowFrame(1_199, 1_000, true, 300)).toBe(false);
    expect(shouldUpdateRuntimeFlowFrame(1_200, 1_000, true, 300)).toBe(true);
  });

  it("keeps lightweight and dash animations at the display frame rate", () => {
    expect(shouldUpdateRuntimeFlowFrame(1_020, 1_000, false, 400)).toBe(true);
    expect(shouldUpdateRuntimeFlowFrame(1_000, null, true, 400)).toBe(true);
  });
});
