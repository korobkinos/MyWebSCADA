import { describe, expect, it } from "vitest";
import { getSelectArrowPoints } from "./select-arrow";

describe("getSelectArrowPoints", () => {
  it("points down when closed and up when open", () => {
    expect(getSelectArrowPoints(20, 10, false)).toEqual([15, 8, 20, 13, 25, 8]);
    expect(getSelectArrowPoints(20, 10, true)).toEqual([15, 13, 20, 8, 25, 13]);
  });
});
