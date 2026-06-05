type OverlayStateLike = {
  objectId: string;
} | null | undefined;

export function getRuntimeOverlayObjectId(objectId: string, nodeIdPrefix?: string): string {
  return `${nodeIdPrefix ?? ""}${objectId}`;
}

export function isRuntimeOverlayOpenForObject(
  overlayState: OverlayStateLike,
  objectId: string,
  nodeIdPrefix?: string,
): boolean {
  return overlayState?.objectId === getRuntimeOverlayObjectId(objectId, nodeIdPrefix);
}

export function isRuntimeOverlayContainerObject(object: { type: string }): boolean {
  return object.type === "group" || object.type === "frame" || object.type === "libraryElementInstance";
}
