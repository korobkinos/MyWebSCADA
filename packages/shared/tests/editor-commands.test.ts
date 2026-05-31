import { describe, expect, it } from "vitest";
import type { HmiObject, HmiScreen } from "../src/hmi-object-types";
import {
  alignSelected,
  distributeSelected,
  executeEditorCommand,
  getObjectBounds,
  makeSameSize,
  spaceSelected,
  type EditorSelectionState,
} from "../src/editor-commands";

function rectObject(id: string, x: number, y: number, width: number, height: number, locked = false): HmiObject {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    locked,
  };
}

function lineObject(
  id: string,
  x: number,
  y: number,
  points: number[],
  options?: { locked?: boolean; name?: string; stroke?: string; strokeWidth?: number },
): HmiObject {
  return {
    id,
    type: "line",
    x,
    y,
    width: 100,
    height: 100,
    points,
    stroke: options?.stroke ?? "#d9d9d9",
    strokeWidth: options?.strokeWidth ?? 3,
    locked: options?.locked ?? false,
    name: options?.name,
  };
}

function screenWith(objects: HmiObject[]): HmiScreen {
  return {
    id: "s1",
    name: "Screen",
    kind: "screen",
    width: 800,
    height: 600,
    objects,
    background: "#000",
  };
}

function selection(ids: string[], activeObjectId?: string): EditorSelectionState {
  return {
    selectedObjectIds: ids,
    activeObjectId,
  };
}

function byId(screen: HmiScreen, id: string): HmiObject {
  const found = screen.objects.find((obj) => obj.id === id);
  if (!found) {
    throw new Error(`Object ${id} not found`);
  }
  return found;
}

describe("group/ungroup", () => {
  it("groups selected objects and normalizes child coordinates", () => {
    const screen = screenWith([rectObject("a", 100, 100, 20, 20), rectObject("b", 160, 130, 30, 30)]);
    const result = executeEditorCommand(screen, selection(["a", "b"], "b"), { type: "groupSelected" });
    expect(result.screen.objects).toHaveLength(1);
    const group = result.screen.objects[0];
    expect(group?.type).toBe("group");
    if (!group || group.type !== "group") {
      return;
    }
    expect(group.x).toBe(100);
    expect(group.y).toBe(100);
    const childA = group.objects.find((obj) => obj.id === "a");
    const childB = group.objects.find((obj) => obj.id === "b");
    expect(childA?.x).toBe(0);
    expect(childA?.y).toBe(0);
    expect(childB?.x).toBe(60);
    expect(childB?.y).toBe(30);
  });

  it("ungroups and restores absolute coordinates", () => {
    const grouped = executeEditorCommand(
      screenWith([rectObject("a", 100, 100, 20, 20), rectObject("b", 160, 130, 30, 30)]),
      selection(["a", "b"]),
      { type: "groupSelected" },
    );
    const groupId = grouped.selection.selectedObjectIds[0];
    const ungrouped = executeEditorCommand(grouped.screen, selection(groupId ? [groupId] : []), { type: "ungroupSelected" });
    expect(byId(ungrouped.screen, "a").x).toBe(100);
    expect(byId(ungrouped.screen, "a").y).toBe(100);
    expect(byId(ungrouped.screen, "b").x).toBe(160);
    expect(byId(ungrouped.screen, "b").y).toBe(130);
  });
});

