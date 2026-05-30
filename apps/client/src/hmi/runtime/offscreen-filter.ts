export function intersectsScreenBounds(
  object: { x: number; y: number; width: number; height: number },
  screen: { width: number; height: number }
): boolean {
  const ox = object.x ?? 0;
  const oy = object.y ?? 0;
  const ow = Math.max(0, object.width ?? 0);
  const oh = Math.max(0, object.height ?? 0);

  return !(
    ox + ow < 0 ||
    oy + oh < 0 ||
    ox > screen.width ||
    oy > screen.height
  );
}
