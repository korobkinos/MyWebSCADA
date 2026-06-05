import { describe, expect, it } from "vitest";
import { shouldRenderObjectForScreenBounds } from "./screen-bounds-culling";

describe("shouldRenderObjectForScreenBounds", () => {
  it("culls editor frame children outside the referenced screen when forced", () => {
    const screen = { width: 200, height: 100 };

    expect(shouldRenderObjectForScreenBounds(
      { x: 20, y: 20, width: 30, height: 30 },
      screen,
      { mode: "editor", forceScreenBoundsCulling: true },
    )).toBe(true);

    expect(shouldRenderObjectForScreenBounds(
      { x: 20, y: -80, width: 30, height: 30 },
      screen,
      { mode: "editor", forceScreenBoundsCulling: true },
    )).toBe(false);
  });
});
