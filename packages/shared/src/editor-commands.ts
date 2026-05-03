import type { GroupObject, HmiObject, HmiScreen } from "./hmi-object-types";

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
  // TODO: rotation-aware bounds can be added later.
  return {
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
  };
}

export function getObjectsBounds(objects: HmiObject[]): Rect {
  if (!objects.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const left = Math.min(...objects.map((obj) => obj.x));
  const top = Math.min(...objects.map((obj) => obj.y));
  const right = Math.max(...objects.map((obj) => obj.x + obj.width));
  const bottom = Math.max(...objects.map((obj) => obj.y + obj.height));
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
  const unlockedIds = new Set(unlocked.map((obj) => obj.id));

  return {
    screen: {
      ...screen,
      objects: screen.objects.map((obj) => {
        if (!unlockedIds.has(obj.id)) {
          return obj;
        }
        if (mode === "alignLeft") {
          return { ...obj, x: bounds.x };
        }
        if (mode === "alignRight") {
          return { ...obj, x: right - obj.width };
        }
        if (mode === "alignTop") {
          return { ...obj, y: bounds.y };
        }
        if (mode === "alignBottom") {
          return { ...obj, y: bottom - obj.height };
        }
        if (mode === "alignHorizontalCenter") {
          return { ...obj, x: centerX - obj.width / 2 };
        }
        return { ...obj, y: centerY - obj.height / 2 };
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

