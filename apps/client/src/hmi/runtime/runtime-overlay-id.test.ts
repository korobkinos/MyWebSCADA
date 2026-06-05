import { describe, expect, it } from "vitest";
import { getRuntimeOverlayObjectId, isRuntimeOverlayOpenForObject } from "./runtime-overlay-id";

describe("runtime overlay ids", () => {
  it("includes renderer node prefix for nested objects", () => {
    expect(getRuntimeOverlayObjectId("select-1", "frame-popup-")).toBe("frame-popup-select-1");
  });

  it("matches only the exact prefixed object id", () => {
    expect(isRuntimeOverlayOpenForObject({ objectId: "frame-popup-select-1" }, "select-1", "frame-popup-")).toBe(true);
    expect(isRuntimeOverlayOpenForObject({ objectId: "select-1" }, "select-1", "frame-popup-")).toBe(false);
  });
});
