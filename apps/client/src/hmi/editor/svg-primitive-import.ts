import type { Asset, HmiObject } from "@web-scada/shared";

type ImportResult = {
  objects: HmiObject[];
  warnings: string[];
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type StyleInfo = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};

const SUPPORTED_TAGS = new Set(["rect", "line", "polyline", "polygon", "circle", "ellipse"]);

export async function importSvgAssetToPrimitives(asset: Asset): Promise<ImportResult> {
  const warnings: string[] = [];
  const response = await fetch(asset.previewUrl);
  if (!response.ok) {
    throw new Error(`Failed to load SVG asset: HTTP ${response.status}`);
  }
  const svgText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    throw new Error("Asset is not a valid SVG document");
  }

  const objects: HmiObject[] = [];
  const unsupported = new Set<string>();

  for (const node of Array.from(root.querySelectorAll("*"))) {
    if (!(node instanceof Element)) {
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (!SUPPORTED_TAGS.has(tag)) {
      unsupported.add(tag);
      continue;
    }
    const style = readStyle(node);
    const object = parseShape(node, style);
    if (object) {
      objects.push(object);
    }
  }

  if (!objects.length) {
    throw new Error("No supported SVG shapes found. Supported: rect, line, polyline, polygon, circle, ellipse.");
  }

  if (unsupported.size) {
    warnings.push(`Unsupported SVG tags were skipped: ${[...unsupported].sort().join(", ")}`);
  }

  const normalized = normalizeObjects(objects);
  return {
    objects: normalized,
    warnings,
  };
}

function parseShape(node: Element, style: StyleInfo): HmiObject | null {
  const tag = node.tagName.toLowerCase();
  if (tag === "rect") {
    const x = readNumber(node, "x", 0);
    const y = readNumber(node, "y", 0);
    const width = Math.max(1, readNumber(node, "width", 1));
    const height = Math.max(1, readNumber(node, "height", 1));
    const rx = readNumber(node, "rx", 0);
    const ry = readNumber(node, "ry", 0);
    return {
      id: makeId("rect"),
      type: "rectangle",
      x,
      y,
      width,
      height,
      fill: normalizePaint(style.fill),
      stroke: normalizePaint(style.stroke),
      strokeWidth: style.strokeWidth ?? 0,
      cornerRadius: Math.max(0, rx || ry || 0),
      opacity: style.opacity,
      minWidth: 4,
      minHeight: 4,
    };
  }

  if (tag === "line") {
    const x1 = readNumber(node, "x1", 0);
    const y1 = readNumber(node, "y1", 0);
    const x2 = readNumber(node, "x2", 0);
    const y2 = readNumber(node, "y2", 0);
    return lineFromPoints(
      [x1, y1, x2, y2],
      {
        stroke: normalizePaint(style.stroke) ?? "#d9d9d9",
        strokeWidth: Math.max(1, style.strokeWidth ?? 1),
        fill: undefined,
        closed: false,
        opacity: style.opacity,
      },
      "line",
    );
  }

  if (tag === "polyline" || tag === "polygon") {
    const points = parsePoints(node.getAttribute("points"));
    if (points.length < 4) {
      return null;
    }
    return lineFromPoints(
      points,
      {
        stroke: normalizePaint(style.stroke) ?? "#d9d9d9",
        strokeWidth: Math.max(1, style.strokeWidth ?? 1),
        fill: normalizePaint(style.fill),
        closed: tag === "polygon",
        opacity: style.opacity,
      },
      tag === "polygon" ? "poly" : "line",
    );
  }

  if (tag === "circle") {
    const cx = readNumber(node, "cx", 0);
    const cy = readNumber(node, "cy", 0);
    const r = Math.max(0, readNumber(node, "r", 0));
    return {
      id: makeId("circle"),
      type: "rectangle",
      x: cx - r,
      y: cy - r,
      width: Math.max(1, r * 2),
      height: Math.max(1, r * 2),
      fill: normalizePaint(style.fill),
      stroke: normalizePaint(style.stroke),
      strokeWidth: style.strokeWidth ?? 0,
      cornerRadius: Math.max(0, r),
      opacity: style.opacity,
      minWidth: 4,
      minHeight: 4,
    };
  }

  if (tag === "ellipse") {
    const cx = readNumber(node, "cx", 0);
    const cy = readNumber(node, "cy", 0);
    const rx = Math.max(0, readNumber(node, "rx", 0));
    const ry = Math.max(0, readNumber(node, "ry", 0));
    const points = ellipsePoints(cx, cy, rx, ry, 24);
    return lineFromPoints(
      points,
      {
        stroke: normalizePaint(style.stroke) ?? "#d9d9d9",
        strokeWidth: Math.max(1, style.strokeWidth ?? 1),
        fill: normalizePaint(style.fill),
        closed: true,
        opacity: style.opacity,
      },
      "ellipse",
    );
  }

  return null;
}

