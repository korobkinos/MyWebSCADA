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
