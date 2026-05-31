import type { CompoundShapeObject, GroupObject, HmiObject, LineObject, RectangleObject } from "./hmi-object-types";
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

export type Point = {
  x: number;
  y: number;
};

export type EditorCommand =
  | { type: "groupSelected" }
  | { type: "ungroupSelected" }
  | { type: "mergeSelectedLinesToPolyline" }
  | { type: "mergeSelectedShapes" }
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
    case "mergeSelectedLinesToPolyline":
      return mergeSelectedLinesToPolyline(screen, selection);
    case "mergeSelectedShapes":
      return mergeSelectedShapes(screen, selection);
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

export function mergeSelectedLinesToPolyline(screen: HmiScreen, selection: EditorSelectionState): EditorCommandResult {
  const selectedObjects = selection.selectedObjectIds
    .map((id) => screen.objects.find((obj) => obj.id === id))
    .filter((obj): obj is HmiObject => Boolean(obj));

  if (selectedObjects.length < 2) {
    return { screen, selection, warnings: ["Select at least 2 line objects to merge."] };
  }

  if (selectedObjects.some((obj) => obj.locked)) {
    return { screen, selection, warnings: ["Locked lines cannot be merged."] };
  }

  if (selectedObjects.some((obj) => obj.type !== "line")) {
    return { screen, selection, warnings: ["Merge Lines supports line objects only."] };
  }

  const selectedLines = selectedObjects.filter((obj): obj is LineObject => obj.type === "line");
  const source = [...selectedLines].sort((a, b) => {
    const lengthDiff = getLinePolylineLength(b) - getLinePolylineLength(a);
    if (Math.abs(lengthDiff) > 1e-9) {
      return lengthDiff;
    }
    return selectedLines.indexOf(a) - selectedLines.indexOf(b);
  })[0];
  if (!source) {
    return { screen, selection, warnings: ["Select at least 2 line objects to merge."] };
  }
  const connected = buildConnectedPolyline(selectedLines, 4);
  if ("error" in connected) {
    return { screen, selection, warnings: [connected.error] };
  }

  const mergedAbsolutePoints = connected.points;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of mergedAbsolutePoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { screen, selection, warnings: ["Selected lines are not connected into one continuous path."] };
  }

  const normalizedPoints: number[] = [];
  for (const point of mergedAbsolutePoints) {
    normalizedPoints.push(point.x - minX, point.y - minY);
  }

  const mergedLine: LineObject = {
    ...source,
    type: "line",
    id: createId("line"),
    name: source.name?.trim() || "Merged Line",
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    points: normalizedPoints,
    closed: false,
    cornerRadius: source.cornerRadius ?? 0,
    rotation: 0,
    locked: false,
  };

  const selectedIdSet = new Set(selectedObjects.map((obj) => obj.id));
  const nextObjects = [...screen.objects.filter((obj) => !selectedIdSet.has(obj.id)), mergedLine];

  return {
    screen: { ...screen, objects: nextObjects },
    selection: {
      selectedObjectIds: [mergedLine.id],
      activeObjectId: mergedLine.id,
    },
  };
}

