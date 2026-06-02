export function intersectsScreenBounds(
  object: {
    x: number;
    y: number;
    width: number;
    height: number;
    points?: number[];
    rotation?: number;
  },
  screen: { width: number; height: number }
): boolean {
  let ox = object.x ?? 0;
  let oy = object.y ?? 0;
  let ow = Math.max(0, object.width ?? 0);
  let oh = Math.max(0, object.height ?? 0);

  // Quick AABB check first — if it passes, no need for rotation math
  const aabbInside =
    ox + ow >= 0 &&
    oy + oh >= 0 &&
    ox <= screen.width &&
    oy <= screen.height;

  if (aabbInside) {
    return true;
  }

  // If the object has rotation, the AABB may be a poor fit —
  // compute the real bounding box from points or corners.
  if (object.rotation) {
    // Collect all vertices in local space
    const vertices: Array<[number, number]> = [];

    if (object.points && object.points.length >= 2) {
      // Line / polyline defined by points
      for (let i = 0; i < object.points.length - 1; i += 2) {
        vertices.push([object.points[i] ?? 0, object.points[i + 1] ?? 0]);
      }
    } else {
      // Rectangular object — use 4 corners
      vertices.push([0, 0]);
      vertices.push([ow, 0]);
      vertices.push([0, oh]);
      vertices.push([ow, oh]);
    }

    const rad = (object.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [px, py] of vertices) {
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      minX = Math.min(minX, rx);
      minY = Math.min(minY, ry);
      maxX = Math.max(maxX, rx);
      maxY = Math.max(maxY, ry);
    }

    if (Number.isFinite(minX) && Number.isFinite(maxX)) {
      ow = maxX - minX;
      oh = maxY - minY;
      ox = object.x + minX;
      oy = object.y + minY;
    }
  }

  return !(
    ox + ow < 0 ||
    oy + oh < 0 ||
    ox > screen.width ||
    oy > screen.height
  );
}
