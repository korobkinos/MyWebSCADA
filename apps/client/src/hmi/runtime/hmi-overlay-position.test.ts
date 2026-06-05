import { describe, expect, it } from "vitest";
import { resolveRuntimeOverlayViewportRect } from "./hmi-overlay-position";

describe("resolveRuntimeOverlayViewportRect", () => {
  it("converts canvas-relative overlay coordinates to viewport coordinates", () => {
    expect(resolveRuntimeOverlayViewportRect({
      wrapRect: { left: 20, top: 30 },
      scrollLeft: 5,
      scrollTop: 7,
      overlay: { x: 100, y: 120, width: 240, height: 180 },
    })).toEqual({
      left: 115,
      top: 143,
      width: 240,
      height: 180,
    });
  });
});
