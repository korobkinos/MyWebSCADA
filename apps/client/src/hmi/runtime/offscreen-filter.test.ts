import { describe, expect, it } from "vitest";
import { intersectsScreenBounds } from "./offscreen-filter";

describe("intersectsScreenBounds", () => {
  const screen = { width: 1920, height: 1080 };

  it("returns true for fully inside object", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: 100, width: 200, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns true for partially intersecting object (left edge)", () => {
    expect(
      intersectsScreenBounds({ x: -50, y: 100, width: 200, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns true for partially intersecting object (right edge)", () => {
    expect(
      intersectsScreenBounds({ x: 1800, y: 100, width: 200, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns true for partially intersecting object (top edge)", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: -50, width: 200, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns true for partially intersecting object (bottom edge)", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: 1000, width: 200, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns false for object fully to the right of screen", () => {
    expect(
      intersectsScreenBounds({ x: 2000, y: 100, width: 200, height: 150 }, screen)
    ).toBe(false);
  });

  it("returns false for object fully to the left of screen", () => {
    expect(
      intersectsScreenBounds({ x: -300, y: 100, width: 200, height: 150 }, screen)
    ).toBe(false);
  });

  it("returns false for object fully below screen", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: 1200, width: 200, height: 150 }, screen)
    ).toBe(false);
  });

  it("returns false for object fully above screen", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: -200, width: 200, height: 150 }, screen)
    ).toBe(false);
  });

  it("returns true for object exactly at left screen edge", () => {
    expect(
      intersectsScreenBounds({ x: -100, y: 100, width: 100, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns true for object exactly at top screen edge", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: -100, width: 200, height: 100 }, screen)
    ).toBe(true);
  });

  it("returns true for object exactly at right screen edge", () => {
    expect(
      intersectsScreenBounds({ x: 1820, y: 100, width: 100, height: 150 }, screen)
    ).toBe(true);
  });

  it("returns true for object exactly at bottom screen edge", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: 980, width: 200, height: 100 }, screen)
    ).toBe(true);
  });

  it("returns false for zero-size object outside screen", () => {
    expect(
      intersectsScreenBounds({ x: -10, y: -10, width: 0, height: 0 }, screen)
    ).toBe(false);
  });

  it("returns true for zero-size object at screen origin", () => {
    expect(
      intersectsScreenBounds({ x: 0, y: 0, width: 0, height: 0 }, screen)
    ).toBe(true);
  });

  it("returns true for zero-size object inside screen", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: 100, width: 0, height: 0 }, screen)
    ).toBe(true);
  });

  it("returns true for object covering the entire screen", () => {
    expect(
      intersectsScreenBounds({ x: 0, y: 0, width: 1920, height: 1080 }, screen)
    ).toBe(true);
  });

  it("handles undefined x/y gracefully", () => {
    expect(
      intersectsScreenBounds({ x: undefined as unknown as number, y: undefined as unknown as number, width: 100, height: 100 }, screen)
    ).toBe(true);
  });

  it("handles negative width/height gracefully", () => {
    expect(
      intersectsScreenBounds({ x: 100, y: 100, width: -50, height: -50 }, screen)
    ).toBe(true);
  });
});
