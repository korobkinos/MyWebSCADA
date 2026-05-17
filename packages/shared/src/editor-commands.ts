import type { GroupObject, HmiObject } from "./hmi-object-types";
import type { HmiScreen } from "./project-types";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EditorSelectionState = {
  selectedObjectIds: string[];
  activeObjectId?: string;
  selectionRect?: Rect;
};

export type SpacingOptions = {
  gap?: number;
};

export type EditorCommand =
  | { type: "groupSelected" }
  | { type: "ungroupSelected" }
  | { type: "lockSelected" }
  | { type: "unlockSelected" }
  | { type: "alignLeft" }
  | { type: "alignRight" }
  | { type: "alignTop" }
  | { type: "alignBottom" }
  | { type: "alignHorizontalCenter" }
  | { type: "alignVerticalCenter" }
  | { type: "makeSameWidth" }
  | { type: "makeSameHeight" }
  | { type: "makeSameSize" }
  | { type: "distributeHorizontally" }
  | { type: "distributeVertically" }
  | { type: "spaceEvenlyHorizontally"; options?: SpacingOptions }
  | { type: "spaceEvenlyVertically"; options?: SpacingOptions };

export type EditorCommandResult = {
  screen: HmiScreen;
  selection: EditorSelectionState;
  warnings?: string[];
};

