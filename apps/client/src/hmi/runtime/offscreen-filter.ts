export function intersectsScreenBounds(
  object: { x: number; y: number; width: number; height: number; points?: number[]; rotation?: number },
  screen: { width: number; height: number }
): boolean {
  let ox = object.x ?? 0;
  let oy = object.y ?? 0;
  let ow = Math.max(0, object.width ?? 0);
  let oh = Math.max(0, object.height ?? 0);

  // For lines (0-height or 0-width objects defined by points), compute actual bounding box
  // from points and rotation to prevent false offscreen culling
  if ((ow === 0 || oh === 0) && object.points && object.points.length >= 2) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < object.points.length - 1; i += 2) {
      const px = object.points[i] ?? 0;
      const py = object.points[i + 1] ?? 0;
      if (object.rotation) {
        const rad = (object.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;
        minX = Math.min(minX, rx);
        minY = Math.min(minY, ry);
        maxX = Math.max(maxX, rx);
        maxY = Math.max(maxY, ry);
      } else {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }
    if (Number.isFinite(minX) && Number.isFinite(maxX)) {
      ow = Math.max(ow, maxX - minX);
      oh = Math.max(oh, maxY - minY);
      // Adjust origin to account for negative point coordinates
      if (minX < 0) ox = Math.min(ox, object.x + minX);
      if (minY < 0) oy = Math.min(oy, object.y + minY);
    }
  }

  return !(
    ox + ow < 0 ||
    oy + oh < 0 ||
    ox > screen.width ||
    oy > screen.height
  );
}
