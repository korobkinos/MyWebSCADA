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
  it("limits heavy marker animations to 30 FPS", () => {
    expect(shouldUpdateRuntimeFlowFrame(1_020, 1_000, true, 120)).toBe(false);
    expect(shouldUpdateRuntimeFlowFrame(1_034, 1_000, true, 120)).toBe(true);
  });

  it("keeps lightweight and dash animations at the display frame rate", () => {
    expect(shouldUpdateRuntimeFlowFrame(1_020, 1_000, true, 20)).toBe(true);
    expect(shouldUpdateRuntimeFlowFrame(1_020, 1_000, false, 400)).toBe(true);
  });
});