export function getObjectBounds(object: HmiObject): Rect {
  const localBounds = getObjectLocalBounds(object);
  const rotation = object.rotation ?? 0;
  if (rotation === 0) {
    return {
      x: object.x + localBounds.x,
      y: object.y + localBounds.y,
      width: localBounds.width,
      height: localBounds.height,
    };
  }

  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const points = [
    rotatePoint(localBounds.x, localBounds.y, cos, sin),
    rotatePoint(localBounds.x + localBounds.width, localBounds.y, cos, sin),
    rotatePoint(localBounds.x + localBounds.width, localBounds.y + localBounds.height, cos, sin),
    rotatePoint(localBounds.x, localBounds.y + localBounds.height, cos, sin),
  ];
  const xs = points.map((point) => object.x + point.x);
  const ys = points.map((point) => object.y + point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function getObjectLocalBounds(object: HmiObject): Rect {
  if (object.type !== "line") {
    return {
      x: 0,
      y: 0,
      width: object.width,
      height: object.height,
    };
  }

  const points = object.points ?? [];
  if (points.length < 2) {
    return {
      x: 0,
      y: 0,
      width: object.width,
      height: object.height,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 2) {
    const x = points[index] ?? 0;
    const y = points[index + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      x: 0,
      y: 0,
      width: object.width,
      height: object.height,
    };
  }

  const strokePadding = Math.max(0, object.strokeWidth ?? 0) / 2;
  return {
    x: minX - strokePadding,
    y: minY - strokePadding,
    width: (maxX - minX) + strokePadding * 2,
    height: (maxY - minY) + strokePadding * 2,
  };
}

export function getObjectsBounds(objects: HmiObject[]): Rect {
  if (!objects.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const bounds = objects.map((obj) => getObjectBounds(obj));
  const left = Math.min(...bounds.map((obj) => obj.x));
  const top = Math.min(...bounds.map((obj) => obj.y));
  const right = Math.max(...bounds.map((obj) => obj.x + obj.width));
  const bottom = Math.max(...bounds.map((obj) => obj.y + obj.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function moveObject<T extends HmiObject>(object: T, dx: number, dy: number): T {
  return { ...object, x: object.x + dx, y: object.y + dy };
}

export function resizeObject<T extends HmiObject>(object: T, width: number, height: number): T {
  const nextWidth = Math.max(object.minWidth ?? 1, width);
  const nextHeight = Math.max(object.minHeight ?? 1, height);
  return { ...object, width: nextWidth, height: nextHeight };
}

export function normalizeObjectsToGroup(objects: HmiObject[]): { groupBounds: Rect; normalizedObjects: HmiObject[] } {
  const bounds = getObjectsBounds(objects);
  return {
    groupBounds: bounds,
    normalizedObjects: objects.map((item) => ({
      ...item,
      x: item.x - bounds.x,
      y: item.y - bounds.y,
    })),
  };
}

export function denormalizeObjectsFromGroup(group: GroupObject): HmiObject[] {
  return group.objects.map((item) => ({
    ...item,
    x: group.x + item.x,
    y: group.y + item.y,
  }));
}

export function executeEditorCommand(
  screen: HmiScreen,
  selection: EditorSelectionState,
  command: EditorCommand,
): EditorCommandResult {
  switch (command.type) {
    case "groupSelected":
      return groupSelected(screen, selection);
    case "ungroupSelected":
      return ungroupSelected(screen, selection);
    case "lockSelected":
      return lockSelected(screen, selection);
    case "unlockSelected":
      return unlockSelected(screen, selection);
    case "alignLeft":
    case "alignRight":
    case "alignTop":
    case "alignBottom":
    case "alignHorizontalCenter":
    case "alignVerticalCenter":
      return alignSelected(screen, selection, command.type);
    case "makeSameWidth":
    case "makeSameHeight":
    case "makeSameSize":
      return makeSameSize(screen, selection, command.type);
    case "distributeHorizontally":
    case "distributeVertically":
      return distributeSelected(screen, selection, command.type);
    case "spaceEvenlyHorizontally":
    case "spaceEvenlyVertically":
      return spaceSelected(screen, selection, command.type, command.options);
    default:
      return { screen, selection };
  }
}

export function groupSelected(screen: HmiScreen, selection: EditorSelectionState): EditorCommandResult {
  const selected = screen.objects.filter((obj) => selection.selectedObjectIds.includes(obj.id));
  const unlocked = selected.filter((obj) => !obj.locked);
  const warnings: string[] = [];
  if (selected.length !== unlocked.length) {
    warnings.push("Locked objects were skipped while grouping");
  }
  if (unlocked.length < 2) {
    return { screen, selection, warnings };
  }

  const { groupBounds, normalizedObjects } = normalizeObjectsToGroup(unlocked);
  const group: GroupObject = {
    id: createId("group"),
    type: "group",
    x: groupBounds.x,
    y: groupBounds.y,
    width: groupBounds.width,
    height: groupBounds.height,
    minWidth: 8,
    minHeight: 8,
    objects: normalizedObjects,
    locked: false,
    visible: true,
  };

  const groupedIds = new Set(unlocked.map((obj) => obj.id));
  const nextObjects = [...screen.objects.filter((obj) => !groupedIds.has(obj.id)), group];
  return {
    screen: { ...screen, objects: nextObjects },
    selection: {
      selectedObjectIds: [group.id],
      activeObjectId: group.id,
    },
    warnings,
  };
}

export function ungroupSelected(screen: HmiScreen, selection: EditorSelectionState): EditorCommandResult {
  const selectedGroups = screen.objects.filter(
    (obj): obj is GroupObject => obj.type === "group" && selection.selectedObjectIds.includes(obj.id) && !obj.locked,
  );
  if (!selectedGroups.length) {
    return { screen, selection };
  }

  const groupIds = new Set(selectedGroups.map((group) => group.id));
  const expanded = selectedGroups.flatMap((group) => denormalizeObjectsFromGroup(group));
  const nextObjects = [...screen.objects.filter((obj) => !groupIds.has(obj.id)), ...expanded];
  return {
    screen: { ...screen, objects: nextObjects },
    selection: {
      selectedObjectIds: expanded.map((obj) => obj.id),
      activeObjectId: expanded[0]?.id,
    },
  };
}

export function lockSelected(screen: HmiScreen, selection: EditorSelectionState): EditorCommandResult {
  const ids = new Set(selection.selectedObjectIds);
  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => (ids.has(obj.id) ? { ...obj, locked: true } : obj)),
    },
    selection,
  };
}

export function unlockSelected(screen: HmiScreen, selection: EditorSelectionState): EditorCommandResult {
  const ids = new Set(selection.selectedObjectIds);
  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => (ids.has(obj.id) ? { ...obj, locked: false } : obj)),
    },
    selection,
  };
}

export function alignSelected(
  screen: HmiScreen,
  selection: EditorSelectionState,
  mode:
    | "alignLeft"
    | "alignRight"
    | "alignTop"
    | "alignBottom"
    | "alignHorizontalCenter"
    | "alignVerticalCenter",
): EditorCommandResult {
  const unlocked = selectedUnlocked(screen.objects, selection.selectedObjectIds);
  if (unlocked.length < 2) {
    return { screen, selection };
  }

  const bounds = getObjectsBounds(unlocked);
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const objectBoundsById = new Map(unlocked.map((obj) => [obj.id, getObjectBounds(obj)]));
  const unlockedIds = new Set(unlocked.map((obj) => obj.id));

  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => {
        if (!unlockedIds.has(obj.id)) {
          return obj;
        }
        const objBounds = objectBoundsById.get(obj.id);
        if (!objBounds) {
          return obj;
        }
        if (mode === "alignLeft") {
          return { ...obj, x: obj.x + (bounds.x - objBounds.x) };
        }
        if (mode === "alignRight") {
          return { ...obj, x: obj.x + (right - (objBounds.x + objBounds.width)) };
        }
        if (mode === "alignTop") {
          return { ...obj, y: obj.y + (bounds.y - objBounds.y) };
        }
        if (mode === "alignBottom") {
          return { ...obj, y: obj.y + (bottom - (objBounds.y + objBounds.height)) };
        }
        if (mode === "alignHorizontalCenter") {
          return { ...obj, x: obj.x + (centerX - (objBounds.x + objBounds.width / 2)) };
        }
        return { ...obj, y: obj.y + (centerY - (objBounds.y + objBounds.height / 2)) };
      }),
    },
    selection,
  };
}

