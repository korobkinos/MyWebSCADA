import type { HmiObject } from "./hmi-object-types";

export function findObjectDeep(objects: HmiObject[], objectId: string): HmiObject | null {
  for (const object of objects) {
    if (object.id === objectId) {
      return object;
    }
    if (object.type !== "group") {
      continue;
    }
    const nested = findObjectDeep(object.objects, objectId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function updateObjectDeepByUpdater(
  objects: HmiObject[],
  objectId: string,
  updater: (current: HmiObject) => HmiObject,
): HmiObject[] {
  let changed = false;
  const next = objects.map((object) => {
    if (object.id === objectId) {
      const updated = updater(object);
      if (updated !== object) {
        changed = true;
      }
      return updated;
    }

    if (object.type !== "group") {
      return object;
    }

    const updatedChildren = updateObjectDeepByUpdater(object.objects, objectId, updater);
    if (updatedChildren === object.objects) {
      return object;
    }

    changed = true;
    return {
      ...object,
      objects: updatedChildren,
    };
  });

  return changed ? next : objects;
}

export function updateObjectDeep(
  objects: HmiObject[],
  objectId: string,
  patch: Partial<HmiObject>,
): HmiObject[] {
  return updateObjectDeepByUpdater(objects, objectId, (current) => ({ ...current, ...patch } as HmiObject));
}
