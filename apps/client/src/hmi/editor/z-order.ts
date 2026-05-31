import type { HmiObject } from "@web-scada/shared";

export function sortObjectsByZIndex(objects: HmiObject[]): HmiObject[] {
  const indexed = objects.map((obj, index) => ({ obj, index }));
  indexed.sort((a, b) => {
    const aZ = a.obj.zIndex ?? a.index;
    const bZ = b.obj.zIndex ?? b.index;
    if (aZ !== bZ) return aZ - bZ;
    return a.index - b.index;
  });
  return indexed.map((item) => item.obj);
}

export function getMaxZIndex(objects: HmiObject[]): number {
  let max = -1;
  for (let index = 0; index < objects.length; index += 1) {
    const obj = objects[index];
    if (!obj) {
      continue;
    }
    const candidate = typeof obj.zIndex === "number" ? obj.zIndex : index;
    if (candidate > max) {
      max = candidate;
    }
  }
  return max;
}

export function getNextZIndex(objects: HmiObject[]): number {
  return getMaxZIndex(objects) + 1;
}

export function normalizeZIndices(objects: HmiObject[]): HmiObject[] {
  const sorted = sortObjectsByZIndex(objects);
  return sorted.map((obj, index) => ({ ...obj, zIndex: index }));
}

function hasAnyZIndex(objects: HmiObject[]): boolean {
  for (const obj of objects) {
    if (typeof obj.zIndex === "number") return true;
    if (obj.type === "group" && hasAnyZIndex(obj.objects)) return true;
  }
  return false;
}

export function ensureNormalized(objects: HmiObject[]): HmiObject[] {
  if (hasAnyZIndex(objects)) return objects;
  return normalizeZIndices(objects);
}

export function bringToFront(objects: HmiObject[], selectedIds: string[]): HmiObject[] {
  if (!selectedIds.length) return objects;
  const idSet = new Set(selectedIds);
  const sorted = sortObjectsByZIndex(objects);
  const selected: HmiObject[] = [];
  const rest: HmiObject[] = [];
  for (const obj of sorted) {
    if (idSet.has(obj.id)) {
      selected.push(obj);
    } else {
      rest.push(obj);
    }
  }
  const result = [...rest, ...selected];
  return result.map((obj, index) => ({ ...obj, zIndex: index }));
}

export function sendToBack(objects: HmiObject[], selectedIds: string[]): HmiObject[] {
  if (!selectedIds.length) return objects;
  const idSet = new Set(selectedIds);
  const sorted = sortObjectsByZIndex(objects);
  const selected: HmiObject[] = [];
  const rest: HmiObject[] = [];
  for (const obj of sorted) {
    if (idSet.has(obj.id)) {
      selected.push(obj);
    } else {
      rest.push(obj);
    }
  }
  const result = [...selected, ...rest];
  return result.map((obj, index) => ({ ...obj, zIndex: index }));
}

export function moveForward(objects: HmiObject[], selectedIds: string[]): HmiObject[] {
  if (!selectedIds.length) return objects;
  const idSet = new Set(selectedIds);
  const sorted = sortObjectsByZIndex(objects);
  let moved = false;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current && next && idSet.has(current.id) && !idSet.has(next.id)) {
      sorted[i] = next;
      sorted[i + 1] = current;
      moved = true;
    }
  }
  if (!moved) return objects;
  return sorted.map((obj, index) => ({ ...obj, zIndex: index }));
}

export function moveBackward(objects: HmiObject[], selectedIds: string[]): HmiObject[] {
  if (!selectedIds.length) return objects;
  const idSet = new Set(selectedIds);
  const sorted = sortObjectsByZIndex(objects);
  let moved = false;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = sorted[i - 1];
    if (current && prev && idSet.has(current.id) && !idSet.has(prev.id)) {
      sorted[i] = prev;
      sorted[i - 1] = current;
      moved = true;
    }
  }
  if (!moved) return objects;
  return sorted.map((obj, index) => ({ ...obj, zIndex: index }));
}