export function mergeSelectedShapes(screen: HmiScreen, selection: EditorSelectionState): EditorCommandResult {
  const selectedObjects = selection.selectedObjectIds
    .map((id) => screen.objects.find((obj) => obj.id === id))
    .filter((obj): obj is HmiObject => Boolean(obj));

  if (selectedObjects.length < 2) {
    return { screen, selection, warnings: ["Select at least 2 shapes to merge."] };
  }

  if (selectedObjects.some((obj) => obj.locked)) {
    return { screen, selection, warnings: ["Locked objects cannot be merged."] };
  }

  if (selectedObjects.some((obj) => !isSupportedShapeForMerge(obj))) {
    return { screen, selection, warnings: ["Merge Shapes supports rectangle and closed line objects only."] };
  }

  const supported = selectedObjects.filter(isSupportedShapeForMerge);

  const bounds = getObjectsBounds(supported);
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || bounds.width <= 0 || bounds.height <= 0) {
    return { screen, selection, warnings: ["Failed to merge selected shapes."] };
  }

  const parts = supported
    .map((object) => toMergedShapePart(object, bounds.x, bounds.y))
    .filter((part): part is { points: number[]; closed: true } => Boolean(part && part.points.length >= 6));
  if (parts.length < 2) {
    return { screen, selection, warnings: ["Failed to build merged shape from selected objects."] };
  }

  const styleSource = getShapeMergeStyleSource(screen, selection, supported);
  if (!styleSource) {
    return { screen, selection, warnings: ["Failed to resolve merged shape style source."] };
  }
  const sourceLine = styleSource.type === "line" ? styleSource : undefined;
  const sourceRectangle = styleSource.type === "rectangle" ? styleSource : undefined;
  const layerOrderById = getLayerOrderByObjectId(screen.objects);
  const minLayerOrder = Math.min(...supported.map((obj) => layerOrderById.get(obj.id) ?? Number.MAX_SAFE_INTEGER));
  const mergedShape: CompoundShapeObject = {
    id: createId("compound"),
    type: "compoundShape",
    name: styleSource.name?.trim() || "Merged Shape",
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    minWidth: 8,
    minHeight: 8,
    parts,
    fill: sourceLine?.fill ?? sourceRectangle?.fill ?? "#262626",
    stroke: sourceLine?.stroke ?? sourceRectangle?.stroke ?? "#8c8c8c",
    strokeWidth: sourceLine?.strokeWidth ?? sourceRectangle?.strokeWidth ?? 2,
    lineCap: sourceLine?.lineCap ?? "round",
    lineJoin: sourceLine?.lineJoin ?? "round",
    fillRule: "nonzero",
    rotation: 0,
    locked: false,
    visible: true,
    opacity: sourceLine?.opacity ?? sourceRectangle?.opacity ?? 1,
    zIndex: Number.isFinite(minLayerOrder) ? minLayerOrder : undefined,
  };

  const replacedIds = new Set(supported.map((obj) => obj.id));
  const nextObjects = [...screen.objects.filter((obj) => !replacedIds.has(obj.id)), mergedShape];

  return {
    screen: { ...screen, objects: nextObjects },
    selection: {
      selectedObjectIds: [mergedShape.id],
      activeObjectId: mergedShape.id,
    },
  };
}

function getShapeMergeStyleSource(
  screen: HmiScreen,
  selection: EditorSelectionState,
  selectedShapes: Array<RectangleObject | LineObject>,
): RectangleObject | LineObject | null {
  const active = selection.activeObjectId
    ? selectedShapes.find((obj) => obj.id === selection.activeObjectId)
    : undefined;
  if (active) {
    return active;
  }

  // Style source fallback: first selected shape by layer order (zIndex/order).
  const layerOrderById = getLayerOrderByObjectId(screen.objects);
  return [...selectedShapes].sort((left, right) => {
    const leftOrder = layerOrderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = layerOrderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return selectedShapes.indexOf(left) - selectedShapes.indexOf(right);
  })[0] ?? null;
}

function getLayerOrderByObjectId(objects: HmiObject[]): Map<string, number> {
  return new Map(
    objects.map((obj, index) => [
      obj.id,
      typeof obj.zIndex === "number" ? obj.zIndex : index,
    ]),
  );
}