export function makeSameSize(
  screen: HmiScreen,
  selection: EditorSelectionState,
  mode: "makeSameWidth" | "makeSameHeight" | "makeSameSize",
): EditorCommandResult {
  const unlocked = selectedUnlocked(screen.objects, selection.selectedObjectIds);
  if (unlocked.length < 2) {
    return { screen, selection };
  }

  const active = unlocked.find((obj) => obj.id === selection.activeObjectId) ?? unlocked[0];
  if (!active) {
    return { screen, selection };
  }
  const unlockedIds = new Set(unlocked.map((obj) => obj.id));

  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => {
        if (!unlockedIds.has(obj.id) || obj.id === active.id) {
          return obj;
        }
        if (mode === "makeSameWidth") {
          return resizeObject(obj, active.width, obj.height);
        }
        if (mode === "makeSameHeight") {
          return resizeObject(obj, obj.width, active.height);
        }
        return resizeObject(obj, active.width, active.height);
      }),
    },
    selection,
  };
}

export function distributeSelected(
  screen: HmiScreen,
  selection: EditorSelectionState,
  mode: "distributeHorizontally" | "distributeVertically",
): EditorCommandResult {
  const unlocked = selectedUnlocked(screen.objects, selection.selectedObjectIds);
  if (unlocked.length < 3) {
    return { screen, selection };
  }
  if (mode === "distributeHorizontally") {
    const sorted = [...unlocked].sort((a, b) => a.x - b.x);
    const bounds = getObjectsBounds(sorted);
    const total = sorted.reduce((sum, item) => sum + item.width, 0);
    const gap = (bounds.width - total) / (sorted.length - 1);
    let cursor = bounds.x;
    const updates = new Map<string, { x: number }>();
    for (const object of sorted) {
      updates.set(object.id, { x: cursor });
      cursor += object.width + gap;
    }
    return {
      screen: {
        ...screen,
        objects: screen.objects.map((obj) => (updates.has(obj.id) ? { ...obj, x: updates.get(obj.id)!.x } : obj)),
      },
      selection,
    };
  }

  const sorted = [...unlocked].sort((a, b) => a.y - b.y);
  const bounds = getObjectsBounds(sorted);
  const total = sorted.reduce((sum, item) => sum + item.height, 0);
  const gap = (bounds.height - total) / (sorted.length - 1);
  let cursor = bounds.y;
  const updates = new Map<string, { y: number }>();
  for (const object of sorted) {
    updates.set(object.id, { y: cursor });
    cursor += object.height + gap;
  }
  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => (updates.has(obj.id) ? { ...obj, y: updates.get(obj.id)!.y } : obj)),
    },
    selection,
  };
}

export function spaceSelected(
  screen: HmiScreen,
  selection: EditorSelectionState,
  mode: "spaceEvenlyHorizontally" | "spaceEvenlyVertically",
  options?: SpacingOptions,
): EditorCommandResult {
  const unlocked = selectedUnlocked(screen.objects, selection.selectedObjectIds);
  if (unlocked.length < 3) {
    return { screen, selection };
  }

  if (mode === "spaceEvenlyHorizontally") {
    const sorted = [...unlocked].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const second = sorted[1];
    if (!first || !second) {
      return { screen, selection };
    }
    const inferredGap = second.x - (first.x + first.width);
    const gap = options?.gap ?? inferredGap;
    const updates = new Map<string, { x: number }>();
    updates.set(first.id, { x: first.x });
    let cursor = first.x + first.width + gap;
    for (let i = 1; i < sorted.length; i += 1) {
      const object = sorted[i];
      if (!object) {
        continue;
      }
      updates.set(object.id, { x: cursor });
      cursor += object.width + gap;
    }
    return {
      screen: {
        ...screen,
        objects: screen.objects.map((obj) => (updates.has(obj.id) ? { ...obj, x: updates.get(obj.id)!.x } : obj)),
      },
      selection,
    };
  }

  const sorted = [...unlocked].sort((a, b) => a.y - b.y);
  const first = sorted[0];
  const second = sorted[1];
  if (!first || !second) {
    return { screen, selection };
  }
  const inferredGap = second.y - (first.y + first.height);
  const gap = options?.gap ?? inferredGap;
  const updates = new Map<string, { y: number }>();
  updates.set(first.id, { y: first.y });
  let cursor = first.y + first.height + gap;
  for (let i = 1; i < sorted.length; i += 1) {
    const object = sorted[i];
    if (!object) {
      continue;
    }
    updates.set(object.id, { y: cursor });
    cursor += object.height + gap;
  }
  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => (updates.has(obj.id) ? { ...obj, y: updates.get(obj.id)!.y } : obj)),
    },
    selection,
  };
}

function selectedUnlocked(objects: HmiObject[], selectedIds: string[]): HmiObject[] {
  const idSet = new Set(selectedIds);
  return objects.filter((obj) => idSet.has(obj.id) && !obj.locked);
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function rotatePoint(x: number, y: number, cos: number, sin: number): { x: number; y: number } {
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}