describe("alignment", () => {
  it("aligns left and skips locked objects", () => {
    const screen = screenWith([rectObject("a", 100, 10, 20, 20), rectObject("b", 150, 20, 20, 20), rectObject("c", 300, 30, 20, 20, true)]);
    const result = alignSelected(screen, selection(["a", "b", "c"]), "alignLeft");
    expect(byId(result.screen, "a").x).toBe(100);
    expect(byId(result.screen, "b").x).toBe(100);
    expect(byId(result.screen, "c").x).toBe(300);
  });

  it("aligns vertical center", () => {
    const screen = screenWith([rectObject("a", 0, 0, 10, 10), rectObject("b", 30, 40, 10, 30)]);
    const result = alignSelected(screen, selection(["a", "b"]), "alignVerticalCenter");
    expect(byId(result.screen, "a").y).toBe(30);
    expect(byId(result.screen, "b").y).toBe(20);
  });

  it("aligns horizontal center for rotated triangles (line objects)", () => {
    const triangleA: HmiObject = {
      id: "tri-a",
      type: "line",
      x: 100,
      y: 100,
      width: 90,
      height: 80,
      points: [45, 0, 90, 80, 0, 80],
      stroke: "#8c8c8c",
      strokeWidth: 2,
      closed: true,
      fill: "#262626",
      rotation: 28,
    };
    const triangleB: HmiObject = {
      id: "tri-b",
      type: "line",
      x: 220,
      y: 150,
      width: 90,
      height: 80,
      points: [45, 0, 90, 80, 0, 80],
      stroke: "#8c8c8c",
      strokeWidth: 2,
      closed: true,
      fill: "#262626",
      rotation: -17,
    };
    const screen = screenWith([triangleA, triangleB]);

    const result = alignSelected(screen, selection(["tri-a", "tri-b"]), "alignHorizontalCenter");
    const a = byId(result.screen, "tri-a");
    const b = byId(result.screen, "tri-b");
    const boundsA = getObjectBounds(a);
    const boundsB = getObjectBounds(b);
    const centerA = boundsA.x + boundsA.width / 2;
    const centerB = boundsB.x + boundsB.width / 2;

    expect(Math.abs(centerA - centerB)).toBeLessThan(1e-6);
  });
});

describe("same size", () => {
  it("uses active object size as reference", () => {
    const screen = screenWith([rectObject("a", 0, 0, 10, 10), rectObject("b", 30, 0, 20, 40), rectObject("c", 60, 0, 8, 8)]);
    const result = makeSameSize(screen, selection(["a", "b", "c"], "b"), "makeSameSize");
    expect(byId(result.screen, "a").width).toBe(20);
    expect(byId(result.screen, "a").height).toBe(40);
    expect(byId(result.screen, "c").width).toBe(20);
    expect(byId(result.screen, "c").height).toBe(40);
    expect(byId(result.screen, "b").width).toBe(20);
  });
});

describe("distribution", () => {
  it("distributes objects horizontally", () => {
    const screen = screenWith([rectObject("a", 0, 0, 10, 10), rectObject("b", 100, 0, 10, 10), rectObject("c", 160, 0, 10, 10)]);
    const result = distributeSelected(screen, selection(["a", "b", "c"]), "distributeHorizontally");
    expect(byId(result.screen, "a").x).toBe(0);
    expect(byId(result.screen, "b").x).toBe(80);
    expect(byId(result.screen, "c").x).toBe(160);
  });

  it("distributes objects vertically", () => {
    const screen = screenWith([rectObject("a", 0, 0, 10, 10), rectObject("b", 0, 40, 10, 10), rectObject("c", 0, 100, 10, 10)]);
    const result = distributeSelected(screen, selection(["a", "b", "c"]), "distributeVertically");
    expect(byId(result.screen, "a").y).toBe(0);
    expect(byId(result.screen, "b").y).toBe(50);
    expect(byId(result.screen, "c").y).toBe(100);
  });

  it("distributes rotated triangles horizontally by transformed bounds", () => {
    const mkTriangle = (id: string, x: number, y: number, rotation: number): HmiObject => ({
      id,
      type: "line",
      x,
      y,
      width: 90,
      height: 80,
      points: [45, 0, 90, 80, 0, 80],
      stroke: "#8c8c8c",
      strokeWidth: 2,
      closed: true,
      fill: "#262626",
      rotation,
    });
    const screen = screenWith([
      mkTriangle("a", 0, 0, 20),
      mkTriangle("b", 140, 0, -15),
      mkTriangle("c", 280, 0, 8),
    ]);
    const result = distributeSelected(screen, selection(["a", "b", "c"]), "distributeHorizontally");
    const a = getObjectBounds(byId(result.screen, "a"));
    const b = getObjectBounds(byId(result.screen, "b"));
    const c = getObjectBounds(byId(result.screen, "c"));
    const gap1 = b.x - (a.x + a.width);
    const gap2 = c.x - (b.x + b.width);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(1e-6);
  });
});