function lineFromPoints(
  rawPoints: number[],
  options: { stroke: string; strokeWidth: number; fill?: string; closed?: boolean; opacity?: number },
  prefix: string,
): HmiObject {
  const bounds = boundsFromPoints(rawPoints);
  const relativePoints: number[] = [];
  for (let index = 0; index < rawPoints.length; index += 2) {
    relativePoints.push(rawPoints[index]! - bounds.minX, rawPoints[index + 1]! - bounds.minY);
  }
  return {
    id: makeId(prefix),
    type: "line",
    x: bounds.minX,
    y: bounds.minY,
    width: Math.max(1, bounds.maxX - bounds.minX),
    height: Math.max(1, bounds.maxY - bounds.minY),
    points: relativePoints,
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    fill: options.fill,
    closed: options.closed ?? false,
    opacity: options.opacity,
    minWidth: 4,
    minHeight: 4,
  };
}

function boundsFromPoints(points: number[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return { minX, minY, maxX, maxY };
}

function normalizeObjects(objects: HmiObject[]): HmiObject[] {
  if (!objects.length) {
    return objects;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const object of objects) {
    minX = Math.min(minX, object.x);
    minY = Math.min(minY, object.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return objects;
  }
  return objects.map((object) => ({
    ...object,
    x: object.x - minX,
    y: object.y - minY,
  }));
}

function readStyle(node: Element): StyleInfo {
  const style = parseStyleAttribute(node.getAttribute("style"));
  const fill = node.getAttribute("fill") ?? style.fill;
  const stroke = node.getAttribute("stroke") ?? style.stroke;
  const strokeWidth = readNumberish(node.getAttribute("stroke-width") ?? style["stroke-width"]);
  const opacity = readNumberish(node.getAttribute("opacity") ?? style.opacity);
  return {
    fill: fill ?? undefined,
    stroke: stroke ?? undefined,
    strokeWidth: strokeWidth ?? undefined,
    opacity: opacity ?? undefined,
  };
}

function parseStyleAttribute(style: string | null): Record<string, string> {
  if (!style) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const token of style.split(";")) {
    const [key, value] = token.split(":");
    if (!key || value === undefined) {
      continue;
    }
    out[key.trim().toLowerCase()] = value.trim();
  }
  return out;
}

function readNumber(node: Element, attribute: string, fallback: number): number {
  return readNumberish(node.getAttribute(attribute)) ?? fallback;
}

function readNumberish(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const numeric = Number.parseFloat(value.trim().replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function parsePoints(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  const numeric = raw
    .trim()
    .split(/[\s,]+/)
    .map((token) => Number.parseFloat(token))
    .filter((value) => Number.isFinite(value));
  const out: number[] = [];
  for (let index = 0; index + 1 < numeric.length; index += 2) {
    out.push(numeric[index]!, numeric[index + 1]!);
  }
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, steps: number): number[] {
  const points: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = (Math.PI * 2 * step) / steps;
    points.push(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }
  return points;
}

function normalizePaint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") {
    return undefined;
  }
  return trimmed;
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}