function getLinePolylineLength(line: LineObject): number {
  let total = 0;
  const points = line.points ?? [];
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = points[i] ?? 0;
    const y1 = points[i + 1] ?? 0;
    const x2 = points[i + 2] ?? 0;
    const y2 = points[i + 3] ?? 0;
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function isSupportedShapeForMerge(object: HmiObject): object is RectangleObject | LineObject {
  if (object.type === "rectangle") {
    return true;
  }
  return object.type === "line" && (object.closed ?? false) === true;
}

function toMergedShapePart(
  object: RectangleObject | LineObject,
  originX: number,
  originY: number,
): { points: number[]; closed: true } | null {
  const absolutePoints = object.type === "rectangle"
    ? toRectangleAbsolutePoints(object)
    : getLineAbsolutePoints(object);
  if (absolutePoints.length < 3) {
    return null;
  }
  const points: number[] = [];
  for (const point of absolutePoints) {
    points.push(point.x - originX, point.y - originY);
  }
  return { points, closed: true };
}

function toRectangleAbsolutePoints(object: RectangleObject): Point[] {
  const width = Math.max(1, object.width);
  const height = Math.max(1, object.height);
  const radius = Math.max(0, Math.min(object.cornerRadius ?? 0, width / 2, height / 2));
  const localPoints: Point[] = [];
  if (radius <= 0.01) {
    localPoints.push(
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    );
  } else {
    const steps = Math.max(2, Math.min(10, Math.ceil(radius / 6)));
    appendUniquePoint(localPoints, { x: radius, y: 0 });
    appendUniquePoint(localPoints, { x: width - radius, y: 0 });
    appendArcPoints(localPoints, { x: width - radius, y: radius }, radius, -Math.PI / 2, 0, steps);
    appendUniquePoint(localPoints, { x: width, y: height - radius });
    appendArcPoints(localPoints, { x: width - radius, y: height - radius }, radius, 0, Math.PI / 2, steps);
    appendUniquePoint(localPoints, { x: radius, y: height });
    appendArcPoints(localPoints, { x: radius, y: height - radius }, radius, Math.PI / 2, Math.PI, steps);
    appendUniquePoint(localPoints, { x: 0, y: radius });
    appendArcPoints(localPoints, { x: radius, y: radius }, radius, Math.PI, Math.PI * 1.5, steps);
  }
  const rotation = object.rotation ?? 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return localPoints.map((point) => {
    const rotatedX = point.x * cos - point.y * sin;
    const rotatedY = point.x * sin + point.y * cos;
    return {
      x: object.x + rotatedX,
      y: object.y + rotatedY,
    };
  });
}

function appendArcPoints(
  output: Point[],
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  steps: number,
): void {
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const angle = startAngle + (endAngle - startAngle) * t;
    appendUniquePoint(output, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
}

function appendUniquePoint(output: Point[], point: Point): void {
  const last = output[output.length - 1];
  if (last && Math.hypot(last.x - point.x, last.y - point.y) < 1e-6) {
    return;
  }
  output.push(point);
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
  const boundsById = new Map(unlocked.map((item) => [item.id, getObjectBounds(item)]));

  if (mode === "distributeHorizontally") {
    const sorted = [...unlocked].sort((a, b) => {
      const left = boundsById.get(a.id);
      const right = boundsById.get(b.id);
      return (left?.x ?? a.x) - (right?.x ?? b.x);
    });
    const bounds = getObjectsBounds(sorted);
    const total = sorted.reduce((sum, item) => sum + (boundsById.get(item.id)?.width ?? item.width), 0);
    const gap = (bounds.width - total) / (sorted.length - 1);
    let cursor = bounds.x;
    const updates = new Map<string, { x: number }>();
    for (const object of sorted) {
      const objectBounds = boundsById.get(object.id);
      if (!objectBounds) {
        continue;
      }
      const dx = cursor - objectBounds.x;
      updates.set(object.id, { x: object.x + dx });
      cursor += objectBounds.width + gap;
    }
    return {
      screen: {
        ...screen,
        objects: screen.objects.map((obj) => (updates.has(obj.id) ? { ...obj, x: updates.get(obj.id)!.x } : obj)),
      },
      selection,
    };
  }

  const sorted = [...unlocked].sort((a, b) => {
    const top = boundsById.get(a.id);
    const bottom = boundsById.get(b.id);
    return (top?.y ?? a.y) - (bottom?.y ?? b.y);
  });
  const bounds = getObjectsBounds(sorted);
  const total = sorted.reduce((sum, item) => sum + (boundsById.get(item.id)?.height ?? item.height), 0);
  const gap = (bounds.height - total) / (sorted.length - 1);
  let cursor = bounds.y;
  const updates = new Map<string, { y: number }>();
  for (const object of sorted) {
    const objectBounds = boundsById.get(object.id);
    if (!objectBounds) {
      continue;
    }
    const dy = cursor - objectBounds.y;
    updates.set(object.id, { y: object.y + dy });
    cursor += objectBounds.height + gap;
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
  const boundsById = new Map(unlocked.map((item) => [item.id, getObjectBounds(item)]));

  if (mode === "spaceEvenlyHorizontally") {
    const sorted = [...unlocked].sort((a, b) => {
      const left = boundsById.get(a.id);
      const right = boundsById.get(b.id);
      return (left?.x ?? a.x) - (right?.x ?? b.x);
    });
    const first = sorted[0];
    const second = sorted[1];
    if (!first || !second) {
      return { screen, selection };
    }
    const firstBounds = boundsById.get(first.id);
    const secondBounds = boundsById.get(second.id);
    if (!firstBounds || !secondBounds) {
      return { screen, selection };
    }
    const inferredGap = secondBounds.x - (firstBounds.x + firstBounds.width);
    const gap = options?.gap ?? inferredGap;
    const updates = new Map<string, { x: number }>();
    updates.set(first.id, { x: first.x });
    let cursor = firstBounds.x + firstBounds.width + gap;
    for (let i = 1; i < sorted.length; i += 1) {
      const object = sorted[i];
      if (!object) {
        continue;
      }
      const objectBounds = boundsById.get(object.id);
      if (!objectBounds) {
        continue;
      }
      const dx = cursor - objectBounds.x;
      updates.set(object.id, { x: object.x + dx });
      cursor += objectBounds.width + gap;
    }
    return {
      screen: {
        ...screen,
        objects: screen.objects.map((obj) => (updates.has(obj.id) ? { ...obj, x: updates.get(obj.id)!.x } : obj)),
      },
      selection,
    };
  }

  const sorted = [...unlocked].sort((a, b) => {
    const top = boundsById.get(a.id);
    const bottom = boundsById.get(b.id);
    return (top?.y ?? a.y) - (bottom?.y ?? b.y);
  });
  const first = sorted[0];
  const second = sorted[1];
  if (!first || !second) {
    return { screen, selection };
  }
  const firstBounds = boundsById.get(first.id);
  const secondBounds = boundsById.get(second.id);
  if (!firstBounds || !secondBounds) {
    return { screen, selection };
  }
  const inferredGap = secondBounds.y - (firstBounds.y + firstBounds.height);
  const gap = options?.gap ?? inferredGap;
  const updates = new Map<string, { y: number }>();
  updates.set(first.id, { y: first.y });
  let cursor = firstBounds.y + firstBounds.height + gap;
  for (let i = 1; i < sorted.length; i += 1) {
    const object = sorted[i];
    if (!object) {
      continue;
    }
    const objectBounds = boundsById.get(object.id);
    if (!objectBounds) {
      continue;
    }
    const dy = cursor - objectBounds.y;
    updates.set(object.id, { y: object.y + dy });
    cursor += objectBounds.height + gap;
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

export function getLineAbsolutePoints(line: LineObject): Point[] {
  const output: Point[] = [];
  const rotation = line.rotation ?? 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (let index = 0; index + 1 < line.points.length; index += 2) {
    const localX = line.points[index] ?? 0;
    const localY = line.points[index + 1] ?? 0;
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;
    output.push({
      x: line.x + rotatedX,
      y: line.y + rotatedY,
    });
  }
  return output;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function arePointsClose(a: Point, b: Point, tolerance: number): boolean {
  return distance(a, b) <= tolerance;
}

export function reversePoints(points: Point[]): Point[] {
  return [...points].reverse();
}

export function buildConnectedPolyline(
  lines: LineObject[],
  tolerance: number,
): { points: Point[] } | { error: string } {
  if (lines.length < 2) {
    return { error: "Select at least 2 line objects to merge." };
  }

  const lineSegments = lines.map((line, lineIndex) => {
    const absolutePoints = getLineAbsolutePoints(line);
    return {
      lineIndex,
      absolutePoints,
      startCluster: -1,
      endCluster: -1,
    };
  });
  if (lineSegments.some((segment) => segment.absolutePoints.length < 2)) {
    return { error: "Selected lines are not connected into one continuous path." };
  }

  const endpoints = lineSegments.flatMap((segment, segmentIndex) => {
    const first = segment.absolutePoints[0];
    const last = segment.absolutePoints[segment.absolutePoints.length - 1];
    if (!first || !last) {
      return [];
    }
    return [
      { segmentIndex, isStart: true, point: first },
      { segmentIndex, isStart: false, point: last },
    ];
  });
  if (endpoints.length !== lineSegments.length * 2) {
    return { error: "Selected lines are not connected into one continuous path." };
  }

  const parent = endpoints.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]!]!;
      cursor = parent[cursor]!;
    }
    return cursor;
  };
  const unite = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  };
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (arePointsClose(endpoints[i]!.point, endpoints[j]!.point, tolerance)) {
        unite(i, j);
      }
    }
  }

  const clusterByRoot = new Map<number, number>();
  const endpointCluster = endpoints.map((_, index) => {
    const root = find(index);
    let clusterId = clusterByRoot.get(root);
    if (clusterId === undefined) {
      clusterId = clusterByRoot.size;
      clusterByRoot.set(root, clusterId);
    }
    return clusterId;
  });

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex += 1) {
    const endpoint = endpoints[endpointIndex]!;
    const clusterId = endpointCluster[endpointIndex]!;
    const segment = lineSegments[endpoint.segmentIndex]!;
    if (endpoint.isStart) {
      segment.startCluster = clusterId;
    } else {
      segment.endCluster = clusterId;
    }
  }
  if (lineSegments.some((segment) => segment.startCluster < 0 || segment.endCluster < 0 || segment.startCluster === segment.endCluster)) {
    return { error: "Selected lines are not connected into one continuous path." };
  }

  const adjacency = new Map<number, number[]>();
  lineSegments.forEach((segment, segmentIndex) => {
    const startEdges = adjacency.get(segment.startCluster) ?? [];
    startEdges.push(segmentIndex);
    adjacency.set(segment.startCluster, startEdges);
    const endEdges = adjacency.get(segment.endCluster) ?? [];
    endEdges.push(segmentIndex);
    adjacency.set(segment.endCluster, endEdges);
  });

  for (const edges of adjacency.values()) {
    if (edges.length > 2) {
      return { error: "Selected lines form a branch. Merge supports one continuous path only." };
    }
  }

  const degreeOneNodes = [...adjacency.entries()]
    .filter(([, edges]) => edges.length === 1)
    .map(([cluster]) => cluster);
  if (degreeOneNodes.length !== 2) {
    return { error: "Selected lines are not connected into one continuous path." };
  }

  const merged: Point[] = [];
  const visitedEdges = new Set<number>();
  let currentCluster = degreeOneNodes[0]!;
  let previousEdge = -1;
  while (true) {
    const edges = adjacency.get(currentCluster) ?? [];
    const nextEdgeCandidates = edges.filter((edgeIndex) => edgeIndex !== previousEdge && !visitedEdges.has(edgeIndex));
    const nextEdge = nextEdgeCandidates[0];
    if (nextEdge === undefined) {
      break;
    }
    visitedEdges.add(nextEdge);
    const segment = lineSegments[nextEdge]!;
    const traversingForward = segment.startCluster === currentCluster;
    const orientedPoints = traversingForward ? segment.absolutePoints : reversePoints(segment.absolutePoints);
    appendPoints(merged, orientedPoints, tolerance);
    previousEdge = nextEdge;
    currentCluster = traversingForward ? segment.endCluster : segment.startCluster;
  }

  if (visitedEdges.size !== lineSegments.length || merged.length < 2) {
    return { error: "Selected lines are not connected into one continuous path." };
  }

  return { points: merged };
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

function appendPoints(output: Point[], nextPoints: Point[], tolerance: number): void {
  if (nextPoints.length === 0) {
    return;
  }
  if (output.length === 0) {
    output.push(...nextPoints);
    return;
  }
  const lastIndex = output.length - 1;
  const lastPoint = output[lastIndex];
  const firstPoint = nextPoints[0];
  if (!lastPoint || !firstPoint) {
    return;
  }
  if (arePointsClose(lastPoint, firstPoint, tolerance)) {
    output[lastIndex] = {
      x: (lastPoint.x + firstPoint.x) / 2,
      y: (lastPoint.y + firstPoint.y) / 2,
    };
    output.push(...nextPoints.slice(1));
    return;
  }
  output.push(...nextPoints);
}