describe("spacing", () => {
  it("spaces horizontally with explicit gap", () => {
    const screen = screenWith([rectObject("a", 0, 0, 10, 10), rectObject("b", 30, 0, 10, 10), rectObject("c", 60, 0, 10, 10)]);
    const result = spaceSelected(screen, selection(["a", "b", "c"]), "spaceEvenlyHorizontally", { gap: 25 });
    expect(byId(result.screen, "a").x).toBe(0);
    expect(byId(result.screen, "b").x).toBe(35);
    expect(byId(result.screen, "c").x).toBe(70);
  });

  it("spaces vertically with inferred gap", () => {
    const screen = screenWith([rectObject("a", 0, 10, 10, 10), rectObject("b", 0, 30, 10, 10), rectObject("c", 0, 100, 10, 10)]);
    const result = spaceSelected(screen, selection(["a", "b", "c"]), "spaceEvenlyVertically");
    expect(byId(result.screen, "a").y).toBe(10);
    expect(byId(result.screen, "b").y).toBe(30);
    expect(byId(result.screen, "c").y).toBe(50);
  });

  it("spaces rotated triangles horizontally with explicit gap by bounds", () => {
    const mkTriangle = (id: string, x: number, y: number, rotation: number): HmiObject => ({
      id,
      type: "line",
      x,
      y,
      width: 90,
      height: 80,
      points: [45, 0, 90, 80, 0, 80],
      stroke: "#8c8c8c",
      strokeWidth: 2,
      closed: true,
      fill: "#262626",
      rotation,
    });
    const screen = screenWith([
      mkTriangle("a", 10, 0, 28),
      mkTriangle("b", 90, 0, -17),
      mkTriangle("c", 170, 0, 5),
    ]);
    const result = spaceSelected(screen, selection(["a", "b", "c"]), "spaceEvenlyHorizontally", { gap: 25 });
    const a = getObjectBounds(byId(result.screen, "a"));
    const b = getObjectBounds(byId(result.screen, "b"));
    const c = getObjectBounds(byId(result.screen, "c"));
    expect(Math.abs((b.x - (a.x + a.width)) - 25)).toBeLessThan(1e-6);
    expect(Math.abs((c.x - (b.x + b.width)) - 25)).toBeLessThan(1e-6);
  });
});

describe("locked behavior", () => {
  it("does not change locked objects for make same width", () => {
    const screen = screenWith([rectObject("a", 0, 0, 10, 10), rectObject("b", 20, 0, 25, 10, true), rectObject("c", 50, 0, 8, 10)]);
    const result = makeSameSize(screen, selection(["a", "b", "c"], "a"), "makeSameWidth");
    expect(byId(result.screen, "a").width).toBe(10);
    expect(byId(result.screen, "c").width).toBe(10);
    expect(byId(result.screen, "b").width).toBe(25);
  });
});

describe("merge lines", () => {
  it("merges two connected lines into one polyline", () => {
    const lineA = lineObject("line_a", 10, 10, [0, 0, 40, 0], { name: "Pipe A", stroke: "#abcdef", strokeWidth: 5 });
    const lineB = lineObject("line_b", 50, 10, [0, 0, 0, 30], { stroke: "#123456", strokeWidth: 2 });
    const screen = screenWith([lineA, lineB]);

    const result = executeEditorCommand(screen, selection(["line_a", "line_b"], "line_b"), {
      type: "mergeSelectedLinesToPolyline",
    });

    expect(result.warnings ?? []).toHaveLength(0);
    expect(result.screen.objects).toHaveLength(1);
    const merged = result.screen.objects[0];
    expect(merged?.type).toBe("line");
    if (!merged || merged.type !== "line") {
      return;
    }
    expect(merged.stroke).toBe("#abcdef");
    expect(merged.strokeWidth).toBe(5);
    expect(merged.name).toBe("Pipe A");
    expect(merged.closed).toBe(false);
    expect(merged.points).toEqual([0, 0, 40, 0, 40, 30]);
    expect(result.selection.selectedObjectIds).toEqual([merged.id]);
  });

  it("returns warning for disconnected lines", () => {
    const lineA = lineObject("line_a", 0, 0, [0, 0, 20, 0]);
    const lineB = lineObject("line_b", 200, 200, [0, 0, 20, 0]);
    const screen = screenWith([lineA, lineB]);

    const result = executeEditorCommand(screen, selection(["line_a", "line_b"]), {
      type: "mergeSelectedLinesToPolyline",
    });

    expect(result.screen.objects).toHaveLength(2);
    expect(result.warnings).toContain("Selected lines are not connected into one continuous path.");
  });

  it("returns warning for branch topology", () => {
    const horizontal = lineObject("a", 100, 100, [0, 0, 40, 0]);
    const vertical = lineObject("b", 140, 100, [0, 0, 0, 40]);
    const reverseHorizontal = lineObject("c", 140, 100, [0, 0, -40, 0]);
    const screen = screenWith([horizontal, vertical, reverseHorizontal]);

    const result = executeEditorCommand(screen, selection(["a", "b", "c"]), {
      type: "mergeSelectedLinesToPolyline",
    });

    expect(result.screen.objects).toHaveLength(3);
    expect(result.warnings).toContain("Selected lines form a branch. Merge supports one continuous path only.");
  });

  it("merges connected lines with rotation applied", () => {
    const horizontal = lineObject("a", 100, 100, [0, 0, 40, 0], { name: "Pipe A" });
    const verticalRotated: HmiObject = {
      ...lineObject("b", 140, 100, [0, 0, 40, 0]),
      rotation: 90,
    };
    const screen = screenWith([horizontal, verticalRotated]);

    const result = executeEditorCommand(screen, selection(["a", "b"]), {
      type: "mergeSelectedLinesToPolyline",
    });

    expect(result.warnings ?? []).toHaveLength(0);
    expect(result.screen.objects).toHaveLength(1);
    const merged = result.screen.objects[0];
    expect(merged?.type).toBe("line");
    if (!merged || merged.type !== "line") {
      return;
    }
    expect(merged.rotation ?? 0).toBe(0);
    expect(merged.points.length).toBe(6);
    expect(merged.points[0]).toBeCloseTo(0, 6);
    expect(merged.points[1]).toBeCloseTo(0, 6);
    expect(merged.points[2]).toBeCloseTo(40, 6);
    expect(merged.points[3]).toBeCloseTo(0, 6);
    expect(merged.points[4]).toBeCloseTo(40, 6);
    expect(merged.points[5]).toBeCloseTo(40, 6);
  });

  it("keeps style of the longest (main) line even when selected later", () => {
    const shortSegment = lineObject("short", 90, 10, [0, 0, 0, 16], {
      stroke: "#ff00ff",
      strokeWidth: 1,
      name: "Short Segment",
    });
    const mainLine = lineObject("main", 10, 10, [0, 0, 80, 0], {
      stroke: "#22aa66",
      strokeWidth: 6,
      name: "Main Pipe",
    });
    const screen = screenWith([shortSegment, mainLine]);

    const result = executeEditorCommand(screen, selection(["short", "main"], "short"), {
      type: "mergeSelectedLinesToPolyline",
    });

    expect(result.warnings ?? []).toHaveLength(0);
    expect(result.screen.objects).toHaveLength(1);
    const merged = result.screen.objects[0];
    expect(merged?.type).toBe("line");
    if (!merged || merged.type !== "line") {
      return;
    }
    expect(merged.stroke).toBe("#22aa66");
    expect(merged.strokeWidth).toBe(6);
    expect(merged.name).toBe("Main Pipe");
  });
});

describe("merge shapes", () => {
  it("merges rectangle and closed line into one compound shape", () => {
    const rectangle: HmiObject = {
      id: "rect_1",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
      fill: "#334455",
      stroke: "#8899aa",
      strokeWidth: 2,
    };
    const triangle: HmiObject = {
      id: "tri_1",
      type: "line",
      x: 120,
      y: 40,
      width: 70,
      height: 60,
      points: [35, 0, 70, 60, 0, 60],
      closed: true,
      fill: "#112233",
      stroke: "#556677",
      strokeWidth: 3,
    };
    const result = executeEditorCommand(screenWith([rectangle, triangle]), selection(["rect_1", "tri_1"]), {
      type: "mergeSelectedShapes",
    });

    expect(result.warnings ?? []).toHaveLength(0);
    expect(result.screen.objects).toHaveLength(1);
    const merged = result.screen.objects[0];
    expect(merged?.type).toBe("compoundShape");
    if (!merged || merged.type !== "compoundShape") {
      return;
    }
    expect(merged.parts.length).toBe(2);
    expect(merged.parts.every((part) => (part.closed ?? false) === true)).toBe(true);
    expect(result.selection.selectedObjectIds).toEqual([merged.id]);
  });

  it("does not merge when unsupported objects are selected", () => {
    const rect: HmiObject = {
      id: "rect_1",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 60,
      height: 40,
      fill: "#222",
      stroke: "#777",
      strokeWidth: 2,
    };
    const closedLine: HmiObject = {
      id: "line_1",
      type: "line",
      x: 90,
      y: 10,
      width: 60,
      height: 40,
      points: [0, 0, 60, 0, 30, 40],
      closed: true,
      fill: "#444",
      stroke: "#999",
      strokeWidth: 2,
    };
    const unsupportedText: HmiObject = {
      id: "txt_1",
      type: "text",
      x: 10,
      y: 80,
      width: 80,
      height: 20,
      text: "skip me",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "left",
        verticalAlign: "top",
      },
    };
    const result = executeEditorCommand(
      screenWith([rect, closedLine, unsupportedText]),
      selection(["rect_1", "line_1", "txt_1"]),
      { type: "mergeSelectedShapes" },
    );

    expect(result.screen.objects).toHaveLength(3);
    expect(result.screen.objects.some((obj) => obj.type === "compoundShape")).toBe(false);
    expect(result.warnings?.[0]).toContain("supports rectangle and closed line objects only");
  });

  it("does not merge when selection contains locked objects", () => {
    const rect: HmiObject = {
      id: "rect_1",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 60,
      height: 40,
      fill: "#222",
      stroke: "#777",
      strokeWidth: 2,
    };
    const closedLine: HmiObject = {
      id: "line_1",
      type: "line",
      x: 90,
      y: 10,
      width: 60,
      height: 40,
      points: [0, 0, 60, 0, 30, 40],
      closed: true,
      fill: "#444",
      stroke: "#999",
      strokeWidth: 2,
    };
    const lockedRect: HmiObject = {
      id: "rect_locked",
      type: "rectangle",
      x: 170,
      y: 10,
      width: 30,
      height: 30,
      locked: true,
    };
    const result = executeEditorCommand(
      screenWith([rect, closedLine, lockedRect]),
      selection(["rect_1", "line_1", "rect_locked"]),
      { type: "mergeSelectedShapes" },
    );

    expect(result.screen.objects).toHaveLength(3);
    expect(result.screen.objects.some((obj) => obj.type === "compoundShape")).toBe(false);
    expect(result.warnings?.[0]).toContain("Locked objects cannot be merged");
  });

  it("uses active selected shape style as merged style source", () => {
    const backRect: HmiObject = {
      id: "rect_1",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 60,
      height: 40,
      fill: "#111111",
      stroke: "#222222",
      strokeWidth: 2,
      zIndex: 1,
    };
    const activeTriangle: HmiObject = {
      id: "line_1",
      type: "line",
      x: 90,
      y: 10,
      width: 60,
      height: 40,
      points: [0, 0, 60, 0, 30, 40],
      closed: true,
      fill: "#aa0000",
      stroke: "#00aa00",
      strokeWidth: 5,
      opacity: 0.5,
      name: "Active Triangle",
      zIndex: 3,
    };
    const result = executeEditorCommand(
      screenWith([backRect, activeTriangle]),
      selection(["rect_1", "line_1"], "line_1"),
      { type: "mergeSelectedShapes" },
    );

    const merged = result.screen.objects.find((obj) => obj.type === "compoundShape");
    expect(merged).toBeTruthy();
    if (!merged || merged.type !== "compoundShape") {
      return;
    }
    expect(merged.fill).toBe("#aa0000");
    expect(merged.stroke).toBe("#00aa00");
    expect(merged.strokeWidth).toBe(5);
    expect(merged.opacity).toBe(0.5);
    expect(merged.name).toBe("Active Triangle");
    expect(merged.zIndex).toBe(1);
  });

  it("falls back to first selected shape by z-order when active shape is missing", () => {
    const topRect: HmiObject = {
      id: "rect_1",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 60,
      height: 40,
      fill: "#eeeeee",
      stroke: "#dddddd",
      strokeWidth: 2,
      zIndex: 10,
    };
    const lowerTriangle: HmiObject = {
      id: "line_1",
      type: "line",
      x: 90,
      y: 10,
      width: 60,
      height: 40,
      points: [0, 0, 60, 0, 30, 40],
      closed: true,
      fill: "#123456",
      stroke: "#654321",
      strokeWidth: 4,
      zIndex: 2,
    };
    const result = executeEditorCommand(
      screenWith([topRect, lowerTriangle]),
      selection(["rect_1", "line_1"], "missing"),
      { type: "mergeSelectedShapes" },
    );

    const merged = result.screen.objects.find((obj) => obj.type === "compoundShape");
    expect(merged).toBeTruthy();
    if (!merged || merged.type !== "compoundShape") {
      return;
    }
    expect(merged.fill).toBe("#123456");
    expect(merged.stroke).toBe("#654321");
    expect(merged.strokeWidth).toBe(4);
    expect(merged.zIndex).toBe(2);
  });
});
