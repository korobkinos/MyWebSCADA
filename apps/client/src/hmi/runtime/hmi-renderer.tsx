import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Line, Rect, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { message } from "antd";
import {
  clampAccessRoleLevel,
  combineTagPrefix,
  hasRoleAccess,
  roleLevelFromRoles,
  resolveLibraryElementInstanceBindingsDetailed,
  isBindingReference,
  extractBindingKey,
  resolveRuntimeValueSync,
  type ElementStateRule,
  resolveParameters,
  resolveTagName,
  type Asset,
  type ElementLibrary,
  type FrameObject,
  type GroupObject,
  type HmiObject,
  type HmiScreen,
  type LibraryElement,
  type LibraryElementInstanceObject,
  type RenderContext,
  type RuntimeAction,
  type RuntimeResolveContext,
  type ScadaProject,
  type StateImageCondition,
  type TagValue,
  type TextStyle,
} from "@web-scada/shared";
import { applyElementStateRules } from "./element-state-rules";
import { getObjectIndexedConfigForField, resolveObjectTagField } from "../tags/indexed-address";
import { sortObjectsByZIndex } from "../editor/z-order";

const HMI_CONTROL_COLORS = {
  text: "#cccccc",
  textStrong: "#ffffff",
  border: "#3c3c3c",
  borderHover: "#5a5a5a",
  accent: "#007acc",
  accentDark: "#0e639c",
  track: "#2d2d2d",
  thumb: "#e0e0e0",
  disabled: "#6f6f6f",
  bad: "#f14c4c",
  fieldBg: "#1e1e1e",
  fieldDisabledBg: "#3d3d3d",
  overlayBg: "#252526",
} as const;

function isPrimaryPointerButton(event: Event): boolean {
  if ("button" in event && typeof event.button === "number") {
    return event.button === 0;
  }
  return true;
}

type FormatNumericOptions = {
  formatMode?: "decimals" | "pattern";
  decimals?: number;
  formatPattern?: string;
  unit?: string;
  showUnit?: boolean;
};

type GradientDirection = "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
type ShadowDirection = "right" | "left" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
const ROTATION_ANIMATION_SUPPORTED_TYPES = new Set<HmiObject["type"]>([
  "group",
  "text",
  "line",
  "rectangle",
  "image",
  "stateImage",
  "numeric-image-indicator",
  "value-display",
  "state-indicator",
  "button",
]);

function isRotationAnimationSupportedObjectType(type: HmiObject["type"]): boolean {
  return ROTATION_ANIMATION_SUPPORTED_TYPES.has(type);
}

function formatNumericValue(value: number, opts: FormatNumericOptions): string {
  const formatMode = opts.formatMode ?? "decimals";
  const decimals = opts.decimals ?? 2;
  const pattern = opts.formatPattern;
  const unit = opts.unit ?? "";
  const showUnit = opts.showUnit ?? false;

  let formatted: string;
  if (formatMode === "pattern" && pattern) {
    const dotIndex = pattern.indexOf(".");
    if (dotIndex >= 0) {
      const decimalPart = pattern.slice(dotIndex + 1);
      const hasZeros = decimalPart.includes("0");
      if (hasZeros) {
        formatted = value.toFixed(decimalPart.length);
      } else {
        formatted = String(Math.round(value * Math.pow(10, decimalPart.length)) / Math.pow(10, decimalPart.length));
        if (!formatted.includes(".")) {
          formatted += ".";
        }
      }
    } else {
      formatted = String(Math.round(value));
    }
  } else {
    formatted = value.toFixed(Math.max(0, Math.min(10, decimals)));
  }

  if (showUnit && unit) {
    return `${formatted} ${unit}`;
  }
  return formatted;
}

function matchesStateValue(actual: unknown, expected: string | number | boolean): boolean {
  if (typeof expected === "number") {
    if (typeof actual === "number") {
      return Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9;
    }
    if (typeof actual === "string") {
      const parsed = Number(actual.trim());
      return Number.isFinite(parsed) && Math.abs(parsed - expected) < 1e-9;
    }
    return false;
  }
  if (typeof expected === "boolean") {
    if (typeof actual === "boolean") {
      return actual === expected;
    }
    if (typeof actual === "number") {
      return (actual !== 0) === expected;
    }
    if (typeof actual === "string") {
      const normalized = actual.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") {
        return expected === true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "") {
        return expected === false;
      }
    }
    return false;
  }
  return String(actual ?? "").trim() === expected;
}

function normalizeRotationSpeed(value: number, minValue: number, maxValue: number): number {
  const low = Math.min(minValue, maxValue);
  const high = Math.max(minValue, maxValue);
  return Math.max(low, Math.min(high, value));
}

function normalizeFlowSpeed(value: number, minValue: number, maxValue: number): number {
  const low = Math.min(minValue, maxValue);
  const high = Math.max(minValue, maxValue);
  return Math.max(low, Math.min(high, value));
}

type PolylineSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  start: number;
};

type PolylinePath = {
  segments: PolylineSegment[];
  totalLength: number;
};

type PathSample = {
  x: number;
  y: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
};

function buildPolylinePath(points: number[], closed: boolean): PolylinePath {
  const segments: PolylineSegment[] = [];
  if (points.length < 4) {
    return { segments, totalLength: 0 };
  }
  const pairs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = points[i] ?? 0;
    const y1 = points[i + 1] ?? 0;
    const x2 = points[i + 2] ?? 0;
    const y2 = points[i + 3] ?? 0;
    pairs.push({
      x1,
      y1,
      x2,
      y2,
    });
  }
  if (closed && points.length >= 6) {
    const lastX = points[points.length - 2] ?? 0;
    const lastY = points[points.length - 1] ?? 0;
    const firstX = points[0] ?? 0;
    const firstY = points[1] ?? 0;
    pairs.push({
      x1: lastX,
      y1: lastY,
      x2: firstX,
      y2: firstY,
    });
  }

  let cursor = 0;
  for (const pair of pairs) {
    const dx = pair.x2 - pair.x1;
    const dy = pair.y2 - pair.y1;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) {
      continue;
    }
    const ux = dx / length;
    const uy = dy / length;
    segments.push({
      x1: pair.x1,
      y1: pair.y1,
      x2: pair.x2,
      y2: pair.y2,
      length,
      ux,
      uy,
      nx: -uy,
      ny: ux,
      start: cursor,
    });
    cursor += length;
  }
  return { segments, totalLength: cursor };
}

function samplePolylineAt(path: PolylinePath, distance: number): PathSample | null {
  if (!(path.totalLength > 0) || path.segments.length === 0) {
    return null;
  }
  const wrappedDistance = ((distance % path.totalLength) + path.totalLength) % path.totalLength;
  for (const segment of path.segments) {
    if (wrappedDistance > segment.start + segment.length) {
      continue;
    }
    const local = wrappedDistance - segment.start;
    return {
      x: segment.x1 + segment.ux * local,
      y: segment.y1 + segment.uy * local,
      ux: segment.ux,
      uy: segment.uy,
      nx: segment.nx,
      ny: segment.ny,
    };
  }
  const last = path.segments[path.segments.length - 1];
  if (!last) {
    return null;
  }
  return {
    x: last.x2,
    y: last.y2,
    ux: last.ux,
    uy: last.uy,
    nx: last.nx,
    ny: last.ny,
  };
}

function resolveFillGradientProps(args: {
  enabled: boolean;
  direction: GradientDirection;
  startColor: string;
  endColor: string;
  baseFill: string;
  width: number;
  height: number;
}): Record<string, unknown> {
  if (!args.enabled) {
    return {
      fill: args.baseFill,
      fillPriority: "color",
      fillLinearGradientColorStops: undefined,
      fillRadialGradientColorStops: undefined,
    };
  }
  if (args.direction === "center-outward" || args.direction === "outside-inward") {
    const center = { x: args.width * 0.5, y: args.height * 0.5 };
    const radius = Math.max(args.width, args.height) * 0.5;
    const start = args.direction === "outside-inward" ? args.endColor : args.startColor;
    const end = args.direction === "outside-inward" ? args.startColor : args.endColor;
    return {
      fill: args.baseFill,
      fillPriority: "radial-gradient",
      fillRadialGradientStartPoint: center,
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndPoint: center,
      fillRadialGradientEndRadius: radius,
      fillRadialGradientColorStops: [0, start, 1, end],
      fillLinearGradientColorStops: undefined,
    };
  }
  const endPoint = args.direction === "vertical"
    ? { x: 0, y: args.height }
    : args.direction === "diagonal"
      ? { x: args.width, y: args.height }
      : { x: args.width, y: 0 };
  return {
    fill: args.baseFill,
    fillPriority: "linear-gradient",
    fillLinearGradientStartPoint: { x: 0, y: 0 },
    fillLinearGradientEndPoint: endPoint,
    fillLinearGradientColorStops: [0, args.startColor, 1, args.endColor],
    fillRadialGradientColorStops: undefined,
  };
}

function resolveLineGradientProps(args: {
  enabled: boolean;
  direction: GradientDirection;
  startColor: string;
  endColor: string;
  width: number;
  height: number;
}): Record<string, unknown> {
  if (!args.enabled) {
    return {};
  }
  const reversed = args.direction === "outside-inward";
  const endPoint = args.direction === "vertical"
    ? { x: 0, y: args.height }
    : args.direction === "diagonal"
      ? { x: args.width, y: args.height }
      : { x: args.width, y: 0 };
  const startColor = reversed ? args.endColor : args.startColor;
  const endColor = reversed ? args.startColor : args.endColor;
  return {
    strokeLinearGradientStartPoint: { x: 0, y: 0 },
    strokeLinearGradientEndPoint: endPoint,
    strokeLinearGradientColorStops: [0, startColor, 1, endColor],
  };
}

function resolveShadowOffset(direction: ShadowDirection, distance: number): { x: number; y: number } {
  const diagonal = distance * Math.SQRT1_2;
  switch (direction) {
    case "right":
      return { x: distance, y: 0 };
    case "left":
      return { x: -distance, y: 0 };
    case "top":
      return { x: 0, y: -distance };
    case "bottom":
      return { x: 0, y: distance };
    case "top-left":
      return { x: -diagonal, y: -diagonal };
    case "top-right":
      return { x: diagonal, y: -diagonal };
    case "bottom-left":
      return { x: -diagonal, y: diagonal };
    case "bottom-right":
    default:
      return { x: diagonal, y: diagonal };
  }
}

function resolveShapeShadowProps(object: HmiObject, options?: { disabled?: boolean }): Record<string, unknown> {
  if (options?.disabled || !(object.shadowEnabled ?? false)) {
    return {};
  }
  const shadowColor = object.shadowColor ?? "#000000";
  const shadowOpacity = Math.max(0, Math.min(1, object.shadowOpacity ?? 0.35));
  const shadowBlur = Math.max(0, object.shadowBlur ?? 8);
  const shadowDistance = Math.max(0, object.shadowDistance ?? 4);
  const shadowDirection = (object.shadowDirection ?? "bottom-right") as ShadowDirection;
  const shadowOffset = resolveShadowOffset(shadowDirection, shadowDistance);
  return {
    shadowColor,
    shadowOpacity,
    shadowBlur,
    shadowOffsetX: shadowOffset.x,
    shadowOffsetY: shadowOffset.y,
  };
}

function resolveShadowSettings(object: HmiObject): {
  enabled: boolean;
  color: string;
  opacity: number;
  blur: number;
  offsetX: number;
  offsetY: number;
} {
  const enabled = object.shadowEnabled ?? false;
  const color = object.shadowColor ?? "#000000";
  const opacity = Math.max(0, Math.min(1, object.shadowOpacity ?? 0.35));
  const blur = Math.max(0, object.shadowBlur ?? 8);
  const distance = Math.max(0, object.shadowDistance ?? 4);
  const direction = (object.shadowDirection ?? "bottom-right") as ShadowDirection;
  const offset = resolveShadowOffset(direction, distance);
  return {
    enabled,
    color,
    opacity,
    blur,
    offsetX: offset.x,
    offsetY: offset.y,
  };
}

type TagMap = Record<string, TagValue>;
type ResolvedTagValue = {
  resolvedName?: string;
  value?: TagValue;
  missingBindingReference: boolean;
  missingIndexedTag?: boolean;
  indexedAddress?: string;
  indexedUsed?: boolean;
  indexedErrors?: string[];
};

export type ObjectSelectPayload = {
  objectId: string;
  additive: boolean;
};

export type RuntimeOverlayState = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  objectId: string;
  content: React.ReactNode;
};

export type NumericInputOpenPayload = {
  objectId: string;
  objectName: string;
  currentValue: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  formatMode?: "decimals" | "pattern";
  formatPattern?: string;
  unit?: string;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  fontFamily?: string;
  fontSize?: number;
  writeTag?: string;
  errorTag?: string;
  requiredActionRole?: number;
  dialogTitle?: string;
  dialogWidth?: number;
  dialogHeight?: number;
  dialogPlacement?: "custom" | "top" | "right" | "bottom" | "left";
  dialogOffset?: number;
  dialogX?: number;
  dialogY?: number;
  sourceClientRect?: { left: number; top: number; width: number; height: number };
  dialogBackgroundColor?: string;
  dialogTextColor?: string;
  dialogBorderColor?: string;
  dialogCloseButtonTextColor?: string;
  dialogCloseButtonBackgroundColor?: string;
  dialogSetButtonTextColor?: string;
  dialogSetButtonBackgroundColor?: string;
  dialogSetButtonBorderColor?: string;
  showMeta?: boolean;
  stepButtonUseTextColor?: boolean;
  stepButtonTextColor?: string;
  stepButtonBackgroundColor?: string;
  badTextColor?: string;
  badBackgroundColor?: string;
  badBorderColor?: string;
  signalBad?: boolean;
};

type HmiRendererProps = {
  project: ScadaProject;
  screen: HmiScreen;
  mode: "editor" | "runtime";
  tags: TagMap;
  libraries?: ElementLibrary[];
  renderContext: RenderContext;
  frameStack?: string[];
  instanceStack?: string[];
  interactive?: boolean;
  inheritedDisabled?: boolean;
  selectedObjectIds?: string[];
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onCommitObjectMove?: () => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void | Promise<void>;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames?: boolean;
  scopedAssets?: Record<string, Asset>;
  overlayState?: RuntimeOverlayState | null;
  onShowOverlay?: (overlay: RuntimeOverlayState) => void;
  onHideOverlay?: () => void;
  onRequestNumericInput?: (state: NumericInputOpenPayload) => void;
  shadowDisabled?: boolean;
  nodeIdPrefix?: string;
};

type BaseNodeProps = {
  object: HmiObject;
  project: ScadaProject;
  mode: "editor" | "runtime";
  tags: TagMap;
  libraries: ElementLibrary[];
  renderContext: RenderContext;
  frameStack: string[];
  instanceStack: string[];
  interactive: boolean;
  inheritedDisabled: boolean;
  selected: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onCommitObjectMove?: () => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void | Promise<void>;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames: boolean;
  scopedAssets?: Record<string, Asset>;
  overlayState?: RuntimeOverlayState | null;
  onShowOverlay?: (overlay: RuntimeOverlayState) => void;
  onHideOverlay?: () => void;
  onRequestNumericInput?: (state: NumericInputOpenPayload) => void;
  shadowDisabled: boolean;
  nodeIdPrefix?: string;
};

export function HmiRenderer({
  project,
  screen,
  mode,
  tags,
  libraries = [],
  renderContext,
  frameStack = [],
  instanceStack = [],
  interactive = mode === "editor",
  inheritedDisabled = false,
  selectedObjectIds = [],
  onSelectObject,
  onMoveObject,
  onCommitObjectMove,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames = false,
  scopedAssets,
  overlayState,
  onShowOverlay,
  onHideOverlay,
  onRequestNumericInput,
  shadowDisabled = false,
  nodeIdPrefix,
}: HmiRendererProps) {
  const selectedSet = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds]);
  const sortedObjects = useMemo(() => sortObjectsByZIndex(screen.objects), [screen.objects]);
  const debugPerformance =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("debugPerformance") === "1";

  useEffect(() => {
    if (!debugPerformance) {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[Render] HmiRenderer", {
      screenId: screen.id,
      mode,
      objects: screen.objects.length,
      selected: selectedObjectIds.length,
    });
  }, [debugPerformance, mode, screen.id, screen.objects.length, selectedObjectIds.length]);

  return (
    <>
      {sortedObjects.map((object) => (
        <MemoObjectNode
          key={object.id}
          object={object}
          project={project}
          mode={mode}
          tags={tags}
          libraries={libraries}
          renderContext={renderContext}
          frameStack={frameStack}
          instanceStack={instanceStack}
          interactive={interactive}
          inheritedDisabled={inheritedDisabled}
          selected={selectedSet.has(object.id)}
          onSelectObject={onSelectObject}
            onMoveObject={onMoveObject}
            onCommitObjectMove={onCommitObjectMove}
            onResizeObject={onResizeObject}
          onAction={onAction}
          onDoubleClickObject={onDoubleClickObject}
          onContextMenuObject={onContextMenuObject}
          showObjectFrames={showObjectFrames}
          scopedAssets={scopedAssets}
          overlayState={overlayState}
          onShowOverlay={onShowOverlay}
          onHideOverlay={onHideOverlay}
          onRequestNumericInput={onRequestNumericInput}
          shadowDisabled={shadowDisabled}
          nodeIdPrefix={nodeIdPrefix}
        />
      ))}
    </>
  );
}

const MemoObjectNode = memo(ObjectNode, areObjectNodePropsEqual);

function areObjectNodePropsEqual(prev: BaseNodeProps, next: BaseNodeProps): boolean {
  if (prev.object !== next.object) return false;
  if (prev.libraries !== next.libraries) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.interactive !== next.interactive) return false;
  if (prev.inheritedDisabled !== next.inheritedDisabled) return false;
  if (prev.showObjectFrames !== next.showObjectFrames) return false;
  if (prev.mode !== next.mode) return false;
  if (prev.shadowDisabled !== next.shadowDisabled) return false;
  if (prev.renderContext.tagPrefix !== next.renderContext.tagPrefix) return false;
  if (prev.renderContext.parameters !== next.renderContext.parameters) return false;
  if (prev.renderContext.isAuthenticated !== next.renderContext.isAuthenticated) return false;
  if (prev.renderContext.userRoleLevel !== next.renderContext.userRoleLevel) return false;
  if (prev.nodeIdPrefix !== next.nodeIdPrefix) return false;
  const prevRoles = prev.renderContext.userRoles?.join("|") ?? "";
  const nextRoles = next.renderContext.userRoles?.join("|") ?? "";
  if (prevRoles !== nextRoles) return false;
  if (next.mode === "editor") {
    return true;
  }

  const watchedTags = collectWatchedTags(next.object, next.renderContext);
  if (!watchedTags) {
    return prev.tags === next.tags;
  }
  for (const tagName of watchedTags) {
    const left = prev.tags[tagName];
    const right = next.tags[tagName];
    if (!left && !right) {
      continue;
    }
    if (!left || !right) {
      return false;
    }
    if (left.value !== right.value || left.quality !== right.quality || left.timestamp !== right.timestamp) {
      return false;
    }
  }
  return true;
}

function collectWatchedTags(object: HmiObject, context: RenderContext): string[] | null {
  if (object.type === "libraryElementInstance" || object.type === "frame") {
    return null;
  }
  if (object.tagIndexingByField && Object.keys(object.tagIndexingByField).length > 0) {
    return null;
  }
  if (object.tagIndexing?.enabled) {
    return null;
  }

  if (object.type === "group") {
    const tags = new Set<string>();
    for (const ownTag of [object.visibleTag, object.disabledTag]) {
      const resolvedOwnTag = resolveTagName(ownTag, context);
      if (resolvedOwnTag) {
        tags.add(resolvedOwnTag);
      }
    }
    const groupRotationAnimation = object.rotationAnimation;
    if (groupRotationAnimation?.enabled === true || groupRotationAnimation?.triggerTag?.trim() || groupRotationAnimation?.speedTag?.trim()) {
      for (const ownTag of [groupRotationAnimation?.triggerTag, groupRotationAnimation?.speedTag]) {
        const resolvedOwnTag = resolveTagName(ownTag, context);
        if (resolvedOwnTag) {
          tags.add(resolvedOwnTag);
        }
      }
    }
    for (const child of object.objects) {
      const childTags = collectWatchedTags(child, context);
      if (!childTags) {
        return null;
      }
      for (const item of childTags) {
        tags.add(item);
      }
    }
    return [...tags];
  }

  const candidates: Array<string | undefined> = [];
  candidates.push(object.visibleTag, object.disabledTag);
  switch (object.type) {
    case "line":
      candidates.push(object.stateTag);
      if (object.flowAnimation?.enabled === true || object.flowAnimation?.triggerTag?.trim() || object.flowAnimation?.speedTag?.trim()) {
        candidates.push(object.flowAnimation?.triggerTag, object.flowAnimation?.speedTag);
      }
      break;
    case "value-display":
    case "value-input":
    case "state-indicator":
    case "switch":
    case "stateImage":
    case "numeric-image-indicator":
      candidates.push(object.tag);
      break;
    case "image":
      candidates.push(object.stateTag);
      break;
    case "valueSelect":
      if (object.target.type === "tag") {
        candidates.push(object.target.tag);
      } else if (object.target.type === "lw") {
        candidates.push(`LW${Math.max(0, Math.floor(object.target.address))}`);
      } else {
        const normalized = object.target.name.trim().startsWith("LW.")
          ? object.target.name.trim()
          : `LW.${object.target.name.trim()}`;
        candidates.push(normalized);
      }
      break;
    case "checkbox":
    case "slider":
    case "radio-group":
      candidates.push(object.tag, object.writeTag);
      break;
    case "numeric-input":
      candidates.push(object.tag, object.writeTag, object.errorTag);
      break;
    case "progress-bar":
      candidates.push(object.tag);
      break;
    case "select":
      candidates.push(object.tag, object.writeTag);
      break;
    case "valve":
      candidates.push(object.openTag, object.closedTag, object.errorTag);
      break;
    case "pump":
      candidates.push(object.runTag, object.faultTag);
      break;
    default:
      break;
  }
  const rotationAnimation = object.rotationAnimation;
  const hasRotationTriggerTag = Boolean(rotationAnimation?.triggerTag?.trim());
  const hasRotationSpeedTag = Boolean(rotationAnimation?.speedTag?.trim());
  if (
    isRotationAnimationSupportedObjectType(object.type)
    && (rotationAnimation?.enabled === true || hasRotationTriggerTag || hasRotationSpeedTag)
  ) {
    candidates.push(rotationAnimation?.triggerTag, rotationAnimation?.speedTag);
  }

  return candidates
    .map((name) => resolveTagName(name, context))
    .filter((name): name is string => Boolean(name));
}

function ObjectNode({
  object,
  project,
  mode,
  tags,
  libraries,
  renderContext,
  frameStack,
  instanceStack,
  interactive,
  inheritedDisabled,
  selected,
  onSelectObject,
  onMoveObject,
  onCommitObjectMove,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames,
  scopedAssets,
  overlayState,
  onShowOverlay,
  onHideOverlay,
  onRequestNumericInput,
  shadowDisabled,
  nodeIdPrefix,
}: BaseNodeProps) {
  const resolvedObject = useMemo(() => resolveObjectParameters(object, renderContext.parameters ?? {}), [object, renderContext.parameters]);
  const runtimeMode = mode === "runtime";
  const [isDragging, setIsDragging] = useState(false);
  const [rotationAnimationOffset, setRotationAnimationOffset] = useState(0);
  const [flowAnimationDashOffset, setFlowAnimationDashOffset] = useState(0);
  const rotationAnimationOffsetRef = useRef(0);
  const flowAnimationDashOffsetRef = useRef(0);
  const rotationFrameRef = useRef<number | null>(null);
  const flowAnimationFrameRef = useRef<number | null>(null);
  const rotationLastFrameRef = useRef<number | null>(null);
  const flowAnimationLastFrameRef = useRef<number | null>(null);
  const effectiveShadowDisabled = shadowDisabled || (mode === "editor" && isDragging);
  const debugPerformance =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("debugPerformance") === "1";

  useEffect(() => {
    if (!debugPerformance) {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[Render] HmiObjectNode", {
      id: resolvedObject.id,
      type: resolvedObject.type,
      interactive,
    });
  }, [debugPerformance, interactive, resolvedObject.id, resolvedObject.type]);

  const indexedTagCache = new Map<string, ReturnType<typeof resolveObjectTagField>>();
  const tagValue = (name: string | undefined, options?: { useObjectIndexing?: boolean; fieldName?: string }): ResolvedTagValue => {
    const resolved = resolveTagName(name, renderContext);
    const missingBindingReference = isBindingReference(name) && !resolved;
    const fieldName = options?.fieldName ?? "tag";
    const indexedConfig = getObjectIndexedConfigForField(resolvedObject, fieldName);
    if (!runtimeMode || !options?.useObjectIndexing || !indexedConfig?.enabled) {
      return {
        resolvedName: resolved,
        value: resolved ? tags[resolved] : undefined,
        missingBindingReference,
      };
    }

    const cacheKey = `${fieldName}|${name ?? ""}|${resolved ?? ""}`;
    let indexed = indexedTagCache.get(cacheKey);
    if (!indexed) {
      indexed = resolveObjectTagField({
        object: resolvedObject,
        fieldName,
        project,
        context: renderContext,
        tagValues: tags,
        rawTagName: name,
      });
      indexedTagCache.set(cacheKey, indexed);
    }

    return {
      resolvedName: indexed.resolvedTagName,
      value: indexed.resolvedTagName ? tags[indexed.resolvedTagName] : undefined,
      missingBindingReference,
      missingIndexedTag: indexed.usedIndexedAddress && !indexed.resolvedTagName,
      indexedAddress: indexed.resolvedAddress,
      indexedUsed: indexed.usedIndexedAddress,
      indexedErrors: indexed.errors,
    };
  };

  const baseRotation = resolvedObject.rotation ?? 0;
  const rotationAnimation = resolvedObject.rotationAnimation;
  const rotationAnimationSupported = isRotationAnimationSupportedObjectType(resolvedObject.type);
  const rotationAnimationEnabled = rotationAnimation?.enabled === true;
  const rotationPivot = rotationAnimation?.pivot ?? "center";
  const rotationAnimationConfigActive = runtimeMode && rotationAnimationSupported && rotationAnimationEnabled;
  let rotationAnimationIsActive = false;
  let rotationAnimationSpeedDegPerSec = 0;
  if (rotationAnimationConfigActive) {
    const triggerTagRaw = rotationAnimation?.triggerTag?.trim() ?? "";
    if (!triggerTagRaw) {
      rotationAnimationIsActive = true;
    } else {
      const trigger = tagValue(rotationAnimation?.triggerTag, {
        useObjectIndexing: true,
        fieldName: "rotationAnimation.triggerTag",
      });
      if (
        trigger.resolvedName
        && !trigger.missingBindingReference
        && !trigger.missingIndexedTag
        && trigger.value
        && trigger.value.quality !== "Bad"
      ) {
        const triggerMode = rotationAnimation?.triggerMode ?? "truthy";
        const triggerRawValue = trigger.value.value;
        if (triggerMode === "equals") {
          if (rotationAnimation?.triggerValue !== undefined) {
            rotationAnimationIsActive = matchesStateValue(triggerRawValue, rotationAnimation.triggerValue);
          } else {
            rotationAnimationIsActive = false;
          }
        } else if (triggerMode === "notEquals") {
          if (rotationAnimation?.triggerValue !== undefined) {
            rotationAnimationIsActive = !matchesStateValue(triggerRawValue, rotationAnimation.triggerValue);
          } else {
            rotationAnimationIsActive = false;
          }
        } else {
          rotationAnimationIsActive = Boolean(triggerRawValue);
        }
      } else {
        rotationAnimationIsActive = false;
      }
    }
    if (rotationAnimation?.triggerInvert) {
      rotationAnimationIsActive = !rotationAnimationIsActive;
    }

    const fixedSpeed = Number(rotationAnimation?.fixedSpeedDegPerSec ?? 90);
    const fallbackSpeed = Number.isFinite(fixedSpeed) ? fixedSpeed : 90;
    let resolvedSpeed = fallbackSpeed;
    if ((rotationAnimation?.speedSource ?? "fixed") === "tag") {
      const speed = tagValue(rotationAnimation?.speedTag, {
        useObjectIndexing: true,
        fieldName: "rotationAnimation.speedTag",
      });
      const numericSpeed = Number(speed.value?.value);
      if (
        speed.resolvedName
        && !speed.missingBindingReference
        && !speed.missingIndexedTag
        && speed.value?.quality !== "Bad"
        && Number.isFinite(numericSpeed)
      ) {
        resolvedSpeed = numericSpeed;
      }
    }
    const minSpeed = Number(rotationAnimation?.minSpeedDegPerSec ?? 0);
    const maxSpeed = Number(rotationAnimation?.maxSpeedDegPerSec ?? 720);
    const normalizedMin = Number.isFinite(minSpeed) ? minSpeed : 0;
    const normalizedMax = Number.isFinite(maxSpeed) ? maxSpeed : 720;
    let clampedSpeed = normalizeRotationSpeed(resolvedSpeed, normalizedMin, normalizedMax);
    if ((rotationAnimation?.direction ?? "clockwise") === "counterclockwise") {
      clampedSpeed = -clampedSpeed;
    }
    rotationAnimationSpeedDegPerSec = clampedSpeed;
  }

  const flowAnimation = resolvedObject.type === "line" ? resolvedObject.flowAnimation : undefined;
  const flowAnimationConfigActive = runtimeMode && resolvedObject.type === "line" && flowAnimation?.enabled === true;
  let flowAnimationIsActive = false;
  let flowAnimationSpeedPxPerSec = 0;
  if (flowAnimationConfigActive) {
    const triggerTagRaw = flowAnimation?.triggerTag?.trim() ?? "";
    if (!triggerTagRaw) {
      flowAnimationIsActive = true;
    } else {
      const trigger = tagValue(flowAnimation?.triggerTag, {
        useObjectIndexing: true,
        fieldName: "flowAnimation.triggerTag",
      });
      if (
        trigger.resolvedName
        && !trigger.missingBindingReference
        && !trigger.missingIndexedTag
        && trigger.value
        && trigger.value.quality !== "Bad"
      ) {
        const triggerMode = flowAnimation?.triggerMode ?? "truthy";
        const triggerRawValue = trigger.value.value;
        if (triggerMode === "equals") {
          if (flowAnimation?.triggerValue !== undefined) {
            flowAnimationIsActive = matchesStateValue(triggerRawValue, flowAnimation.triggerValue);
          } else {
            flowAnimationIsActive = false;
          }
        } else if (triggerMode === "notEquals") {
          if (flowAnimation?.triggerValue !== undefined) {
            flowAnimationIsActive = !matchesStateValue(triggerRawValue, flowAnimation.triggerValue);
          } else {
            flowAnimationIsActive = false;
          }
        } else {
          flowAnimationIsActive = Boolean(triggerRawValue);
        }
      } else {
        flowAnimationIsActive = false;
      }
    }
    if (flowAnimation?.triggerInvert) {
      flowAnimationIsActive = !flowAnimationIsActive;
    }

    const fixedSpeed = Number(flowAnimation?.fixedSpeedPxPerSec ?? 80);
    const fallbackSpeed = Number.isFinite(fixedSpeed) ? fixedSpeed : 80;
    let resolvedSpeed = fallbackSpeed;
    if ((flowAnimation?.speedSource ?? "fixed") === "tag") {
      const speed = tagValue(flowAnimation?.speedTag, {
        useObjectIndexing: true,
        fieldName: "flowAnimation.speedTag",
      });
      const numericSpeed = Number(speed.value?.value);
      if (
        speed.resolvedName
        && !speed.missingBindingReference
        && !speed.missingIndexedTag
        && speed.value?.quality !== "Bad"
        && Number.isFinite(numericSpeed)
      ) {
        resolvedSpeed = numericSpeed;
      }
    }
    const minSpeed = Number(flowAnimation?.minSpeedPxPerSec ?? 0);
    const maxSpeed = Number(flowAnimation?.maxSpeedPxPerSec ?? 500);
    const normalizedMin = Number.isFinite(minSpeed) ? minSpeed : 0;
    const normalizedMax = Number.isFinite(maxSpeed) ? maxSpeed : 500;
    let clampedSpeed = normalizeFlowSpeed(resolvedSpeed, normalizedMin, normalizedMax);
    if ((flowAnimation?.direction ?? "forward") === "reverse") {
      clampedSpeed = -clampedSpeed;
    }
    flowAnimationSpeedPxPerSec = clampedSpeed;
  }

  useEffect(() => {
    if (rotationFrameRef.current !== null) {
      cancelAnimationFrame(rotationFrameRef.current);
      rotationFrameRef.current = null;
    }
    rotationLastFrameRef.current = null;
    if (!rotationAnimationIsActive || !Number.isFinite(rotationAnimationSpeedDegPerSec) || rotationAnimationSpeedDegPerSec === 0) {
      return;
    }

    const step = (time: number) => {
      const previousTime = rotationLastFrameRef.current ?? time;
      const deltaSeconds = Math.max(0, (time - previousTime) / 1000);
      rotationLastFrameRef.current = time;
      if (deltaSeconds > 0) {
        const rawOffset = rotationAnimationOffsetRef.current + rotationAnimationSpeedDegPerSec * deltaSeconds;
        const normalizedOffset = ((rawOffset % 360) + 360) % 360;
        rotationAnimationOffsetRef.current = normalizedOffset;
        setRotationAnimationOffset(normalizedOffset);
      }
      rotationFrameRef.current = requestAnimationFrame(step);
    };

    rotationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (rotationFrameRef.current !== null) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
      rotationLastFrameRef.current = null;
    };
  }, [rotationAnimationIsActive, rotationAnimationSpeedDegPerSec]);

  useEffect(() => {
    if (flowAnimationFrameRef.current !== null) {
      cancelAnimationFrame(flowAnimationFrameRef.current);
      flowAnimationFrameRef.current = null;
    }
    flowAnimationLastFrameRef.current = null;
    if (!flowAnimationIsActive || !Number.isFinite(flowAnimationSpeedPxPerSec) || flowAnimationSpeedPxPerSec === 0) {
      return;
    }

    const step = (time: number) => {
      const previousTime = flowAnimationLastFrameRef.current ?? time;
      const deltaSeconds = Math.max(0, (time - previousTime) / 1000);
      flowAnimationLastFrameRef.current = time;
      if (deltaSeconds > 0) {
        const rawOffset = flowAnimationDashOffsetRef.current + flowAnimationSpeedPxPerSec * deltaSeconds;
        flowAnimationDashOffsetRef.current = rawOffset;
        setFlowAnimationDashOffset(rawOffset);
      }
      flowAnimationFrameRef.current = requestAnimationFrame(step);
    };

    flowAnimationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (flowAnimationFrameRef.current !== null) {
        cancelAnimationFrame(flowAnimationFrameRef.current);
        flowAnimationFrameRef.current = null;
      }
      flowAnimationLastFrameRef.current = null;
    };
  }, [flowAnimationIsActive, flowAnimationSpeedPxPerSec]);

  const animatedRotationOffset = rotationAnimationConfigActive ? rotationAnimationOffset : 0;
  const effectiveRotation = baseRotation + animatedRotationOffset;
  const useAnimatedCenterPivot = rotationAnimationConfigActive && rotationPivot === "center";
  const centerOffsetX = resolvedObject.width * 0.5;
  const centerOffsetY = resolvedObject.height * 0.5;

  const selectable = interactive;
  const visibleByRole = isObjectVisibleByRole(resolvedObject, mode, renderContext);
  if (!visibleByRole && mode === "runtime") {
    return null;
  }
  const visibleByRuntimeState = mode !== "runtime" || resolveObjectVisible(resolvedObject, tags, renderContext, project);
  if (!visibleByRuntimeState && mode === "runtime") {
    return null;
  }
  const disabledByRuntimeState = mode === "runtime" && resolveObjectDisabled(resolvedObject, tags, renderContext, project);
  const hasOwnDisabledBinding = hasRuntimeStateTag(resolvedObject.disabledTag);
  const runtimeDisabled = mode === "runtime" && (inheritedDisabled ? (hasOwnDisabledBinding ? disabledByRuntimeState : true) : disabledByRuntimeState);
  const triggerObjectMacroEvent = (eventName: "press" | "release") => {
    if (interactive || runtimeDisabled) {
      return;
    }
    const macroId = eventName === "press" ? resolvedObject.onPressMacroId : resolvedObject.onReleaseMacroId;
    if (!macroId?.trim()) {
      return;
    }
    onAction?.(
      withActionRoleLevel({
        type: "runMacro",
        macroId: macroId.trim(),
      }, resolvedObject.requiredActionRole),
      withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
    );
  };

  const commonGroupProps = {
    id: `hmi-${nodeIdPrefix ?? ""}${resolvedObject.id}`,
    x: useAnimatedCenterPivot ? (resolvedObject.x + centerOffsetX) : resolvedObject.x,
    y: useAnimatedCenterPivot ? (resolvedObject.y + centerOffsetY) : resolvedObject.y,
    rotation: effectiveRotation,
    offsetX: useAnimatedCenterPivot ? centerOffsetX : 0,
    offsetY: useAnimatedCenterPivot ? centerOffsetY : 0,
    opacity: resolvedObject.opacity ?? 1,
    visible: (resolvedObject.visible ?? true) && visibleByRole,
    draggable: interactive && !resolvedObject.locked,
    onDragStart: () => {
      if (mode === "editor" && interactive && !resolvedObject.locked) {
        setIsDragging(true);
      }
    },
    onClick: (evt: KonvaEventObject<MouseEvent>) => {
      if (!isPrimaryPointerButton(evt.evt)) {
        return;
      }
      if (!selectable) {
        return;
      }
      onSelectObject?.({
        objectId: resolvedObject.id,
        additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
      });
    },
    onTap: (evt: KonvaEventObject<Event>) => {
      if (!selectable) {
        return;
      }
      const source = evt.evt as MouseEvent;
      onSelectObject?.({
        objectId: resolvedObject.id,
        additive: Boolean(source.ctrlKey || source.metaKey || source.shiftKey),
      });
    },
    onMouseDown: () => {
      triggerObjectMacroEvent("press");
    },
    onMouseUp: () => {
      triggerObjectMacroEvent("release");
    },
    onDragEnd: (evt: KonvaEventObject<DragEvent>) => {
      setIsDragging(false);
      if (interactive && !resolvedObject.locked) {
        if (onCommitObjectMove) {
          onCommitObjectMove();
        } else {
          onMoveObject?.(resolvedObject.id, evt.target.x(), evt.target.y());
        }
      }
    },
    onDragMove: (evt: KonvaEventObject<DragEvent>) => {
      if (interactive && !resolvedObject.locked) {
        onMoveObject?.(resolvedObject.id, evt.target.x(), evt.target.y());
      }
    },
    onTransformEnd: (evt: KonvaEventObject<Event>) => {
      if (!interactive || resolvedObject.locked) {
        return;
      }
      const node = evt.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const minWidth = resolvedObject.minWidth ?? 8;
      const minHeight = resolvedObject.minHeight ?? 8;
      const nextWidth = Math.max(minWidth, resolvedObject.width * scaleX);
      const nextHeight = Math.max(minHeight, resolvedObject.height * scaleY);

      if (resolvedObject.type === "line") {
        const scaledPoints = resolvedObject.points.map((point, index) => (index % 2 === 0 ? point * scaleX : point * scaleY));
        onResizeObject?.(resolvedObject.id, {
          x: node.x(),
          y: node.y(),
          width: nextWidth,
          height: nextHeight,
          rotation: node.rotation(),
          points: scaledPoints,
        } as Partial<HmiObject>);
      } else {
        onResizeObject?.(resolvedObject.id, {
          x: node.x(),
          y: node.y(),
          width: nextWidth,
          height: nextHeight,
          rotation: node.rotation(),
        });
      }

      node.scaleX(1);
      node.scaleY(1);
    },
    onDblClick: () => {
      if (interactive) {
        onDoubleClickObject?.(resolvedObject.id);
      }
    },
    onContextMenu: (evt: KonvaEventObject<PointerEvent>) => {
      if (!interactive) {
        return;
      }
      evt.evt.preventDefault();
      onContextMenuObject?.({
        objectId: resolvedObject.id,
        clientX: evt.evt.clientX,
        clientY: evt.evt.clientY,
        additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
      });
    },
  };

  if (resolvedObject.type === "group") {
    return (
      <GroupNode
        object={resolvedObject}
        project={project}
        mode={mode}
        tags={tags}
        libraries={libraries}
        renderContext={renderContext}
        frameStack={frameStack}
        instanceStack={instanceStack}
        interactive={interactive}
        inheritedDisabled={runtimeDisabled}
        selected={selected}
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onCommitObjectMove={onCommitObjectMove}
        onResizeObject={onResizeObject}
        onAction={onAction}
        onDoubleClickObject={onDoubleClickObject}
        onContextMenuObject={onContextMenuObject}
        showObjectFrames={showObjectFrames}
        scopedAssets={scopedAssets}
        groupProps={commonGroupProps}
        overlayState={overlayState}
        onShowOverlay={onShowOverlay}
        onHideOverlay={onHideOverlay}
        shadowDisabled={effectiveShadowDisabled}
        nodeIdPrefix={nodeIdPrefix}
      />
    );
  }

  if (resolvedObject.type === "text") {
    const textShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    const textShadowSettings = resolveShadowSettings(resolvedObject);
    const shadowTextStyle: TextStyle = {
      ...resolvedObject.textStyle,
      color: textShadowSettings.color,
    };
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        {!effectiveShadowDisabled && textShadowSettings.enabled && textShadowSettings.opacity > 0 ? (
          renderBoxText(resolvedObject.text, shadowTextStyle, {
            width: resolvedObject.width,
            height: resolvedObject.height,
            wrap: resolvedObject.wrap,
            ellipsis: resolvedObject.ellipsis,
            xOffset: textShadowSettings.offsetX,
            yOffset: textShadowSettings.offsetY,
            opacity: textShadowSettings.opacity,
            shadowProps: {
              shadowColor: textShadowSettings.color,
              shadowOpacity: 1,
              shadowBlur: textShadowSettings.blur,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
            },
          })
        ) : null}
        {renderBoxText(resolvedObject.text, resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
          shadowProps: textShadowProps,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "line") {
    const lineStateTag = runtimeMode ? tagValue(resolvedObject.stateTag, { useObjectIndexing: true, fieldName: "stateTag" }) : undefined;
    const hasStateTag = Boolean(resolvedObject.stateTag?.trim());
    const lineStateValue = lineStateTag?.value?.value;
    const isStateActive = runtimeMode && hasStateTag
      ? (resolvedObject.activeValue !== undefined
        ? matchesStateValue(lineStateValue, resolvedObject.activeValue)
        : Boolean(lineStateValue))
      : false;
    const lineStroke = hasStateTag
      ? (isStateActive
        ? (resolvedObject.activeStroke ?? resolvedObject.stroke)
        : (resolvedObject.inactiveStroke ?? resolvedObject.stroke))
      : resolvedObject.stroke;
    const lineGradientEnabled = resolvedObject.gradientEnabled ?? false;
    const lineGradientStart = resolvedObject.gradientStartColor ?? lineStroke;
    const lineGradientEnd = resolvedObject.gradientEndColor ?? lineStroke;
    const lineGradientDirection = (resolvedObject.gradientDirection ?? "horizontal") as GradientDirection;
    const lineStrokeGradientProps = resolveLineGradientProps({
      enabled: lineGradientEnabled,
      direction: lineGradientDirection,
      startColor: lineGradientStart,
      endColor: lineGradientEnd,
      width: resolvedObject.width,
      height: resolvedObject.height,
    });
    const lineFillGradientProps = resolvedObject.closed
      ? resolveFillGradientProps({
          enabled: lineGradientEnabled,
          direction: lineGradientDirection,
          startColor: resolvedObject.gradientStartColor ?? (resolvedObject.fill ?? lineStroke),
          endColor: resolvedObject.gradientEndColor ?? (resolvedObject.fill ?? lineStroke),
          baseFill: resolvedObject.fill ?? "transparent",
          width: resolvedObject.width,
          height: resolvedObject.height,
        })
      : {};
    const lineShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    const flowEffectType = flowAnimation?.effectType ?? "dash";
    const flowDashLength = Number(flowAnimation?.dashLength ?? 12);
    const flowGapLength = Number(flowAnimation?.gapLength ?? 8);
    const normalizedDashLength = Number.isFinite(flowDashLength) && flowDashLength > 0 ? flowDashLength : 12;
    const normalizedGapLength = Number.isFinite(flowGapLength) && flowGapLength > 0 ? flowGapLength : 8;
    const flowDash = flowEffectType === "dots" ? [Math.max(1, Math.round(normalizedDashLength * 0.25)), normalizedGapLength] : [normalizedDashLength, normalizedGapLength];
    const flowColor = flowAnimation?.color ?? resolvedObject.activeStroke ?? resolvedObject.stroke ?? "#00bfff";
    const flowOpacity = Number(flowAnimation?.opacity ?? 1);
    const normalizedFlowOpacity = Number.isFinite(flowOpacity) ? Math.max(0, Math.min(1, flowOpacity)) : 1;
    const defaultInnerStrokeWidth = Math.max(1, Math.min(resolvedObject.strokeWidth, Math.max(2, resolvedObject.strokeWidth * 0.35)));
    const useBaseStrokeWidth = flowAnimation?.useBaseStrokeWidth ?? false;
    const flowStrokeWidthRaw = Number(useBaseStrokeWidth ? resolvedObject.strokeWidth : (flowAnimation?.strokeWidth ?? defaultInnerStrokeWidth));
    const flowStrokeWidth = Number.isFinite(flowStrokeWidthRaw) ? Math.max(0, flowStrokeWidthRaw) : Math.max(0, resolvedObject.strokeWidth);
    const showFlowOverlay = flowAnimationConfigActive && flowAnimationIsActive && flowStrokeWidth > 0 && (flowEffectType === "dash" || flowEffectType === "arrows" || flowEffectType === "dots");
    const flowPath = buildPolylinePath(resolvedObject.points, resolvedObject.closed ?? false);
    const flowSpacing = Math.max(2, normalizedDashLength + normalizedGapLength);
    const markerCount = Math.min(400, Math.max(1, Math.ceil((flowPath.totalLength || 0) / flowSpacing) + 1));
    const renderDashOverlay = showFlowOverlay && flowEffectType === "dash";
    const renderDotsOverlay = showFlowOverlay && flowEffectType === "dots";
    const renderArrowsOverlay = showFlowOverlay && flowEffectType === "arrows";
    const dotRadius = Math.max(1, Math.min(flowStrokeWidth * 0.5, normalizedDashLength * 0.5));
    const arrowLength = Math.max(6, normalizedDashLength);
    const arrowHalfWidth = Math.max(2, Math.min(flowStrokeWidth * 0.5, arrowLength * 0.55));
    const flowMarkerPhase = flowAnimationDashOffset;
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Line
          points={resolvedObject.points}
          stroke={lineStroke}
          strokeWidth={resolvedObject.strokeWidth}
          closed={resolvedObject.closed ?? false}
          fill={resolvedObject.fill}
          perfectDrawEnabled={false}
          {...lineFillGradientProps}
          {...lineStrokeGradientProps}
          {...lineShadowProps}
        />
        {renderDashOverlay ? (
          <Line
            points={resolvedObject.points}
            stroke={flowColor}
            strokeWidth={flowStrokeWidth}
            opacity={normalizedFlowOpacity}
            closed={resolvedObject.closed ?? false}
            dash={flowDash}
            dashOffset={flowAnimationDashOffset}
            fillEnabled={false}
            listening={false}
            lineCap="round"
            lineJoin="round"
            perfectDrawEnabled={false}
          />
        ) : null}
        {renderDotsOverlay && flowPath.totalLength > 0
          ? Array.from({ length: markerCount }).map((_, markerIndex) => {
            const sample = samplePolylineAt(flowPath, markerIndex * flowSpacing + flowMarkerPhase);
            if (!sample) {
              return null;
            }
            return (
              <Circle
                key={`flow-dot-${markerIndex}`}
                x={sample.x}
                y={sample.y}
                radius={dotRadius}
                fill={flowColor}
                opacity={normalizedFlowOpacity}
                listening={false}
              />
            );
          })
          : null}
        {renderArrowsOverlay && flowPath.totalLength > 0
          ? Array.from({ length: markerCount }).map((_, markerIndex) => {
            const sample = samplePolylineAt(flowPath, markerIndex * flowSpacing + flowMarkerPhase);
            if (!sample) {
              return null;
            }
            const tipX = sample.x;
            const tipY = sample.y;
            const baseX = tipX - sample.ux * arrowLength;
            const baseY = tipY - sample.uy * arrowLength;
            const leftX = baseX + sample.nx * arrowHalfWidth;
            const leftY = baseY + sample.ny * arrowHalfWidth;
            const rightX = baseX - sample.nx * arrowHalfWidth;
            const rightY = baseY - sample.ny * arrowHalfWidth;
            return (
              <Line
                key={`flow-arrow-${markerIndex}`}
                points={[tipX, tipY, leftX, leftY, rightX, rightY]}
                closed
                fill={flowColor}
                opacity={normalizedFlowOpacity}
                listening={false}
                perfectDrawEnabled={false}
              />
            );
          })
          : null}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "rectangle") {
    const rectBaseFill = resolvedObject.fill ?? "#262626";
    const rectGradientEnabled = resolvedObject.gradientEnabled ?? false;
    const rectGradientDirection = (resolvedObject.gradientDirection ?? "horizontal") as GradientDirection;
    const rectGradientProps = resolveFillGradientProps({
      enabled: rectGradientEnabled,
      direction: rectGradientDirection,
      startColor: resolvedObject.gradientStartColor ?? rectBaseFill,
      endColor: resolvedObject.gradientEndColor ?? rectBaseFill,
      baseFill: rectBaseFill,
      width: resolvedObject.width,
      height: resolvedObject.height,
    });
    const rectShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          {...rectGradientProps}
          stroke={resolvedObject.stroke}
          strokeWidth={resolvedObject.strokeWidth}
          cornerRadius={resolvedObject.cornerRadius}
          perfectDrawEnabled={false}
          {...rectShadowProps}
        />
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "value-display") {
    const resolvedTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const runtimeTag = resolvedTag ?? { missingBindingReference: false, value: undefined };
    const value = resolvedTag?.value;
    const text = !runtimeMode
      ? (resolvedObject.tag?.trim() || `${resolvedObject.suffix ? `---${resolvedObject.suffix}` : "---"}`)
      : runtimeTag.missingBindingReference
        || runtimeTag.missingIndexedTag
        ? resolvedObject.badQualityText ?? "BAD"
        : !value
        ? "---"
        : value.quality === "Bad"
          ? resolvedObject.badQualityText ?? "BAD"
          : `${value.value ?? "---"}${resolvedObject.suffix ?? ""}`;

    if (runtimeMode && isIndexedAddressDebugEnabled()) {
      const rawTagName = resolvedObject.tag;
      const resolvedTagName = resolvedTag?.resolvedName;
      // eslint-disable-next-line no-console
      console.debug("[indexed-address] renderer:value-display", {
        objectId: resolvedObject.id,
        objectName: resolvedObject.name,
        rawTagName,
        resolvedUsedIndexedAddress: resolvedTag?.indexedUsed,
        resolvedAddress: resolvedTag?.indexedAddress,
        resolvedTagName,
        resolvedErrors: resolvedTag?.indexedErrors,
        rawValue: rawTagName ? tags[rawTagName] : undefined,
        resolvedValue: resolvedTagName ? tags[resolvedTagName] : undefined,
        displayedValue: text,
        tagValuesHasRaw: rawTagName ? Object.prototype.hasOwnProperty.call(tags, rawTagName) : false,
        tagValuesHasResolved: resolvedTagName
          ? Object.prototype.hasOwnProperty.call(tags, resolvedTagName)
          : false,
      });
    }

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        {renderBoxText(text, resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "value-input") {
    const resolvedInputTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const value = runtimeMode ? resolvedInputTag?.value?.value : undefined;
    const inputBad = runtimeMode && Boolean(
      resolvedInputTag?.missingBindingReference
      || resolvedInputTag?.missingIndexedTag
      || !resolvedInputTag?.value
      || resolvedInputTag.value.quality === "Bad",
    );
    const valueInputShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          if (runtimeMode && resolvedInputTag?.missingIndexedTag) {
            if (resolvedInputTag.indexedAddress) {
              void message.warning(`Indexed tag not found: ${resolvedInputTag.indexedAddress}`);
            }
            return;
          }
          if (runtimeMode && !resolvedInputTag?.resolvedName) {
            return;
          }
          onAction?.(
            withActionRoleLevel({
              type: "writeNumberPrompt",
              target: "tag",
              name: runtimeMode ? (resolvedInputTag?.resolvedName ?? resolvedObject.tag) : resolvedObject.tag,
              min: resolvedObject.min,
              max: resolvedObject.max,
              confirm: resolvedObject.confirm,
              confirmText: resolvedObject.confirmText,
            }, resolvedObject.requiredActionRole),
            withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={runtimeDisabled ? "#3d3d3d" : "#141414"}
          stroke={runtimeDisabled ? "#6f6f6f" : "#595959"}
          cornerRadius={4}
          opacity={runtimeDisabled ? 0.7 : 1}
          perfectDrawEnabled={false}
          {...valueInputShadowProps}
        />
        {renderBoxText(`${inputBad ? "BAD" : (value ?? "--")}${resolvedObject.suffix ?? ""}`, resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "state-indicator") {
    const resolvedTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const value = resolvedTag?.value;
    const isBad = runtimeMode && Boolean(resolvedTag?.missingBindingReference || resolvedTag?.missingIndexedTag || !value || value.quality === "Bad");
    const boolValue = runtimeMode ? Boolean(value?.value) : false;
    const fill = isBad ? resolvedObject.badColor : boolValue ? resolvedObject.trueColor : resolvedObject.falseColor;
    const indicatorGradientEnabled = resolvedObject.gradientEnabled ?? false;
    const indicatorGradientDirection = (resolvedObject.gradientDirection ?? "horizontal") as GradientDirection;
    const indicatorGradientProps = resolveFillGradientProps({
      enabled: indicatorGradientEnabled,
      direction: indicatorGradientDirection,
      startColor: resolvedObject.gradientStartColor ?? fill,
      endColor: resolvedObject.gradientEndColor ?? fill,
      baseFill: fill,
      width: resolvedObject.width,
      height: resolvedObject.height,
    });
    const stateIndicatorShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    const text = isBad ? "BAD" : boolValue ? resolvedObject.trueText : resolvedObject.falseText;

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} cornerRadius={8} perfectDrawEnabled={false} {...indicatorGradientProps} {...stateIndicatorShadowProps} />
        {renderBoxText(text, resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
        })}
        <SelectionOutline object={resolvedObject} selected={selected} />
      </Group>
    );
  }

  if (resolvedObject.type === "button") {
    return (
      <ButtonNode
        object={resolvedObject}
        selected={selected}
        groupProps={commonGroupProps}
        project={project}
        libraries={libraries}
        scopedAssets={scopedAssets}
        interactive={interactive}
        onSelectObject={onSelectObject}
        onAction={onAction}
        renderContext={renderContext}
        runtimeDisabled={runtimeDisabled}
        forceFrame={showObjectFrames}
        shadowDisabled={effectiveShadowDisabled}
      />
    );
  }

  if (resolvedObject.type === "switch") {
    const runtimeSwitchTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const switchBad = runtimeMode && Boolean(
      runtimeSwitchTag?.missingBindingReference
      || runtimeSwitchTag?.missingIndexedTag
      || !runtimeSwitchTag?.value
      || runtimeSwitchTag.value.quality === "Bad",
    );
    const isOn = runtimeMode ? Boolean(runtimeSwitchTag?.value?.value) : false;
    const fillColor = switchBad ? "#6f6f6f" : (isOn ? (resolvedObject.onColor ?? "#389e0d") : (resolvedObject.offColor ?? "#434343"));
    const switchBaseFill = runtimeDisabled ? "#4a4a4a" : fillColor;
    const switchGradientProps = resolveFillGradientProps({
      enabled: resolvedObject.gradientEnabled ?? false,
      direction: (resolvedObject.gradientDirection ?? "horizontal") as GradientDirection,
      startColor: resolvedObject.gradientStartColor ?? (resolvedObject.offColor ?? switchBaseFill),
      endColor: resolvedObject.gradientEndColor ?? (resolvedObject.onColor ?? switchBaseFill),
      baseFill: switchBaseFill,
      width: resolvedObject.width,
      height: resolvedObject.height,
    });
    const switchShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          if (runtimeMode && runtimeSwitchTag?.missingIndexedTag) {
            if (runtimeSwitchTag.indexedAddress) {
              void message.warning(`Indexed tag not found: ${runtimeSwitchTag.indexedAddress}`);
            }
            return;
          }
          if (runtimeMode && !runtimeSwitchTag?.resolvedName) {
            return;
          }
          onAction?.(
            withActionRoleLevel({
              type: "write",
              tag: runtimeMode ? (runtimeSwitchTag?.resolvedName ?? resolvedObject.tag) : resolvedObject.tag,
              value: !isOn,
            }, resolvedObject.requiredActionRole),
            withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          {...switchGradientProps}
          stroke={resolvedObject.borderColor}
          strokeWidth={resolvedObject.borderWidth ?? 0}
          cornerRadius={8}
          opacity={runtimeDisabled ? 0.65 : 1}
          perfectDrawEnabled={false}
          {...switchShadowProps}
        />
        {renderBoxText(
          switchBad
            ? "BAD"
            : (isOn ? resolvedObject.onText ?? "ON" : resolvedObject.offText ?? "OFF"),
          resolvedObject.textStyle,
          {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
          },
        )}
        <SelectionOutline object={resolvedObject} selected={selected} />
      </Group>
    );
  }

  if (resolvedObject.type === "valueSelect") {
    const currentValue = runtimeMode ? readValueSelectTargetValue(resolvedObject, project, tags, renderContext) : undefined;
    const currentIndex = runtimeMode
      ? resolvedObject.options.findIndex((item) => String(item.value) === String(currentValue))
      : (resolvedObject.options.length > 0 ? 0 : -1);
    const activeOption = currentIndex >= 0 ? resolvedObject.options[currentIndex] : undefined;
    const displayText = activeOption?.label ?? (currentValue === undefined ? "--" : String(currentValue));
    const valueSelectShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });

    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          const nextOption = getNextValueSelectOption(resolvedObject.options, currentIndex);
          if (!nextOption) {
            return;
          }
          const action = buildValueSelectAction(resolvedObject, nextOption.value, project, tags, renderContext);
          if (!action) {
            return;
          }
          onAction?.(
            withActionRoleLevel(action, resolvedObject.requiredActionRole),
            withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={runtimeDisabled ? "#3d3d3d" : "#1f2a38"}
          stroke={runtimeDisabled ? "#707070" : "#5b6b7c"}
          cornerRadius={6}
          opacity={runtimeDisabled ? 0.65 : 1}
          perfectDrawEnabled={false}
          {...valueSelectShadowProps}
        />
        {renderBoxText(displayText, resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "image") {
    return (
      <ImageNode
        object={resolvedObject}
        groupProps={commonGroupProps}
        selected={selected}
        project={project}
        libraries={libraries}
        scopedAssets={scopedAssets}
        stateValue={runtimeMode && resolvedObject.stateTag
          ? tagValue(resolvedObject.stateTag, { useObjectIndexing: true, fieldName: "stateTag" }).value
          : undefined}
        interactive={interactive}
        onSelectObject={onSelectObject}
        onAction={onAction}
        renderContext={renderContext}
        runtimeDisabled={runtimeDisabled}
        forceFrame={showObjectFrames}
        shadowDisabled={effectiveShadowDisabled}
      />
    );
  }

  if (resolvedObject.type === "stateImage") {
    const resolvedTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const tag = resolvedTag?.value;
    const stateAssetId = runtimeMode ? selectStateImageAssetId(resolvedObject.states, tag?.value) : undefined;
    const isBad = runtimeMode && Boolean(resolvedTag?.missingBindingReference || resolvedTag?.missingIndexedTag || tag?.quality === "Bad");
    const activeAssetId = !runtimeMode
      ? (resolvedObject.defaultAssetId ?? resolvedObject.states[0]?.assetId)
      : isBad
        ? (resolvedObject.badQualityAssetId ?? stateAssetId ?? resolvedObject.defaultAssetId)
        : (stateAssetId ?? resolvedObject.defaultAssetId);
    return (
      <ImageNode
        object={{
          ...resolvedObject,
          type: "image",
          assetId: activeAssetId,
          src: undefined,
          stateImages: undefined,
        }}
        groupProps={commonGroupProps}
        selected={selected}
        project={project}
        libraries={libraries}
        scopedAssets={scopedAssets}
        stateValue={undefined}
        interactive={interactive}
        onSelectObject={onSelectObject}
        onAction={onAction}
        renderContext={renderContext}
        runtimeDisabled={runtimeDisabled}
        forceFrame={showObjectFrames}
        shadowDisabled={effectiveShadowDisabled}
      />
    );
  }

  if (resolvedObject.type === "libraryElementInstance") {
    return (
      <LibraryInstanceNode
        object={resolvedObject}
        selected={selected}
        project={project}
        mode={mode}
        tags={tags}
        libraries={libraries}
        renderContext={renderContext}
        frameStack={frameStack}
        instanceStack={instanceStack}
        interactive={interactive}
        inheritedDisabled={runtimeDisabled}
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onResizeObject={onResizeObject}
        onAction={onAction}
        commonGroupProps={commonGroupProps}
        runtimeDisabled={runtimeDisabled}
        shadowDisabled={effectiveShadowDisabled}
        nodeIdPrefix={nodeIdPrefix}
      />
    );
  }

  if (resolvedObject.type === "numeric-image-indicator") {
    const resolvedTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const runtimeTag = resolvedTag?.value;
    const noTagConfigured = (resolvedObject.tag ?? "").trim() === "";
    const isBad = runtimeMode && Boolean(
      noTagConfigured
      || resolvedTag?.missingBindingReference
      || resolvedTag?.missingIndexedTag
      || !runtimeTag
      || runtimeTag.quality === "Bad"
    );
    const editorFallbackStateAssetId = resolvedObject.states
      .slice()
      .sort((left, right) => left.index - right.index)
      .find((state) => state.assetId)?.assetId;
    const stateAssetId = runtimeMode && !isBad
      ? selectNumericImageIndicatorAssetId(
          resolvedObject.states,
          Number(runtimeTag?.value),
          resolvedObject.outOfRangeMode ?? "default",
        )
      : undefined;
    const activeAssetId = !runtimeMode
      ? (resolvedObject.defaultAssetId ?? editorFallbackStateAssetId)
      : isBad
        ? (resolvedObject.badQualityAssetId ?? resolvedObject.defaultAssetId)
        : (stateAssetId ?? resolvedObject.defaultAssetId);

    return (
      <ImageNode
        object={{
          ...resolvedObject,
          type: "image",
          assetId: activeAssetId,
          src: undefined,
          stateTag: undefined,
          stateImages: undefined,
        }}
        groupProps={commonGroupProps}
        selected={selected}
        project={project}
        libraries={libraries}
        scopedAssets={scopedAssets}
        stateValue={undefined}
        interactive={interactive}
        onSelectObject={onSelectObject}
        onAction={onAction}
        renderContext={renderContext}
        runtimeDisabled={runtimeDisabled}
        forceFrame={showObjectFrames}
        shadowDisabled={effectiveShadowDisabled}
      />
    );
  }

  if (resolvedObject.type === "valve") {
    const open = runtimeMode ? Boolean(tagValue(resolvedObject.openTag, { useObjectIndexing: true, fieldName: "openTag" }).value?.value) : false;
    const closed = runtimeMode ? Boolean(tagValue(resolvedObject.closedTag, { useObjectIndexing: true, fieldName: "closedTag" }).value?.value) : false;
    const fault = runtimeMode ? Boolean(tagValue(resolvedObject.errorTag, { useObjectIndexing: true, fieldName: "errorTag" }).value?.value) : false;
    const color = fault ? "#d9363e" : open ? "#73d13d" : closed ? "#1677ff" : "#faad14";
    const valveShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill="#141414" stroke="#595959" cornerRadius={8} perfectDrawEnabled={false} {...valveShadowProps} />
        <Line points={[20, 20, resolvedObject.width - 20, resolvedObject.height - 20]} stroke={color} strokeWidth={6} />
        <Line points={[resolvedObject.width - 20, 20, 20, resolvedObject.height - 20]} stroke={color} strokeWidth={6} />
        {renderBoxText(resolvedObject.label ?? "Valve", resolvedObject.textStyle, { width: resolvedObject.width, height: resolvedObject.height })}
        <SelectionOutline object={resolvedObject} selected={selected} />
      </Group>
    );
  }

  if (resolvedObject.type === "pump") {
    const run = runtimeMode ? Boolean(tagValue(resolvedObject.runTag, { useObjectIndexing: true, fieldName: "runTag" }).value?.value) : false;
    const fault = runtimeMode ? Boolean(tagValue(resolvedObject.faultTag, { useObjectIndexing: true, fieldName: "faultTag" }).value?.value) : false;
    const color = fault ? "#ff4d4f" : run ? "#52c41a" : "#8c8c8c";
    const pumpShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill="#141414" stroke="#595959" cornerRadius={8} perfectDrawEnabled={false} {...pumpShadowProps} />
        <Circle x={resolvedObject.width * 0.35} y={resolvedObject.height * 0.45} radius={Math.min(resolvedObject.width, resolvedObject.height) * 0.2} fill={color} />
        <Line
          points={[
            resolvedObject.width * 0.55,
            resolvedObject.height * 0.45,
            resolvedObject.width * 0.85,
            resolvedObject.height * 0.45,
          ]}
          stroke={color}
          strokeWidth={8}
          lineCap="round"
        />
        {renderBoxText(resolvedObject.label ?? "Pump", resolvedObject.textStyle, { width: resolvedObject.width, height: resolvedObject.height })}
        <SelectionOutline object={resolvedObject} selected={selected} />
      </Group>
    );
  }

  if (resolvedObject.type === "frame") {
    return (
      <FrameNode
        object={resolvedObject}
        selected={selected}
        project={project}
        mode={mode}
        tags={tags}
        libraries={libraries}
        renderContext={renderContext}
        frameStack={frameStack}
        instanceStack={instanceStack}
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onResizeObject={onResizeObject}
        onAction={onAction}
        commonGroupProps={commonGroupProps}
        scopedAssets={scopedAssets}
        inheritedDisabled={runtimeDisabled}
        shadowDisabled={effectiveShadowDisabled}
        nodeIdPrefix={nodeIdPrefix}
      />
    );
  }

  if (resolvedObject.type === "checkbox") {
    const checkboxTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const checkboxBad = runtimeMode && Boolean(
      checkboxTag?.missingBindingReference
      || checkboxTag?.missingIndexedTag
      || (resolvedObject.tag?.trim() && !checkboxTag?.value)
    );
    const isChecked = runtimeMode && !checkboxBad ? Boolean(checkboxTag?.value?.value) : false;
    const fillColor = isChecked ? (resolvedObject.checkedColor ?? HMI_CONTROL_COLORS.accentDark) : (resolvedObject.uncheckedColor ?? HMI_CONTROL_COLORS.track);
    const displayText = checkboxBad ? "BAD" : (isChecked ? (resolvedObject.checkedText ?? "On") : (resolvedObject.uncheckedText ?? "Off"));
    const checkBoxSize = Math.min(16, Math.max(12, resolvedObject.height * 0.55));
    const checkY = (resolvedObject.height - checkBoxSize) / 2;
    const checkX = 2;
    const labelPadding = checkX + checkBoxSize + 6;
    const checkboxShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          const writeTagField = runtimeMode
            ? (resolvedObject.writeTag?.trim() || resolvedObject.tag)
            : resolvedObject.tag;
          const resolvedWriteTag = runtimeMode
            ? tagValue(writeTagField, { useObjectIndexing: true, fieldName: "writeTag" })
            : undefined;
          if (runtimeMode && resolvedWriteTag?.missingIndexedTag) {
            if (resolvedWriteTag.indexedAddress) {
              void message.warning(`Indexed tag not found: ${resolvedWriteTag.indexedAddress}`);
            }
            return;
          }
          const tagName = runtimeMode
            ? (resolvedWriteTag?.resolvedName ?? writeTagField)
            : writeTagField;
          if (runtimeMode && !tagName?.trim()) {
            return;
          }
          const normalizedTagName = tagName?.trim() ?? "";
          if (!normalizedTagName) {
            return;
          }
          const writeMode = resolvedObject.writeMode ?? "toggleState";
          const pulseDurationMs = Math.max(1, Math.floor(Number(resolvedObject.pulseDurationMs ?? 300) || 300));
          let action: RuntimeAction;
          if (writeMode === "writeTrue") {
            action = {
              type: "write",
              tag: normalizedTagName,
              value: true,
            };
          } else if (writeMode === "writeFalse") {
            action = {
              type: "write",
              tag: normalizedTagName,
              value: false,
            };
          } else if (writeMode === "pulseTrue") {
            action = {
              type: "pulse",
              tag: normalizedTagName,
              value: true,
              durationMs: pulseDurationMs,
            };
          } else if (writeMode === "pulseFalse") {
            action = {
              type: "pulse",
              tag: normalizedTagName,
              value: false,
              durationMs: pulseDurationMs,
            };
          } else {
            action = {
              type: "write",
              tag: normalizedTagName,
              value: !isChecked,
            };
          }
          onAction?.(
            withActionRoleLevel(action, resolvedObject.requiredActionRole),
            withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          x={checkX}
          y={checkY}
          width={checkBoxSize}
          height={checkBoxSize}
          fill={isChecked ? (runtimeDisabled ? HMI_CONTROL_COLORS.disabled : fillColor) : HMI_CONTROL_COLORS.track}
          stroke={runtimeDisabled ? HMI_CONTROL_COLORS.disabled : isChecked ? fillColor : HMI_CONTROL_COLORS.border}
          strokeWidth={1.5}
          cornerRadius={3}
          perfectDrawEnabled={false}
          {...checkboxShadowProps}
        />
        {isChecked ? (
          <>
            <Line
              points={[
                checkX + checkBoxSize * 0.22,
                checkY + checkBoxSize * 0.55,
                checkX + checkBoxSize * 0.45,
                checkY + checkBoxSize * 0.78,
              ]}
              stroke={runtimeDisabled ? HMI_CONTROL_COLORS.disabled : HMI_CONTROL_COLORS.textStrong}
              strokeWidth={2}
              lineCap="round"
            />
            <Line
              points={[
                checkX + checkBoxSize * 0.45,
                checkY + checkBoxSize * 0.78,
                checkX + checkBoxSize * 0.82,
                checkY + checkBoxSize * 0.22,
              ]}
              stroke={runtimeDisabled ? HMI_CONTROL_COLORS.disabled : HMI_CONTROL_COLORS.textStrong}
              strokeWidth={2}
              lineCap="round"
            />
          </>
        ) : null}
        {renderBoxText(resolvedObject.label ?? displayText, {
          fontFamily: "Arial",
          fontSize: Math.max(11, resolvedObject.height * 0.42),
          color: runtimeDisabled ? "#8c8c8c" : HMI_CONTROL_COLORS.text,
          horizontalAlign: "left",
          verticalAlign: "middle",
          padding: labelPadding,
        }, {
          width: resolvedObject.width,
          height: resolvedObject.height,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "progress-bar") {
    const progressTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const progressBad = runtimeMode && Boolean(
      progressTag?.missingBindingReference
      || progressTag?.missingIndexedTag
      || (resolvedObject.tag?.trim() && (!progressTag?.value || progressTag.value.quality === "Bad"))
    );
    const rawValue = runtimeMode ? Number(progressTag?.value?.value ?? 0) : 0;
    const minVal = resolvedObject.min ?? 0;
    const maxVal = resolvedObject.max ?? 100;
    const clampedValue = Number.isFinite(rawValue) ? Math.min(maxVal, Math.max(minVal, rawValue)) : minVal;
    const ratio = maxVal > minVal ? (clampedValue - minVal) / (maxVal - minVal) : 0;
    const showValue = resolvedObject.showValue ?? true;
    const showPercent = resolvedObject.showPercent ?? false;
    const decimals = Math.max(0, Math.min(10, resolvedObject.decimals ?? 1));
    const baseFillColor = resolvedObject.fillColor ?? HMI_CONTROL_COLORS.accentDark;
    const warningColor = resolvedObject.warningColor ?? "#d7ba7d";
    const warningMin = resolvedObject.warningMin;
    const warningMax = resolvedObject.warningMax;
    const hasWarningRange = Number.isFinite(warningMin) && Number.isFinite(warningMax);
    const inWarningRange = hasWarningRange
      ? clampedValue >= Number(warningMin) && clampedValue <= Number(warningMax)
      : false;
    const badBackgroundColor = resolvedObject.badBackgroundColor ?? "#2b1a1a";
    const badBorderColor = resolvedObject.badBorderColor ?? (resolvedObject.alarmColor ?? "#d9363e");
    const badTextColor = resolvedObject.badTextColor ?? HMI_CONTROL_COLORS.bad;
    const disabledBackgroundColor = resolvedObject.disabledBackgroundColor ?? HMI_CONTROL_COLORS.fieldDisabledBg;
    const disabledTextColor = resolvedObject.disabledTextColor ?? "#8c8c8c";
    const backgroundColor = resolvedObject.backgroundColor ?? HMI_CONTROL_COLORS.fieldBg;
    const borderColor = resolvedObject.borderColor ?? HMI_CONTROL_COLORS.border;
    const borderWidth = Math.max(0, resolvedObject.borderWidth ?? 1);
    const cornerRadius = Math.max(0, resolvedObject.cornerRadius ?? 4);
    const trackColor = resolvedObject.trackColor ?? HMI_CONTROL_COLORS.track;
    const padding = Math.max(0, resolvedObject.padding ?? 2);
    const fillDirection = resolvedObject.fillDirection
      ?? (resolvedObject.orientation === "vertical" ? "bottom-to-top" : "left-to-right");
    const fillColor = progressBad
      ? (resolvedObject.alarmColor ?? "#d9363e")
      : (inWarningRange ? warningColor : baseFillColor);
    const renderBackground = runtimeDisabled
      ? disabledBackgroundColor
      : (progressBad ? badBackgroundColor : backgroundColor);
    const renderBorder = progressBad ? badBorderColor : borderColor;
    const renderText = runtimeDisabled
      ? disabledTextColor
      : (progressBad ? badTextColor : (resolvedObject.textColor ?? HMI_CONTROL_COLORS.textStrong));
    const renderFill = runtimeDisabled ? disabledTextColor : fillColor;
    const formattedValue = formatNumericValue(clampedValue, {
      formatMode: "decimals",
      decimals,
      unit: resolvedObject.unit,
      showUnit: resolvedObject.showUnit ?? false,
    });
    const percentText = `${(ratio * 100).toFixed(decimals)}%`;
    const textParts: string[] = [];
    if (showValue) {
      textParts.push(progressBad ? "BAD" : formattedValue);
    }
    if (showPercent) {
      textParts.push(percentText);
    }
    const valueText = textParts.join(" ");
    const innerX = padding;
    const innerY = padding;
    const innerW = Math.max(0, resolvedObject.width - padding * 2);
    const innerH = Math.max(0, resolvedObject.height - padding * 2);
    const fillW = innerW * ratio;
    const fillH = innerH * ratio;
    const fillCorner = Math.max(0, cornerRadius - padding);
    const fillRect = (() => {
      if (fillDirection === "right-to-left") {
        return { x: innerX + (innerW - fillW), y: innerY, width: fillW, height: innerH };
      }
      if (fillDirection === "bottom-to-top") {
        return { x: innerX, y: innerY + (innerH - fillH), width: innerW, height: fillH };
      }
      if (fillDirection === "top-to-bottom") {
        return { x: innerX, y: innerY, width: innerW, height: fillH };
      }
      return { x: innerX, y: innerY, width: fillW, height: innerH };
    })();
    const progressBarShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={renderBackground}
          stroke={renderBorder}
          strokeWidth={borderWidth}
          cornerRadius={cornerRadius}
          perfectDrawEnabled={false}
          {...progressBarShadowProps}
        />
        <Rect
          x={innerX}
          y={innerY}
          width={innerW}
          height={innerH}
          fill={trackColor}
          cornerRadius={fillCorner}
        />
        <Rect
          x={fillRect.x}
          y={fillRect.y}
          width={Math.max(0, fillRect.width)}
          height={Math.max(0, fillRect.height)}
          fill={renderFill}
          cornerRadius={fillCorner}
        />
        {valueText ? (
          renderBoxText(valueText, {
            fontFamily: resolvedObject.fontFamily ?? "Consolas",
            fontSize: Math.max(8, resolvedObject.fontSize ?? Math.max(10, resolvedObject.height * 0.35)),
            color: renderText,
            horizontalAlign: "center",
            verticalAlign: "middle",
          }, {
            width: resolvedObject.width,
            height: resolvedObject.height,
          })
        ) : null}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "slider") {
    const sliderTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const sliderBad = runtimeMode && Boolean(
      sliderTag?.missingBindingReference
      || sliderTag?.missingIndexedTag
      || (resolvedObject.tag?.trim() && (!sliderTag?.value || sliderTag.value.quality === "Bad"))
    );
    const rawSliderValue = runtimeMode ? Number(sliderTag?.value?.value ?? 0) : 0;
    const sliderMin = resolvedObject.min ?? 0;
    const sliderMax = resolvedObject.max ?? 100;
    const sliderValue = Number.isFinite(rawSliderValue) ? Math.min(sliderMax, Math.max(sliderMin, rawSliderValue)) : sliderMin;
    const isSliderVertical = resolvedObject.orientation === "vertical";
    const decimals = Math.max(0, Math.min(10, resolvedObject.decimals ?? 1));
    const sliderTrackColor = resolvedObject.trackColor ?? HMI_CONTROL_COLORS.track;
    const sliderFillColor = resolvedObject.fillColor ?? HMI_CONTROL_COLORS.accentDark;
    const sliderThumbColor = resolvedObject.thumbColor ?? HMI_CONTROL_COLORS.thumb;
    const sliderBadColor = resolvedObject.badColor ?? "#a03030";
    const sliderBadTextColor = resolvedObject.badTextColor ?? HMI_CONTROL_COLORS.bad;
    const sliderDisabledColor = resolvedObject.disabledColor ?? HMI_CONTROL_COLORS.disabled;
    const sliderDisabledTextColor = resolvedObject.disabledTextColor ?? "#8c8c8c";
    const sliderBackgroundColor = resolvedObject.backgroundColor ?? HMI_CONTROL_COLORS.fieldBg;
    const sliderTransparentBackground = resolvedObject.transparentBackground ?? false;
    const sliderBorderColor = resolvedObject.borderColor ?? HMI_CONTROL_COLORS.border;
    const sliderBorderWidth = Math.max(0, resolvedObject.borderWidth ?? 1);
    const sliderCornerRadius = Math.max(0, resolvedObject.cornerRadius ?? 4);
    const sliderTrackThickness = Math.max(1, resolvedObject.trackThickness ?? 4);
    const sliderThumbRadius = Math.max(2, resolvedObject.thumbRadius ?? Math.min(7, resolvedObject.width * 0.04, resolvedObject.height * 0.16));
    const sliderThumbBorderColor = resolvedObject.thumbBorderColor ?? sliderBorderColor;
    const sliderTextColor = resolvedObject.textColor ?? HMI_CONTROL_COLORS.text;
    const sliderFontFamily = resolvedObject.fontFamily ?? "Consolas";
    const sliderFontSize = Math.max(8, resolvedObject.fontSize ?? Math.max(9, resolvedObject.height * 0.3));
    const sliderShowValue = resolvedObject.showValue ?? true;
    const sliderShowMinMax = resolvedObject.showMinMax ?? false;
    const sliderMinMaxFontSize = Math.max(6, resolvedObject.minMaxFontSize ?? Math.max(8, sliderFontSize - 2));
    const sliderMinLabelOffset = Math.max(0, resolvedObject.minLabelOffset ?? 2);
    const sliderMaxLabelOffset = Math.max(0, resolvedObject.maxLabelOffset ?? 2);
    const sliderWriteOnRelease = resolvedObject.writeOnRelease ?? false;
    const sliderDragWriteIntervalMs = Math.max(0, Math.min(1000, resolvedObject.dragWriteIntervalMs ?? 50));
    const sliderReleaseSyncHoldMs = Math.max(0, Math.min(10000, resolvedObject.releaseSyncHoldMs ?? 2500));
    const sliderValuePosition = resolvedObject.valuePosition ?? "bottom";
    const sliderDragRef = useRef(false);
    const [sliderDragValue, setSliderDragValue] = useState<number | null>(null);
    const sliderReleaseAtRef = useRef<number | null>(null);
    const sliderReleaseSourceValueRef = useRef<number | null>(null);
    const lastWrittenValueRef = useRef<number | null>(null);
    const lastWriteAtRef = useRef(0);
    const sliderLastFractionRef = useRef(0);
    const renderTrackColor = runtimeDisabled ? sliderDisabledColor : sliderTrackColor;
    const renderFillColor = runtimeDisabled
      ? sliderDisabledColor
      : (sliderBad ? sliderBadColor : sliderFillColor);
    const renderThumbColor = runtimeDisabled
      ? sliderDisabledColor
      : (sliderBad ? sliderBadColor : sliderThumbColor);
    const renderTextColor = runtimeDisabled
      ? sliderDisabledTextColor
      : (sliderBad ? sliderBadTextColor : sliderTextColor);
    const renderBackgroundColor = sliderTransparentBackground
      ? "transparent"
      : (runtimeDisabled ? sliderDisabledColor : sliderBackgroundColor);
    const renderBorderColor = sliderBad ? sliderBadColor : sliderBorderColor;

    const getSliderFraction = useCallback((pointerX: number, pointerY: number): number => {
      if (isSliderVertical) {
        const start = sliderThumbRadius;
        const end = Math.max(start + 1, resolvedObject.height - sliderThumbRadius);
        const clampedY = Math.max(start, Math.min(end, pointerY));
        return 1 - ((clampedY - start) / Math.max(1, end - start));
      }
      const start = sliderThumbRadius;
      const end = Math.max(start + 1, resolvedObject.width - sliderThumbRadius);
      const clampedX = Math.max(start, Math.min(end, pointerX));
      return (clampedX - start) / Math.max(1, end - start);
    }, [isSliderVertical, resolvedObject.height, resolvedObject.width, sliderThumbRadius]);

    const commitSliderValue = useCallback((fraction: number, force = false, allowWrite = true) => {
      const val = sliderMin + fraction * (sliderMax - sliderMin);
      const step = resolvedObject.step ?? 1;
      const stepped = step > 0 ? Math.round(val / step) * step : val;
      const clamped = Math.min(sliderMax, Math.max(sliderMin, stepped));
      setSliderDragValue(clamped);
      if (!allowWrite) {
        return;
      }
      if (lastWrittenValueRef.current !== null && Math.abs(lastWrittenValueRef.current - clamped) < 1e-9) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastWriteAtRef.current < sliderDragWriteIntervalMs) {
        return;
      }
      lastWrittenValueRef.current = clamped;
      lastWriteAtRef.current = now;
      const writeTagField = runtimeMode
        ? (resolvedObject.writeTag?.trim() || resolvedObject.tag)
        : resolvedObject.tag;
      const resolvedWriteTag = runtimeMode
        ? tagValue(writeTagField, { useObjectIndexing: true, fieldName: "writeTag" })
        : undefined;
      const tagName = runtimeMode
        ? (resolvedWriteTag?.resolvedName ?? writeTagField)
        : writeTagField;
      if (runtimeMode && !tagName?.trim()) {
        return;
      }
      onAction?.(
        withActionRoleLevel({
          type: "write",
          tag: tagName ?? "",
          value: clamped,
        }, resolvedObject.requiredActionRole),
        (() => {
          const nextContext = withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name);
          return {
            ...nextContext,
            parameters: {
              ...(nextContext.parameters ?? {}),
              __allowConcurrentWrite: true,
            },
          };
        })(),
      );
    }, [resolvedObject, sliderMin, sliderMax, runtimeMode, onAction, renderContext, sliderDragWriteIntervalMs]);

    const finalizeSliderDrag = useCallback((allowWrite = true) => {
      sliderDragRef.current = false;
      const fraction = Math.max(0, Math.min(1, sliderLastFractionRef.current));
      commitSliderValue(fraction, true, allowWrite);
      sliderReleaseAtRef.current = Date.now();
      sliderReleaseSourceValueRef.current = sliderValue;
    }, [commitSliderValue, sliderValue]);

    useEffect(() => {
      if (sliderDragRef.current) {
        return;
      }
      const fraction = sliderMax > sliderMin ? (sliderValue - sliderMin) / (sliderMax - sliderMin) : 0;
      sliderLastFractionRef.current = Math.max(0, Math.min(1, fraction));
    }, [sliderMax, sliderMin, sliderValue]);

    useEffect(() => {
      if (interactive || runtimeDisabled) {
        return;
      }
      const handleMouseUp = () => {
        if (!sliderDragRef.current) {
          return;
        }
        finalizeSliderDrag(true);
      };
      const handleWindowBlur = () => {
        if (!sliderDragRef.current) {
          return;
        }
        finalizeSliderDrag(true);
      };
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleWindowBlur);
      return () => {
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("blur", handleWindowBlur);
      };
    }, [finalizeSliderDrag, interactive, runtimeDisabled]);

    useEffect(() => {
      if (sliderDragRef.current || sliderDragValue === null) {
        return;
      }
      const step = Math.max(0, resolvedObject.step ?? 1);
      const tolerance = Math.max(1e-6, step > 0 ? step * 0.25 : 0.0005);
      const sourceValue = sliderReleaseSourceValueRef.current;
      if (Math.abs(sliderValue - sliderDragValue) <= tolerance) {
        setSliderDragValue(null);
        sliderReleaseAtRef.current = null;
        sliderReleaseSourceValueRef.current = null;
        return;
      }
      if (sourceValue !== null && Math.abs(sliderValue - sourceValue) > tolerance) {
        setSliderDragValue(null);
        sliderReleaseAtRef.current = null;
        sliderReleaseSourceValueRef.current = null;
        return;
      }
      if (sliderReleaseSyncHoldMs <= 0) {
        setSliderDragValue(null);
        sliderReleaseAtRef.current = null;
        sliderReleaseSourceValueRef.current = null;
        return;
      }
      const now = Date.now();
      const releasedAt = sliderReleaseAtRef.current ?? now;
      const elapsed = now - releasedAt;
      const remaining = Math.max(0, sliderReleaseSyncHoldMs - elapsed);
      const timer = window.setTimeout(() => {
        setSliderDragValue(null);
        sliderReleaseAtRef.current = null;
        sliderReleaseSourceValueRef.current = null;
      }, remaining);
      return () => window.clearTimeout(timer);
    }, [resolvedObject.step, sliderDragValue, sliderValue, sliderReleaseSyncHoldMs]);

    const sliderRenderValue = sliderDragValue !== null ? sliderDragValue : sliderValue;
    const sliderRenderRatio = sliderMax > sliderMin ? (sliderRenderValue - sliderMin) / (sliderMax - sliderMin) : 0;

    const sliderValueText = sliderShowValue
      ? (sliderBad
        ? "BAD"
        : formatNumericValue(sliderRenderValue, {
            formatMode: "decimals",
            decimals,
            unit: resolvedObject.unit,
            showUnit: Boolean(resolvedObject.unit),
          }))
      : "";
    const sliderShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    const sliderMinText = formatNumericValue(sliderMin, {
      formatMode: "decimals",
      decimals,
      unit: resolvedObject.unit,
      showUnit: false,
    });
    const sliderMaxText = formatNumericValue(sliderMax, {
      formatMode: "decimals",
      decimals,
      unit: resolvedObject.unit,
      showUnit: false,
    });
    const valueAlign = (() => {
      if (sliderValuePosition === "top") {
        return { horizontalAlign: "center" as const, verticalAlign: "top" as const, padding: 2 };
      }
      if (sliderValuePosition === "bottom") {
        return { horizontalAlign: "center" as const, verticalAlign: "bottom" as const, padding: 2 };
      }
      if (sliderValuePosition === "left") {
        return { horizontalAlign: "left" as const, verticalAlign: "middle" as const, padding: 4 };
      }
      if (sliderValuePosition === "right") {
        return { horizontalAlign: "right" as const, verticalAlign: "middle" as const, padding: 4 };
      }
      return { horizontalAlign: "center" as const, verticalAlign: "middle" as const, padding: 2 };
    })();

    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          const groupNode = evt.currentTarget;
          const pointer = groupNode.getRelativePointerPosition();
          if (pointer) {
            const fraction = getSliderFraction(pointer.x, pointer.y);
            commitSliderValue(fraction);
          }
        }}
        onMouseDown={(evt: KonvaEventObject<MouseEvent>) => {
          if (interactive || runtimeDisabled) {
            return;
          }
          triggerObjectMacroEvent("press");
          sliderDragRef.current = true;
          sliderReleaseAtRef.current = null;
          sliderReleaseSourceValueRef.current = null;
          const groupNode = evt.currentTarget;
          const pointer = groupNode.getRelativePointerPosition();
          if (pointer) {
            const fraction = getSliderFraction(pointer.x, pointer.y);
            sliderLastFractionRef.current = fraction;
            commitSliderValue(fraction, true, !sliderWriteOnRelease);
          }
        }}
        onMouseMove={(evt: KonvaEventObject<MouseEvent>) => {
          if (interactive || runtimeDisabled || !sliderDragRef.current) {
            return;
          }
          const groupNode = evt.currentTarget;
          const pointer = groupNode.getRelativePointerPosition();
          if (pointer) {
            const fraction = getSliderFraction(pointer.x, pointer.y);
            sliderLastFractionRef.current = fraction;
            commitSliderValue(fraction, false, !sliderWriteOnRelease);
          }
        }}
        onMouseUp={(evt: KonvaEventObject<MouseEvent>) => {
          if (interactive || runtimeDisabled) {
            sliderDragRef.current = false;
            setSliderDragValue(null);
            sliderReleaseAtRef.current = null;
            sliderReleaseSourceValueRef.current = null;
            return;
          }
          triggerObjectMacroEvent("release");
          const groupNode = evt.currentTarget;
          const pointer = groupNode.getRelativePointerPosition();
          if (pointer) {
            const fraction = getSliderFraction(pointer.x, pointer.y);
            sliderLastFractionRef.current = fraction;
          }
          finalizeSliderDrag(true);
        }}
        onMouseLeave={() => {
          if (interactive || runtimeDisabled) {
            sliderDragRef.current = false;
            setSliderDragValue(null);
            sliderReleaseAtRef.current = null;
            sliderReleaseSourceValueRef.current = null;
            return;
          }
          if (sliderDragRef.current) {
            finalizeSliderDrag(true);
          }
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={renderBackgroundColor}
          stroke={renderBorderColor}
          strokeWidth={sliderBorderWidth}
          cornerRadius={sliderCornerRadius}
          opacity={runtimeDisabled ? 0.7 : 1}
          perfectDrawEnabled={false}
          {...sliderShadowProps}
        />
        {isSliderVertical ? (
          <>
            <Rect
              x={resolvedObject.width * 0.5 - sliderTrackThickness / 2}
              y={sliderThumbRadius}
              width={sliderTrackThickness}
              height={Math.max(0, resolvedObject.height - sliderThumbRadius * 2)}
              fill={renderTrackColor}
              cornerRadius={sliderTrackThickness / 2}
            />
            <Rect
              x={resolvedObject.width * 0.5 - sliderTrackThickness / 2}
              y={sliderThumbRadius + resolvedObject.height * (1 - sliderRenderRatio) - sliderThumbRadius * 2 * (1 - sliderRenderRatio)}
              width={sliderTrackThickness}
              height={Math.max(0, (resolvedObject.height - sliderThumbRadius * 2) * sliderRenderRatio)}
              fill={renderFillColor}
              cornerRadius={sliderTrackThickness / 2}
            />
            <Circle
              x={resolvedObject.width * 0.5}
              y={resolvedObject.height - sliderThumbRadius - (resolvedObject.height - sliderThumbRadius * 2) * sliderRenderRatio}
              radius={sliderThumbRadius}
              fill={renderThumbColor}
              stroke={sliderThumbBorderColor}
              strokeWidth={1}
              perfectDrawEnabled={false}
              {...sliderShadowProps}
            />
          </>
        ) : (
          <>
            <Rect
              x={sliderThumbRadius}
              y={resolvedObject.height * 0.5 - sliderTrackThickness / 2}
              width={Math.max(0, resolvedObject.width - sliderThumbRadius * 2)}
              height={sliderTrackThickness}
              fill={renderTrackColor}
              cornerRadius={sliderTrackThickness / 2}
            />
            <Rect
              x={sliderThumbRadius}
              y={resolvedObject.height * 0.5 - sliderTrackThickness / 2}
              width={Math.max(0, (resolvedObject.width - sliderThumbRadius * 2) * sliderRenderRatio)}
              height={sliderTrackThickness}
              fill={renderFillColor}
              cornerRadius={sliderTrackThickness / 2}
            />
            <Circle
              x={sliderThumbRadius + (resolvedObject.width - sliderThumbRadius * 2) * sliderRenderRatio}
              y={resolvedObject.height * 0.5}
              radius={sliderThumbRadius}
              fill={renderThumbColor}
              stroke={sliderThumbBorderColor}
              strokeWidth={1}
              perfectDrawEnabled={false}
              {...sliderShadowProps}
            />
          </>
        )}
        {sliderShowMinMax ? (
          <>
            {renderBoxText(sliderMinText, {
              fontFamily: sliderFontFamily,
              fontSize: sliderMinMaxFontSize,
              color: renderTextColor,
              horizontalAlign: isSliderVertical ? "center" : "left",
              verticalAlign: isSliderVertical ? "bottom" : "middle",
              padding: sliderMinLabelOffset,
            }, {
              width: resolvedObject.width,
              height: resolvedObject.height,
            })}
            {renderBoxText(sliderMaxText, {
              fontFamily: sliderFontFamily,
              fontSize: sliderMinMaxFontSize,
              color: renderTextColor,
              horizontalAlign: isSliderVertical ? "center" : "right",
              verticalAlign: isSliderVertical ? "top" : "middle",
              padding: sliderMaxLabelOffset,
            }, {
              width: resolvedObject.width,
              height: resolvedObject.height,
            })}
          </>
        ) : null}
        {sliderValueText && sliderValuePosition !== "hidden" ? (
          renderBoxText(sliderValueText, {
            fontFamily: sliderFontFamily,
            fontSize: sliderFontSize,
            color: renderTextColor,
            horizontalAlign: valueAlign.horizontalAlign,
            verticalAlign: valueAlign.verticalAlign,
            padding: valueAlign.padding,
          }, {
            width: resolvedObject.width,
            height: resolvedObject.height,
          })
        ) : null}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "select") {
    const selectTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const selectBad = runtimeMode && Boolean(
      selectTag?.missingBindingReference
      || selectTag?.missingIndexedTag
      || (resolvedObject.tag?.trim() && (!selectTag?.value || selectTag.value.quality === "Bad"))
    );
    const currentValue = runtimeMode ? selectTag?.value?.value : undefined;
    const options = resolvedObject.options ?? [];
    const selectedOption = runtimeMode && currentValue !== undefined
      ? options.find((opt) => String(opt.value) === String(currentValue))
      : undefined;
    const displayText = selectBad ? "BAD" : (selectedOption?.label ?? resolvedObject.placeholder ?? "--");
    const isPlaceholder = !selectBad && !selectedOption;
    const selectBackgroundColor = resolvedObject.backgroundColor ?? HMI_CONTROL_COLORS.fieldBg;
    const selectBorderColor = resolvedObject.borderColor ?? HMI_CONTROL_COLORS.border;
    const selectBorderWidth = Math.max(0, resolvedObject.borderWidth ?? 1);
    const selectCornerRadius = Math.max(0, resolvedObject.cornerRadius ?? 4);
    const selectTextColor = resolvedObject.textColor ?? HMI_CONTROL_COLORS.text;
    const selectPlaceholderColor = resolvedObject.placeholderColor ?? "#8c8c8c";
    const selectPadding = Math.max(0, resolvedObject.padding ?? 8);
    const selectArrowColor = resolvedObject.arrowColor ?? HMI_CONTROL_COLORS.text;
    const selectFontFamily = resolvedObject.fontFamily ?? "Consolas";
    const selectFontSize = Math.max(8, resolvedObject.fontSize ?? Math.max(11, resolvedObject.height * 0.42));
    const selectDropdownBackground = resolvedObject.dropdownBackgroundColor ?? HMI_CONTROL_COLORS.overlayBg;
    const selectDropdownBorder = resolvedObject.dropdownBorderColor ?? HMI_CONTROL_COLORS.border;
    const selectOptionTextColor = resolvedObject.optionTextColor ?? HMI_CONTROL_COLORS.text;
    const selectOptionHoverColor = resolvedObject.optionHoverColor ?? "#2a2d2e";
    const selectOptionSelectedColor = resolvedObject.optionSelectedColor ?? "rgba(14, 99, 156, 0.3)";
    const selectOptionSelectedText = resolvedObject.optionSelectedTextColor ?? "#69c0ff";
    const selectDropdownMaxHeight = Math.max(60, resolvedObject.dropdownMaxHeight ?? 200);
    const selectDropdownOffsetY = Math.max(-8, Math.min(24, resolvedObject.dropdownOffsetY ?? 2));
    const selectOptionHeight = Math.max(20, resolvedObject.optionHeight ?? 28);
    const selectArrowAreaWidth = Math.max(14, Math.min(resolvedObject.width * 0.45, resolvedObject.arrowAreaWidth ?? 24));
    const selectBadTextColor = resolvedObject.badTextColor ?? HMI_CONTROL_COLORS.bad;
    const selectBadBackgroundColor = resolvedObject.badBackgroundColor ?? "#2b1a1a";
    const selectBadBorderColor = resolvedObject.badBorderColor ?? "#a03030";
    const selectDisabledBackgroundColor = resolvedObject.disabledBackgroundColor ?? HMI_CONTROL_COLORS.fieldDisabledBg;
    const selectDisabledTextColor = resolvedObject.disabledTextColor ?? "#8c8c8c";
    const isSelectDropdownOpen = overlayState?.objectId === resolvedObject.id;
    const renderBackground = runtimeDisabled
      ? selectDisabledBackgroundColor
      : (selectBad ? selectBadBackgroundColor : selectBackgroundColor);
    const renderBorder = runtimeDisabled
      ? (resolvedObject.borderColor ?? HMI_CONTROL_COLORS.disabled)
      : (selectBad ? selectBadBorderColor : selectBorderColor);
    const renderTextColor = runtimeDisabled
      ? selectDisabledTextColor
      : (selectBad ? selectBadTextColor : (isPlaceholder ? selectPlaceholderColor : selectTextColor));
    const renderArrowColor = runtimeDisabled ? selectDisabledTextColor : (selectBad ? selectBadTextColor : selectArrowColor);
    const selectShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });

    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          const groupNode = evt.currentTarget;
          const pointer = groupNode.getRelativePointerPosition();
          if (!pointer) {
            return;
          }
          const arrowAreaStartX = Math.max(0, resolvedObject.width - selectArrowAreaWidth);
          const clickedArrowArea = pointer.x >= arrowAreaStartX && pointer.x <= resolvedObject.width && pointer.y >= 0 && pointer.y <= resolvedObject.height;
          if (!clickedArrowArea) {
            return;
          }
          if (resolvedObject.requiredActionRole) {
            const hasAccess = hasRoleAccess(renderContext.userRoleLevel, resolvedObject.requiredActionRole);
            if (!hasAccess) {
              return;
            }
          }
          const stage = groupNode.getStage();
          if (!stage) {
            return;
          }
          const container = stage?.container();
          const canvasWrap = container?.closest(".canvas-wrap") as HTMLElement | null;
          if (!container || !canvasWrap) {
            return;
          }
          const containerRect = container.getBoundingClientRect();
          const wrapRect = canvasWrap.getBoundingClientRect();
          const absPos = groupNode.getAbsolutePosition(stage);
          const scaleX = stage?.scaleX() ?? 1;
          const scaleY = stage?.scaleY() ?? 1;
          const overlayX = (containerRect.left - wrapRect.left) + canvasWrap.scrollLeft + absPos.x * scaleX;
          const overlayY = (containerRect.top - wrapRect.top) + canvasWrap.scrollTop + (absPos.y + resolvedObject.height + selectDropdownOffsetY) * scaleY;
          if (isSelectDropdownOpen) {
            onHideOverlay?.();
            return;
          }
          onShowOverlay?.({
            x: overlayX,
            y: overlayY,
            objectId: resolvedObject.id,
            content: (
              <div className="hmi-select-overlay" style={{
                minWidth: Math.max(resolvedObject.width * scaleX, 100),
                maxHeight: selectDropdownMaxHeight,
                background: selectDropdownBackground,
                borderColor: selectDropdownBorder,
                borderRadius: selectCornerRadius,
                fontFamily: selectFontFamily,
                fontSize: selectFontSize,
              }}>
                {options.map((opt, idx) => (
                  <div
                    key={idx}
                    className="hmi-select-overlay__option"
                    style={{
                      color: selectedOption?.value === opt.value ? selectOptionSelectedText : selectOptionTextColor,
                      background: selectedOption?.value === opt.value ? selectOptionSelectedColor : "transparent",
                      minHeight: selectOptionHeight,
                      padding: `0 ${selectPadding}px`,
                      fontFamily: selectFontFamily,
                      fontSize: selectFontSize,
                    }}
                    onMouseEnter={(event) => {
                      if (selectedOption?.value === opt.value) {
                        return;
                      }
                      event.currentTarget.style.background = selectOptionHoverColor;
                    }}
                    onMouseLeave={(event) => {
                      if (selectedOption?.value === opt.value) {
                        event.currentTarget.style.background = selectOptionSelectedColor;
                        return;
                      }
                      event.currentTarget.style.background = "transparent";
                    }}
                    onClick={() => {
                      const writeTagField = runtimeMode
                        ? (resolvedObject.writeTag?.trim() || resolvedObject.tag)
                        : resolvedObject.tag;
                      const resolvedWriteTag = runtimeMode
                        ? tagValue(writeTagField, { useObjectIndexing: true, fieldName: "writeTag" })
                        : undefined;
                      const tagName = runtimeMode
                        ? (resolvedWriteTag?.resolvedName ?? writeTagField)
                        : writeTagField;
                      if (runtimeMode && tagName?.trim()) {
                        onAction?.(
                          withActionRoleLevel({
                            type: "write",
                            tag: tagName,
                            value: opt.value,
                          }, resolvedObject.requiredActionRole),
                          withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
                        );
                      }
                      onHideOverlay?.();
                    }}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            ),
          });
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={renderBackground}
          stroke={renderBorder}
          strokeWidth={selectBorderWidth}
          cornerRadius={selectCornerRadius}
          opacity={runtimeDisabled ? 0.65 : 1}
          perfectDrawEnabled={false}
          {...selectShadowProps}
        />
        <Rect
          x={Math.max(0, resolvedObject.width - selectArrowAreaWidth)}
          y={0}
          width={selectArrowAreaWidth}
          height={resolvedObject.height}
          fill={isSelectDropdownOpen ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
          listening={false}
          perfectDrawEnabled={false}
        />
        {renderBoxText(displayText, {
          fontFamily: selectFontFamily,
          fontSize: selectFontSize,
          color: renderTextColor,
          horizontalAlign: "left",
          verticalAlign: "middle",
          padding: selectPadding,
        }, {
          width: Math.max(1, resolvedObject.width - selectArrowAreaWidth),
          height: resolvedObject.height,
        })}
        <Line
          points={[
            Math.max(0, resolvedObject.width - selectArrowAreaWidth),
            4,
            Math.max(0, resolvedObject.width - selectArrowAreaWidth),
            Math.max(4, resolvedObject.height - 4),
          ]}
          stroke={renderBorder}
          opacity={0.7}
          strokeWidth={Math.max(1, selectBorderWidth)}
          listening={false}
        />
        <Line
          points={[
            resolvedObject.width - selectArrowAreaWidth / 2 - 5,
            resolvedObject.height / 2 - 2,
            resolvedObject.width - selectArrowAreaWidth / 2,
            resolvedObject.height / 2 + 3,
            resolvedObject.width - selectArrowAreaWidth / 2 + 5,
            resolvedObject.height / 2 - 2,
          ]}
          stroke={renderArrowColor}
          strokeWidth={1.8}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "radio-group") {
    const radioTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const radioBad = runtimeMode && Boolean(
      radioTag?.missingBindingReference
      || radioTag?.missingIndexedTag
      || (resolvedObject.tag?.trim() && (!radioTag?.value || radioTag.value.quality === "Bad"))
    );
    const radioValue = runtimeMode ? radioTag?.value?.value : undefined;
    const radioOptions = resolvedObject.options ?? [];
    const isRadioVertical = resolvedObject.orientation === "vertical";
    const styleMode = resolvedObject.styleMode === "card" ? "card" : "segmented";
    const itemGap = Math.max(0, resolvedObject.itemGap ?? 4);
    const itemPadding = Math.max(0, resolvedObject.itemPadding ?? 6);
    const hasExplicitContainerStyle =
      resolvedObject.backgroundColor !== undefined
      || resolvedObject.borderColor !== undefined
      || resolvedObject.borderWidth !== undefined;
    const transparentBackground = resolvedObject.transparentBackground ?? true;
    const borderWidth = hasExplicitContainerStyle ? Math.max(0, resolvedObject.borderWidth ?? 1) : 0;
    const cornerRadius = Math.max(0, resolvedObject.cornerRadius ?? 4);
    const backgroundColor = transparentBackground
      ? "transparent"
      : (hasExplicitContainerStyle ? (resolvedObject.backgroundColor ?? HMI_CONTROL_COLORS.fieldBg) : HMI_CONTROL_COLORS.fieldBg);
    const borderColor = hasExplicitContainerStyle ? (resolvedObject.borderColor ?? HMI_CONTROL_COLORS.border) : "transparent";
    const selectedColor = resolvedObject.selectedColor ?? HMI_CONTROL_COLORS.accentDark;
    const unselectedColor = resolvedObject.unselectedColor ?? HMI_CONTROL_COLORS.track;
    const labelColor = resolvedObject.labelColor ?? HMI_CONTROL_COLORS.text;
    const selectedLabelColor = resolvedObject.selectedLabelColor ?? HMI_CONTROL_COLORS.textStrong;
    const fontFamily = resolvedObject.fontFamily ?? "Consolas";
    const fontSize = Math.max(8, resolvedObject.fontSize ?? Math.max(10, resolvedObject.height * 0.34));
    const badTextColor = resolvedObject.badTextColor ?? HMI_CONTROL_COLORS.bad;
    const badBackgroundColor = resolvedObject.badBackgroundColor ?? "#2b1a1a";
    const disabledColor = resolvedObject.disabledColor ?? HMI_CONTROL_COLORS.disabled;
    const disabledTextColor = resolvedObject.disabledTextColor ?? "#8c8c8c";
    const renderBackground = runtimeDisabled ? disabledColor : (radioBad ? badBackgroundColor : backgroundColor);
    const renderBorder = runtimeDisabled ? disabledColor : borderColor;
    const renderSelected = runtimeDisabled ? disabledColor : selectedColor;
    const renderUnselected = runtimeDisabled ? disabledColor : unselectedColor;
    const renderLabel = runtimeDisabled ? disabledTextColor : (radioBad ? badTextColor : labelColor);
    const renderSelectedLabel = runtimeDisabled ? disabledTextColor : (radioBad ? badTextColor : selectedLabelColor);
    const radioCount = Math.max(1, radioOptions.length);
    const totalGap = itemGap * Math.max(0, radioCount - 1);
    const radioShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });
    const itemRects = radioOptions.map((_, idx) => {
      if (isRadioVertical) {
        const itemHeight = Math.max(1, (resolvedObject.height - totalGap) / radioCount);
        return {
          x: 0,
          y: idx * (itemHeight + itemGap),
          width: resolvedObject.width,
          height: itemHeight,
        };
      }
      const itemWidth = Math.max(1, (resolvedObject.width - totalGap) / radioCount);
      return {
        x: idx * (itemWidth + itemGap),
        y: 0,
        width: itemWidth,
        height: resolvedObject.height,
      };
    });
    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          if (!radioOptions.length) {
            return;
          }
          const groupNode = evt.currentTarget;
          const pointer = groupNode.getRelativePointerPosition();
          if (!pointer) {
            return;
          }
          const clickedIndex = itemRects.findIndex((rect) => (
            pointer.x >= rect.x
            && pointer.x <= rect.x + rect.width
            && pointer.y >= rect.y
            && pointer.y <= rect.y + rect.height
          ));
          if (clickedIndex < 0 || clickedIndex >= radioOptions.length) {
            return;
          }
          const selectedOpt = radioOptions[clickedIndex];
          if (!selectedOpt) {
            return;
          }
          const writeTagField = runtimeMode
            ? (resolvedObject.writeTag?.trim() || resolvedObject.tag)
            : resolvedObject.tag;
          const resolvedWriteTag = runtimeMode
            ? tagValue(writeTagField, { useObjectIndexing: true, fieldName: "writeTag" })
            : undefined;
          const tagName = runtimeMode
            ? (resolvedWriteTag?.resolvedName ?? writeTagField)
            : writeTagField;
          if (runtimeMode && !tagName?.trim()) {
            return;
          }
          onAction?.(
            withActionRoleLevel({
              type: "write",
              tag: tagName ?? "",
              value: selectedOpt.value,
            }, resolvedObject.requiredActionRole),
            withRuntimeActionContext(renderContext, resolvedObject.id, performance.now(), resolvedObject.name),
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={renderBackground}
          stroke={renderBorder}
          strokeWidth={borderWidth}
          cornerRadius={cornerRadius}
          opacity={runtimeDisabled ? 0.7 : 1}
          perfectDrawEnabled={false}
          {...radioShadowProps}
        />
        {radioOptions.map((opt, idx) => {
          const isSelected = runtimeMode && String(radioValue) === String(opt.value);
          const rect = itemRects[idx] ?? { x: 0, y: 0, width: resolvedObject.width, height: resolvedObject.height };
          const optX = rect.x;
          const optY = rect.y;
          const optW = rect.width;
          const optH = rect.height;
          const fillColor = isSelected ? renderSelected : renderUnselected;
          const gradientFill = styleMode === "segmented" ? fillColor : (isSelected ? renderSelected : backgroundColor);
          const buttonGradientProps = resolveFillGradientProps({
            enabled: resolvedObject.gradientEnabled ?? false,
            direction: (resolvedObject.gradientDirection ?? "horizontal") as GradientDirection,
            startColor: resolvedObject.gradientStartColor ?? gradientFill,
            endColor: resolvedObject.gradientEndColor ?? gradientFill,
            baseFill: gradientFill,
            width: optW,
            height: optH,
          });
          const optionFontSize = fontSize;
          return (
            <Group key={idx} x={optX} y={optY}>
              <Rect
                x={0}
                y={0}
                width={optW}
                height={optH}
                {...buttonGradientProps}
                stroke={styleMode === "card" ? renderBorder : "transparent"}
                strokeWidth={styleMode === "card" ? borderWidth : 0}
                cornerRadius={Math.max(0, cornerRadius - 1)}
              />
              {renderBoxText(opt.label, {
                fontFamily,
                fontSize: optionFontSize,
                color: isSelected ? renderSelectedLabel : renderLabel,
                horizontalAlign: "center",
                verticalAlign: "middle",
                padding: itemPadding,
              }, {
                width: optW,
                height: optH,
              })}
            </Group>
          );
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "numeric-input") {
    const numInputTag = runtimeMode ? tagValue(resolvedObject.tag, { useObjectIndexing: true, fieldName: "tag" }) : undefined;
    const numErrorTag = runtimeMode ? tagValue(resolvedObject.errorTag, { useObjectIndexing: true, fieldName: "errorTag" }) : undefined;
    const numErrorActive = runtimeMode ? runtimeValueToBoolean(numErrorTag?.value?.value) : false;
    const numErrorStateBad = runtimeMode && Boolean(
      numErrorTag?.missingBindingReference
      || numErrorTag?.missingIndexedTag
      || (resolvedObject.errorTag?.trim() && numErrorTag?.value?.quality === "Bad")
    );
    const numInputBad = runtimeMode && Boolean(
      numInputTag?.missingBindingReference
      || numInputTag?.missingIndexedTag
      || (resolvedObject.tag?.trim() && (!numInputTag?.value || numInputTag.value.quality === "Bad"))
      || numErrorActive
      || numErrorStateBad
    );
    const rawNumValue = runtimeMode ? Number(numInputTag?.value?.value ?? NaN) : NaN;
    const numMin = resolvedObject.min ?? 0;
    const numMax = resolvedObject.max ?? 100;
    const numValue = Number.isFinite(rawNumValue) ? Math.min(numMax, Math.max(numMin, rawNumValue)) : NaN;

    const objTextColor = resolvedObject.textColor ?? HMI_CONTROL_COLORS.text;
    const objFontSize = resolvedObject.fontSize ?? 12;
    const objFontFamily = resolvedObject.fontFamily ?? "Consolas";
    const objBgColor = resolvedObject.backgroundColor ?? HMI_CONTROL_COLORS.fieldBg;
    const objBorderColor = resolvedObject.borderColor ?? HMI_CONTROL_COLORS.border;
    const objBorderWidth = resolvedObject.borderWidth ?? 1;
    const objCornerRadius = resolvedObject.cornerRadius ?? 4;
    const objTextAlign = resolvedObject.textAlign ?? "right";
    const numObjWriteTag = resolvedObject.writeTag;
    const numObjTag = resolvedObject.tag;
    const numObjErrorTag = resolvedObject.errorTag;
    const numObjRequiredActionRole = resolvedObject.requiredActionRole;
    const numObjName = resolvedObject.name;
    const badTextColor = resolvedObject.badTextColor ?? "#f14c4c";
    const badBackgroundColor = resolvedObject.badBackgroundColor ?? "#2b1a1a";
    const badBorderColor = resolvedObject.badBorderColor ?? "#a03030";
    const displayTextColor = numInputBad ? badTextColor : objTextColor;
    const displayBgColor = numInputBad ? badBackgroundColor : objBgColor;
    const displayBorderColor = numInputBad ? badBorderColor : objBorderColor;

    const displayNumText = numInputBad
      ? "BAD"
      : Number.isFinite(numValue)
        ? formatNumericValue(numValue, {
            formatMode: resolvedObject.formatMode ?? "decimals",
            decimals: resolvedObject.decimals ?? 0,
            formatPattern: resolvedObject.formatPattern,
            unit: resolvedObject.unit,
            showUnit: resolvedObject.showUnit,
          })
        : resolvedObject.placeholder ?? "---";
    const numericInputShadowProps = resolveShapeShadowProps(resolvedObject, { disabled: effectiveShadowDisabled });

    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (!isPrimaryPointerButton(evt.evt)) {
            return;
          }
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          if (runtimeDisabled) {
            return;
          }
          const targetTag = (numObjWriteTag?.trim() || numObjTag)?.trim();
          if (!targetTag) {
            return;
          }
          const sourceClientRect = (() => {
            const stage = evt.currentTarget.getStage();
            const containerRect = stage?.container().getBoundingClientRect();
            const nodeRect = evt.currentTarget.getClientRect({ skipShadow: true, skipStroke: true });
            if (!containerRect || !Number.isFinite(nodeRect.x) || !Number.isFinite(nodeRect.y)) {
              return undefined;
            }
            return {
              left: containerRect.left + nodeRect.x,
              top: containerRect.top + nodeRect.y,
              width: Math.max(1, nodeRect.width),
              height: Math.max(1, nodeRect.height),
            };
          })();
          onRequestNumericInput?.({
            objectId: resolvedObject.id,
            objectName: numObjName ?? "Numeric Input",
            currentValue: Number.isFinite(rawNumValue) ? rawNumValue : 0,
            min: resolvedObject.min,
            max: resolvedObject.max,
            step: resolvedObject.step,
            decimals: resolvedObject.decimals,
            formatMode: resolvedObject.formatMode,
            formatPattern: resolvedObject.formatPattern,
            unit: resolvedObject.unit,
            backgroundColor: objBgColor,
            textColor: objTextColor,
            borderColor: objBorderColor,
            fontFamily: objFontFamily,
            fontSize: objFontSize,
            writeTag: targetTag,
            errorTag: numObjErrorTag,
            requiredActionRole: numObjRequiredActionRole,
            dialogTitle: resolvedObject.dialogTitle,
            dialogWidth: resolvedObject.dialogWidth,
            dialogHeight: resolvedObject.dialogHeight,
            dialogPlacement: resolvedObject.dialogPlacement,
            dialogOffset: resolvedObject.dialogOffset,
            dialogX: resolvedObject.dialogX,
            dialogY: resolvedObject.dialogY,
            sourceClientRect,
            dialogBackgroundColor: resolvedObject.dialogBackgroundColor,
            dialogTextColor: resolvedObject.dialogTextColor,
            dialogBorderColor: resolvedObject.dialogBorderColor,
            dialogCloseButtonTextColor: resolvedObject.dialogCloseButtonTextColor,
            dialogCloseButtonBackgroundColor: resolvedObject.dialogCloseButtonBackgroundColor,
            dialogSetButtonTextColor: resolvedObject.dialogSetButtonTextColor,
            dialogSetButtonBackgroundColor: resolvedObject.dialogSetButtonBackgroundColor,
            dialogSetButtonBorderColor: resolvedObject.dialogSetButtonBorderColor,
            showMeta: resolvedObject.showMeta,
            stepButtonUseTextColor: resolvedObject.stepButtonUseTextColor,
            stepButtonTextColor: resolvedObject.stepButtonTextColor,
            stepButtonBackgroundColor: resolvedObject.stepButtonBackgroundColor,
            badTextColor,
            badBackgroundColor,
            badBorderColor,
            signalBad: numInputBad,
          });
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={runtimeDisabled ? HMI_CONTROL_COLORS.fieldDisabledBg : displayBgColor}
          stroke={runtimeDisabled ? HMI_CONTROL_COLORS.disabled : displayBorderColor}
          strokeWidth={objBorderWidth}
          cornerRadius={objCornerRadius}
          opacity={runtimeDisabled ? 0.55 : 1}
          perfectDrawEnabled={false}
          {...numericInputShadowProps}
        />
        {renderBoxText(displayNumText, {
          fontFamily: objFontFamily,
          fontSize: Math.max(9, objFontSize),
          color: runtimeDisabled ? HMI_CONTROL_COLORS.disabled : displayTextColor,
          horizontalAlign: objTextAlign,
          verticalAlign: "middle",
          padding: 6,
        }, {
          width: resolvedObject.width,
          height: resolvedObject.height,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  return <Group {...commonGroupProps} />;
}

function isIndexedAddressDebugEnabled(): boolean {
  return typeof window !== "undefined" &&
    window.localStorage.getItem("scada.debugIndexedAddress") === "1";
}

function isObjectVisibleByRole(object: HmiObject, mode: "editor" | "runtime", context: RenderContext): boolean {
  if (mode !== "runtime") {
    return true;
  }
  if (!hasRoleAccess(context.userRoleLevel, object.requiredVisibleRole)) {
    return false;
  }
  const roles = (object.visibleForRoles ?? []).map((role) => role.trim()).filter(Boolean);
  if (roles.length === 0) {
    return true;
  }
  const fallbackLevel = context.isAuthenticated === false ? 0 : roleLevelFromRoles(context.userRoles);
  const userLevel = typeof context.userRoleLevel === "number"
    ? clampAccessRoleLevel(context.userRoleLevel, 0)
    : fallbackLevel;
  return roles.some((role) => hasRoleAccess(userLevel, roleLevelFromRoles([role])));
}

function withActionRoleLevel(action: RuntimeAction, objectRequiredActionRole: number | undefined): RuntimeAction {
  if (typeof objectRequiredActionRole !== "number") {
    return action;
  }
  return {
    ...action,
    requiredRoleLevel: clampAccessRoleLevel(
      action.requiredRoleLevel ?? objectRequiredActionRole,
      0,
    ),
  };
}

function GroupNode({
  object,
  project,
  mode,
  tags,
  libraries,
  renderContext,
  frameStack,
  instanceStack,
  interactive,
  inheritedDisabled,
  selected,
  onSelectObject,
  onMoveObject,
  onCommitObjectMove,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames,
  scopedAssets,
  groupProps,
  overlayState,
  onShowOverlay,
  onHideOverlay,
  shadowDisabled,
  nodeIdPrefix,
}: {
  object: GroupObject;
  project: ScadaProject;
  mode: "editor" | "runtime";
  tags: TagMap;
  libraries: ElementLibrary[];
  renderContext: RenderContext;
  frameStack: string[];
  instanceStack: string[];
  interactive: boolean;
  inheritedDisabled: boolean;
  selected: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onCommitObjectMove?: () => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames: boolean;
  scopedAssets?: Record<string, Asset>;
  groupProps: Record<string, unknown>;
  overlayState?: RuntimeOverlayState | null;
  onShowOverlay?: (overlay: RuntimeOverlayState) => void;
  onHideOverlay?: () => void;
  shadowDisabled: boolean;
  nodeIdPrefix?: string;
}) {
  const scopedContext = useMemo(
    () => ({
      ...renderContext,
      parameters: withRuntimeScopeParameter(renderContext.parameters, object.id),
    }),
    [
      object.id,
      renderContext.bindings,
      renderContext.isAuthenticated,
      renderContext.parameters,
      renderContext.screenId,
      renderContext.popupInstanceId,
      renderContext.tagPrefix,
      renderContext.userRoleLevel,
      renderContext.userRoles,
    ],
  );
  const virtualScreen: HmiScreen = {
    id: object.id,
    name: object.name ?? object.id,
    kind: "template",
    width: object.width,
    height: object.height,
    background: "transparent",
    objects: object.objects,
  };

  return (
    <Group {...groupProps}>
      <HmiRenderer
        project={project}
        screen={virtualScreen}
        mode={mode}
        tags={tags}
        libraries={libraries}
        renderContext={scopedContext}
        frameStack={frameStack}
        instanceStack={instanceStack}
        interactive={false}
        inheritedDisabled={inheritedDisabled}
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onCommitObjectMove={onCommitObjectMove}
        onResizeObject={onResizeObject}
        onAction={onAction}
        onDoubleClickObject={onDoubleClickObject}
        onContextMenuObject={onContextMenuObject}
        showObjectFrames={showObjectFrames}
        scopedAssets={scopedAssets}
        overlayState={overlayState}
        onShowOverlay={onShowOverlay}
        onHideOverlay={onHideOverlay}
        shadowDisabled={shadowDisabled}
        nodeIdPrefix={`${nodeIdPrefix ?? ""}group-${object.id}-`}
      />
      {interactive ? <SelectionOutline object={object} selected={selected || showObjectFrames} /> : null}
    </Group>
  );
}

function FrameNode({
  object,
  selected,
  project,
  mode,
  tags,
  libraries,
  renderContext,
  frameStack,
  instanceStack,
  onSelectObject,
  onMoveObject,
  onCommitObjectMove,
  onResizeObject,
  onAction,
  commonGroupProps,
  scopedAssets,
  inheritedDisabled,
  shadowDisabled,
  nodeIdPrefix,
}: {
  object: FrameObject;
  selected: boolean;
  project: ScadaProject;
  mode: "editor" | "runtime";
  tags: TagMap;
  libraries: ElementLibrary[];
  renderContext: RenderContext;
  frameStack: string[];
  instanceStack: string[];
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onCommitObjectMove?: () => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  commonGroupProps: Record<string, unknown>;
  scopedAssets?: Record<string, Asset>;
  inheritedDisabled: boolean;
  shadowDisabled: boolean;
  nodeIdPrefix?: string;
}) {
  const screen = project.screens.find((item) => item.id === object.screenId);
  const hasCycle = frameStack.includes(object.screenId);

  const context: RenderContext = useMemo(
    () => ({
      tagPrefix: combineTagPrefix(renderContext.tagPrefix, object.tagPrefix),
      parameters: withRuntimeScopeParameter(renderContext.parameters, object.id),
      bindings: renderContext.bindings,
    }),
    [object.id, object.tagPrefix, renderContext.bindings, renderContext.parameters, renderContext.tagPrefix],
  );

  if (!screen) {
    return <MissingNode commonGroupProps={commonGroupProps} message={`Screen not found: ${object.screenId}`} />;
  }

  if (hasCycle) {
    return <MissingNode commonGroupProps={commonGroupProps} message="Frame recursion blocked" />;
  }

  const childScale = computeFrameScale(object.scaleMode ?? "fit", object.width, object.height, screen.width, screen.height);

  return (
    <Group {...commonGroupProps}>
      {object.showBorder ? (
        <Rect width={object.width} height={object.height} stroke={object.borderColor ?? "#888"} strokeWidth={object.borderWidth ?? 1} />
      ) : null}

      <Group
        clip={object.clipContent ?? true ? { x: 0, y: 0, width: object.width, height: object.height } : undefined}
        x={childScale.offsetX}
        y={childScale.offsetY}
        scaleX={childScale.scaleX}
        scaleY={childScale.scaleY}
      >
        <Rect x={0} y={0} width={screen.width} height={screen.height} fill={screen.background ?? "transparent"} />
        <HmiRenderer
          project={project}
          screen={screen}
          mode={mode}
          tags={tags}
          libraries={libraries}
          renderContext={context}
          frameStack={[...frameStack, screen.id]}
          instanceStack={instanceStack}
          interactive={false}
          inheritedDisabled={inheritedDisabled}
          onSelectObject={onSelectObject}
          onMoveObject={onMoveObject}
          onCommitObjectMove={onCommitObjectMove}
          onResizeObject={onResizeObject}
          onAction={onAction}
          scopedAssets={scopedAssets}
          shadowDisabled={shadowDisabled}
          nodeIdPrefix={`${nodeIdPrefix ?? ""}frame-${object.id}-`}
        />
      </Group>
      <SelectionOutline object={object} selected={selected} />
    </Group>
  );
}

function LibraryInstanceNode({
  object,
  selected,
  project,
  mode,
  tags,
  libraries,
  renderContext,
  frameStack,
  instanceStack,
  interactive,
  inheritedDisabled,
  onSelectObject,
  onMoveObject,
  onCommitObjectMove,
  onResizeObject,
  onAction,
  commonGroupProps,
  runtimeDisabled,
  shadowDisabled,
  nodeIdPrefix,
}: {
  object: LibraryElementInstanceObject;
  selected: boolean;
  project: ScadaProject;
  mode: "editor" | "runtime";
  tags: TagMap;
  libraries: ElementLibrary[];
  renderContext: RenderContext;
  frameStack: string[];
  instanceStack: string[];
  interactive: boolean;
  inheritedDisabled: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onCommitObjectMove?: () => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  commonGroupProps: Record<string, unknown>;
  runtimeDisabled: boolean;
  shadowDisabled: boolean;
  nodeIdPrefix?: string;
}) {
  const library = libraries.find((item) => item.id === object.libraryId);
  if (!library) {
    return <MissingNode commonGroupProps={commonGroupProps} message={`Library not found: ${object.libraryId}`} />;
  }

  const element = library.elements.find((item) => item.id === object.elementId);
  if (!element) {
    return <MissingNode commonGroupProps={commonGroupProps} message={`Element not found: ${object.elementId}`} />;
  }

  const stackKey = `${library.id}:${element.id}`;
  if (instanceStack.includes(stackKey)) {
    return <MissingNode commonGroupProps={commonGroupProps} message="Library recursion blocked" />;
  }

  const instanceParams = toResolvedParameterMap(element, object.parameterValues);
  const mergedParameters = useMemo(
    () => ({
      ...withRuntimeScopeParameter(renderContext.parameters, object.id),
      ...instanceParams,
    }),
    [instanceParams, object.id, renderContext.parameters],
  );
  const runtimeResolveContext: RuntimeResolveContext = useMemo(
    () => ({
      tagValues: tags,
      warn: (warning) => {
        if (mode === "runtime") {
          // eslint-disable-next-line no-console
          console.warn("[Runtime] Runtime value resolver warning", {
            instanceId: object.id,
            libraryId: library.id,
            elementId: element.id,
            ...warning,
          });
        }
      },
    }),
    [element.id, library.id, mergedParameters, mode, object.id, tags],
  );
  const bindingResolution = useMemo(
    () => resolveLibraryElementInstanceBindingsDetailed(element, object, runtimeResolveContext),
    [element, object, runtimeResolveContext],
  );
  const context: RenderContext = {
    tagPrefix: combineTagPrefix(renderContext.tagPrefix, object.tagPrefix),
    parameters: mergedParameters,
    bindings: {
      ...(renderContext.bindings ?? {}),
      ...bindingResolution.resolvedBindings,
    },
  };
  const resolvedObjects = useMemo(
    () => (mode === "runtime"
      ? applyElementStateRules(element.objects, element.stateRules, { tags, renderContext: context, parameters: context.parameters ?? {} })
      : element.objects),
    [context, element.objects, element.stateRules, mode, tags],
  );

  const childScale = computeFrameScale(object.scaleMode ?? "fit", object.width, object.height, element.width, element.height);
  const scopedAssets = toAssetMap(library.assets);

  const virtualScreen: HmiScreen = {
    id: `${library.id}:${element.id}`,
    name: element.name,
    kind: "template",
    width: element.width,
    height: element.height,
    background: "transparent",
    objects: resolvedObjects,
  };

  useEffect(() => {
    if (mode !== "runtime") {
      return;
    }
    if (!bindingResolution.issues.length) {
      return;
    }
    warnLibraryBindingIssuesOnce(library.id, element.id, object.id, bindingResolution.issues);
  }, [bindingResolution.issues, element.id, library.id, mode, object.id]);

  const missingBindingReferences = useMemo(() => {
    const references = new Set<string>();
    collectMissingBindingReferencesFromObjects(element.objects, context.bindings, references);
    collectMissingBindingReferencesFromRules(element.stateRules ?? [], context.bindings, references);
    return [...references];
  }, [context.bindings, element.objects, element.stateRules]);

  useEffect(() => {
    if (mode !== "runtime") {
      return;
    }
    if (!missingBindingReferences.length) {
      return;
    }
    warnMissingBindingReferencesOnce(library.id, element.id, object.id, missingBindingReferences);
  }, [element.id, library.id, missingBindingReferences, mode, object.id]);

  return (
    <Group
      {...commonGroupProps}
      onClick={(event) => {
        if (!isPrimaryPointerButton(event.evt)) {
          return;
        }
        const baseOnClick = commonGroupProps.onClick as ((evt: KonvaEventObject<MouseEvent>) => void) | undefined;
        baseOnClick?.(event);
        if (!interactive && !runtimeDisabled && object.action) {
          onAction?.(
            withActionRoleLevel(object.action, object.requiredActionRole),
            withRuntimeActionContext(context, object.id, performance.now(), object.name),
          );
        }
      }}
      onTap={(event) => {
        const baseOnTap = commonGroupProps.onTap as ((evt: KonvaEventObject<Event>) => void) | undefined;
        baseOnTap?.(event);
        if (!interactive && !runtimeDisabled && object.action) {
          onAction?.(
            withActionRoleLevel(object.action, object.requiredActionRole),
            withRuntimeActionContext(context, object.id, performance.now(), object.name),
          );
        }
      }}
    >
      <Group x={childScale.offsetX} y={childScale.offsetY} scaleX={childScale.scaleX} scaleY={childScale.scaleY}>
        <HmiRenderer
          project={project}
          screen={virtualScreen}
          mode={mode}
          tags={tags}
          libraries={libraries}
          renderContext={context}
          frameStack={frameStack}
          instanceStack={[...instanceStack, stackKey]}
          interactive={false}
          inheritedDisabled={inheritedDisabled}
          onSelectObject={onSelectObject}
          onMoveObject={onMoveObject}
          onCommitObjectMove={onCommitObjectMove}
          onResizeObject={onResizeObject}
          onAction={onAction}
          scopedAssets={scopedAssets}
          shadowDisabled={shadowDisabled}
          nodeIdPrefix={mode === "editor" ? `${nodeIdPrefix ?? ""}libinst-${object.id}-` : nodeIdPrefix}
        />
      </Group>
      {interactive ? <SelectionOutline object={object} selected={selected} /> : null}
    </Group>
  );
}

function ImageNode({
  object,
  selected,
  groupProps,
  project,
  libraries,
  scopedAssets,
  stateValue,
  interactive,
  onSelectObject,
  onAction,
  renderContext,
  runtimeDisabled,
  forceFrame = false,
  shadowDisabled,
}: {
  object: Extract<HmiObject, { type: "image" }>;
  selected: boolean;
  groupProps: Record<string, unknown>;
  project: ScadaProject;
  libraries: ElementLibrary[];
  scopedAssets?: Record<string, Asset>;
  stateValue: unknown;
  interactive: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  renderContext: RenderContext;
  runtimeDisabled: boolean;
  forceFrame?: boolean;
  shadowDisabled: boolean;
}) {
  const stateEntry = object.stateImages?.find((item) => String(item.state) === String(stateValue));
  const stateSrc = stateEntry?.src;
  const stateAssetId = stateEntry?.assetId;
  const activeAssetId = stateAssetId ?? object.assetId;
  const resolvedUrl = resolveAssetUrl(activeAssetId, {
    projectAssets: project.assets ?? [],
    scopedAssets,
    libraries,
  });
  const source = stateSrc ?? resolvedUrl ?? object.src;
  const { image, status: imageStatus } = useImage(source);
  const imageShadowProps = resolveShapeShadowProps(object, { disabled: shadowDisabled });
  const placement = useMemo(
    () => computeImagePlacement(object.width, object.height, image?.width, image?.height, object.fit),
    [image?.height, image?.width, object.fit, object.height, object.width],
  );

  // Determine if the asset is missing (assetId is set but asset was not found)
  const isAssetMissing = Boolean(activeAssetId) && !resolvedUrl && !stateSrc && !object.src;

  return (
    <Group
      {...groupProps}
      onClick={(evt: KonvaEventObject<MouseEvent>) => {
        if (!isPrimaryPointerButton(evt.evt)) {
          return;
        }
        if (interactive) {
          onSelectObject?.({
            objectId: object.id,
            additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
          });
          return;
        }
        if (!runtimeDisabled && object.action) {
          onAction?.(
            withActionRoleLevel(object.action, object.requiredActionRole),
            withRuntimeActionContext(renderContext, object.id, performance.now(), object.name),
          );
        }
      }}
      opacity={runtimeDisabled ? 0.65 : 1}
    >
      {source && image ? (
        <KonvaImage
          image={image}
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          crop={placement.crop}
          perfectDrawEnabled={false}
          {...imageShadowProps}
        />
      ) : source && imageStatus === "loading" ? null : isAssetMissing ? (
        <>
          <Rect
            width={object.width}
            height={object.height}
            fill="#2a1f1f"
            stroke="#f14c4c"
            strokeWidth={1}
            dash={[4, 3]}
            perfectDrawEnabled={false}
            {...imageShadowProps}
          />
          <Text
            text="asset not found"
            width={object.width}
            height={object.height}
            align="center"
            verticalAlign="middle"
            fill="#f14c4c"
            fontSize={12}
          />
        </>
      ) : source && imageStatus === "error" ? (
        <>
          <Rect width={object.width} height={object.height} stroke="#434343" dash={[4, 3]} perfectDrawEnabled={false} {...imageShadowProps} />
          <Text
            text="Failed to load image"
            width={object.width}
            height={object.height}
            fill="#ff7875"
            align="center"
            verticalAlign="middle"
          />
        </>
      ) : (
        <>
          <Rect width={object.width} height={object.height} stroke="#434343" dash={[4, 3]} perfectDrawEnabled={false} {...imageShadowProps} />
          <Text
            text="Image source is empty"
            width={object.width}
            height={object.height}
            fill="#ff7875"
            align="center"
            verticalAlign="middle"
          />
        </>
      )}
      <SelectionOutline object={object} selected={selected || forceFrame} />
    </Group>
  );
}

function ButtonNode({
  object,
  selected,
  groupProps,
  project,
  libraries,
  scopedAssets,
  interactive,
  onSelectObject,
  onAction,
  renderContext,
  runtimeDisabled,
  forceFrame = false,
  shadowDisabled,
}: {
  object: Extract<HmiObject, { type: "button" }>;
  selected: boolean;
  groupProps: Record<string, unknown>;
  project: ScadaProject;
  libraries: ElementLibrary[];
  scopedAssets?: Record<string, Asset>;
  interactive: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void | Promise<void>;
  renderContext: RenderContext;
  runtimeDisabled: boolean;
  forceFrame?: boolean;
  shadowDisabled: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const [executing, setExecuting] = useState(false);
  const isDisabled = runtimeDisabled || (!interactive && !onAction) || executing;
  const normalSrc = resolveAssetUrl(object.backgroundAssetId, {
    projectAssets: project.assets ?? [],
    scopedAssets,
    libraries,
  });
  const pressedSrc = resolveAssetUrl(object.pressedBackgroundAssetId, {
    projectAssets: project.assets ?? [],
    scopedAssets,
    libraries,
  });
  const disabledSrc = resolveAssetUrl(object.disabledBackgroundAssetId, {
    projectAssets: project.assets ?? [],
    scopedAssets,
    libraries,
  });
  const currentSrc = isDisabled ? disabledSrc ?? normalSrc : pressed && pressedSrc ? pressedSrc : normalSrc;
  const currentFill = isDisabled
    ? object.disabledBackgroundColor ?? object.backgroundColor ?? "#434343"
    : pressed
      ? object.pressedBackgroundColor ?? object.backgroundColor ?? "#0958d9"
      : object.backgroundColor ?? "#0958d9";
  const buttonGradientProps = resolveFillGradientProps({
    enabled: object.gradientEnabled ?? false,
    direction: (object.gradientDirection ?? "horizontal") as GradientDirection,
    startColor: object.gradientStartColor ?? currentFill,
    endColor: object.gradientEndColor ?? currentFill,
    baseFill: currentFill,
    width: object.width,
    height: object.height,
  });
  const { image } = useImage(currentSrc);
  const buttonShadowProps = resolveShapeShadowProps(object, { disabled: shadowDisabled });
  const placement = useMemo(
    () => computeImagePlacement(object.width, object.height, image?.width, image?.height, "stretch"),
    [image?.height, image?.width, object.height, object.width],
  );

  return (
    <Group
      {...groupProps}
      onMouseDown={(evt: KonvaEventObject<MouseEvent>) => {
        const baseOnMouseDown = groupProps.onMouseDown as ((event: KonvaEventObject<MouseEvent>) => void) | undefined;
        baseOnMouseDown?.(evt);
        if (!interactive && !isDisabled) {
          setPressed(true);
        }
      }}
      onMouseUp={(evt: KonvaEventObject<MouseEvent>) => {
        const baseOnMouseUp = groupProps.onMouseUp as ((event: KonvaEventObject<MouseEvent>) => void) | undefined;
        baseOnMouseUp?.(evt);
        setPressed(false);
      }}
      onMouseEnter={(evt: KonvaEventObject<MouseEvent>) => {
        if (interactive) {
          return;
        }
        const container = evt.target.getStage()?.container();
        if (container) {
          container.style.cursor = isDisabled ? "not-allowed" : "pointer";
        }
      }}
      onMouseLeave={(evt: KonvaEventObject<MouseEvent>) => {
        setPressed(false);
        const container = evt.target.getStage()?.container();
        if (container) {
          container.style.cursor = "default";
        }
      }}
      onClick={(evt: KonvaEventObject<MouseEvent>) => {
        if (!isPrimaryPointerButton(evt.evt)) {
          return;
        }
        if (interactive) {
          onSelectObject?.({
            objectId: object.id,
            additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
          });
          return;
        }
        if (!isDisabled) {
          const nextContext = withRuntimeActionContext(renderContext, object.id, performance.now(), object.name);
          setExecuting(true);
          const result = onAction?.(withActionRoleLevel(object.action, object.requiredActionRole), nextContext);
          if (result && typeof (result as Promise<void>).finally === "function") {
            void (result as Promise<void>).finally(() => {
              setExecuting(false);
            });
          } else {
            window.setTimeout(() => {
              setExecuting(false);
            }, 0);
          }
        }
      }}
    >
      <Rect
        width={object.width}
        height={object.height}
        {...buttonGradientProps}
        stroke={object.borderColor}
        strokeWidth={object.borderWidth ?? 0}
        cornerRadius={6}
        perfectDrawEnabled={false}
        {...buttonShadowProps}
      />
      {currentSrc && image ? (
        <KonvaImage image={image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
      ) : null}
      {(object.showText ?? true) && object.text ? (
        renderBoxText(object.text, object.textStyle, {
          width: object.width,
          height: object.height,
          wrap: object.wrap,
          ellipsis: object.ellipsis,
        })
      ) : null}
      <SelectionOutline object={object} selected={selected || forceFrame} />
    </Group>
  );
}

function SelectionOutline({ object, selected }: { object: HmiObject; selected: boolean }) {
  if (!selected) {
    return null;
  }
  return (
    <Rect
      x={0}
      y={0}
      width={object.width}
      height={object.height}
      stroke={object.locked ? "#ffb300" : "#91caff"}
      strokeWidth={1}
      dash={object.locked ? [2, 2] : [4, 3]}
      listening={false}
    />
  );
}

function SelectionHitArea({ object, enabled }: { object: HmiObject; enabled: boolean }) {
  if (!enabled) {
    return null;
  }
  const minWidth = Math.max(10, object.width);
  const minHeight = Math.max(10, object.height);
  return <Rect x={0} y={0} width={minWidth} height={minHeight} fill="rgba(0,0,0,0.001)" />;
}

function MissingNode({ commonGroupProps, message }: { commonGroupProps: Record<string, unknown>; message: string }) {
  return (
    <Group {...commonGroupProps}>
      <Rect width={120} height={42} fill="#2b2b2b" stroke="#ff7875" />
      <Text text={message} fill="#ff7875" width={120} height={42} align="center" verticalAlign="middle" />
    </Group>
  );
}

const warnedBindingIssues = new Set<string>();
const warnedBindingReferenceMisses = new Set<string>();
const MAX_WARNED_RUNTIME_KEYS = 500;

function warnLibraryBindingIssuesOnce(
  libraryId: string,
  elementId: string,
  instanceId: string,
  issues: Array<{ key: string; displayName?: string; required: boolean; reason: string; fallbackBaseTag?: string }>,
) {
  const key = `${libraryId}:${elementId}:${issues
    .map((item) => `${item.key}:${item.reason}:${item.required ? 1 : 0}`)
    .sort()
    .join("|")}`;
  if (warnedBindingIssues.has(key)) {
    return;
  }
  if (warnedBindingIssues.size >= MAX_WARNED_RUNTIME_KEYS) {
    warnedBindingIssues.clear();
  }
  warnedBindingIssues.add(key);
  // eslint-disable-next-line no-console
  console.warn("[Runtime] Library binding issues", {
    libraryId,
    elementId,
    instanceId,
    issues,
  });
}

function warnMissingBindingReferencesOnce(
  libraryId: string,
  elementId: string,
  instanceId: string,
  refs: string[],
) {
  const key = `${libraryId}:${elementId}:${refs.slice().sort().join("|")}`;
  if (warnedBindingReferenceMisses.has(key)) {
    return;
  }
  if (warnedBindingReferenceMisses.size >= MAX_WARNED_RUNTIME_KEYS) {
    warnedBindingReferenceMisses.clear();
  }
  warnedBindingReferenceMisses.add(key);
  // eslint-disable-next-line no-console
  console.warn("[Runtime] Missing binding references in library element", {
    libraryId,
    elementId,
    instanceId,
    references: refs,
  });
}

function collectMissingBindingReference(
  tag: string | undefined,
  resolvedBindings: Record<string, string> | undefined,
  output: Set<string>,
) {
  if (!isBindingReference(tag)) {
    return;
  }
  const bindingKey = extractBindingKey(tag);
  if (!bindingKey) {
    return;
  }
  if (!resolvedBindings?.[bindingKey]) {
    output.add(bindingKey);
  }
}

function collectMissingBindingReferencesFromAction(
  action: RuntimeAction | undefined,
  resolvedBindings: Record<string, string> | undefined,
  output: Set<string>,
) {
  if (!action) {
    return;
  }
  if (action.type === "write" || action.type === "pulse" || action.type === "toggle") {
    collectMissingBindingReference(action.tag, resolvedBindings, output);
    return;
  }
  if ((action.type === "writeConst" || action.type === "writeNumberPrompt") && action.target === "tag") {
    collectMissingBindingReference(action.name, resolvedBindings, output);
  }
}

function collectMissingBindingReferencesFromObjects(
  objects: HmiObject[],
  resolvedBindings: Record<string, string> | undefined,
  output: Set<string>,
) {
  for (const object of objects) {
    collectMissingBindingReference(object.visibleTag, resolvedBindings, output);
    collectMissingBindingReference(object.disabledTag, resolvedBindings, output);
    if ("action" in object && object.action) {
      collectMissingBindingReferencesFromAction(object.action, resolvedBindings, output);
    }
    if (object.type === "group") {
      collectMissingBindingReferencesFromObjects(object.objects, resolvedBindings, output);
      continue;
    }
    if (
      object.type === "value-display" ||
      object.type === "value-input" ||
      object.type === "state-indicator" ||
      object.type === "switch" ||
      object.type === "stateImage" ||
      object.type === "numeric-image-indicator"
    ) {
      collectMissingBindingReference(object.tag, resolvedBindings, output);
    }
    if (object.type === "line") {
      collectMissingBindingReference(object.stateTag, resolvedBindings, output);
      collectMissingBindingReference(object.flowAnimation?.triggerTag, resolvedBindings, output);
      collectMissingBindingReference(object.flowAnimation?.speedTag, resolvedBindings, output);
    }
    if (object.type === "image") {
      collectMissingBindingReference(object.stateTag, resolvedBindings, output);
    }
    if (object.type === "valueSelect" && object.target.type === "tag") {
      collectMissingBindingReference(object.target.tag, resolvedBindings, output);
    }
    if (
      object.type === "checkbox" ||
      object.type === "slider" ||
      object.type === "radio-group"
    ) {
      collectMissingBindingReference(object.tag, resolvedBindings, output);
      collectMissingBindingReference(object.writeTag, resolvedBindings, output);
    }
    if (object.type === "numeric-input") {
      collectMissingBindingReference(object.tag, resolvedBindings, output);
      collectMissingBindingReference(object.writeTag, resolvedBindings, output);
      collectMissingBindingReference(object.errorTag, resolvedBindings, output);
    }
    if (object.type === "progress-bar" || object.type === "select") {
      collectMissingBindingReference(object.tag, resolvedBindings, output);
    }
    if (object.type === "select") {
      collectMissingBindingReference(object.writeTag, resolvedBindings, output);
    }
    if (object.type === "valve") {
      collectMissingBindingReference(object.openTag, resolvedBindings, output);
      collectMissingBindingReference(object.closedTag, resolvedBindings, output);
      collectMissingBindingReference(object.errorTag, resolvedBindings, output);
      collectMissingBindingReference(object.commandOpenTag, resolvedBindings, output);
      collectMissingBindingReference(object.commandCloseTag, resolvedBindings, output);
    }
    if (object.type === "pump") {
      collectMissingBindingReference(object.runTag, resolvedBindings, output);
      collectMissingBindingReference(object.faultTag, resolvedBindings, output);
      collectMissingBindingReference(object.commandStartTag, resolvedBindings, output);
      collectMissingBindingReference(object.commandStopTag, resolvedBindings, output);
    }
  }
}

function collectMissingBindingReferencesFromRules(
  rules: ElementStateRule[],
  resolvedBindings: Record<string, string> | undefined,
  output: Set<string>,
) {
  for (const rule of rules) {
    if (rule.source.type === "tag") {
      collectMissingBindingReference(rule.source.value, resolvedBindings, output);
    }
  }
}

function toResolvedParameterMap(element: LibraryElement, values?: Record<string, unknown>): Record<string, unknown> {
  const defaults = Object.fromEntries((element.parameters ?? []).map((item) => [item.name, item.defaultValue]));
  return { ...defaults, ...(values ?? {}) };
}


function toAssetMap(assets: Asset[]): Record<string, Asset> {
  return Object.fromEntries(assets.map((item) => [item.id, item]));
}

type AssetResolveContext = {
  projectAssets: Asset[];
  scopedAssets?: Record<string, Asset>;
  libraries: ElementLibrary[];
};

const warnedMissingAssetIds = new Set<string>();

function resolveAsset(assetId: string | undefined, context: AssetResolveContext): Asset | null {
  if (!assetId) {
    return null;
  }

  if (context.scopedAssets?.[assetId]) {
    return context.scopedAssets[assetId] ?? null;
  }

  const fromProject = context.projectAssets.find((item) => item.id === assetId);
  if (fromProject) {
    return fromProject;
  }

  for (const library of context.libraries) {
    const fromLibrary = library.assets.find((item) => item.id === assetId);
    if (fromLibrary) {
      return fromLibrary;
    }
  }

  if (import.meta.env.DEV && !warnedMissingAssetIds.has(assetId)) {
    warnedMissingAssetIds.add(assetId);
    const availableAssetIds = [
      ...context.projectAssets.map((item) => item.id),
      ...Object.keys(context.scopedAssets ?? {}),
      ...context.libraries.flatMap((library) => library.assets.map((item) => item.id)),
    ];
    // eslint-disable-next-line no-console
    console.warn("[Assets] Asset not found", { assetId, availableAssetIds });
  }

  return null;
}

function resolveAssetUrl(assetId: string | undefined, context: AssetResolveContext): string | undefined {
  return resolveAsset(assetId, context)?.previewUrl;
}

function computeFrameScale(
  mode: "none" | "fit" | "stretch",
  targetWidth: number,
  targetHeight: number,
  contentWidth: number,
  contentHeight: number,
): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
  if (mode === "stretch") {
    return {
      scaleX: targetWidth / contentWidth,
      scaleY: targetHeight / contentHeight,
      offsetX: 0,
      offsetY: 0,
    };
  }

  if (mode === "none") {
    return {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const scale = Math.min(targetWidth / contentWidth, targetHeight / contentHeight);
  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;

  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (targetWidth - scaledWidth) / 2,
    offsetY: (targetHeight - scaledHeight) / 2,
  };
}

function computeImagePlacement(
  boxWidth: number,
  boxHeight: number,
  imageWidth: number | undefined,
  imageHeight: number | undefined,
  fit: "contain" | "cover" | "stretch" | "none",
): {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: { x: number; y: number; width: number; height: number };
} {
  if (!imageWidth || !imageHeight || fit === "stretch") {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }

  if (fit === "none") {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }

  if (fit === "contain") {
    const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      x: (boxWidth - width) / 2,
      y: (boxHeight - height) / 2,
      width,
      height,
    };
  }

  const sourceRatio = imageWidth / imageHeight;
  const targetRatio = boxWidth / boxHeight;
  let cropWidth = imageWidth;
  let cropHeight = imageHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = imageHeight * targetRatio;
    cropX = (imageWidth - cropWidth) / 2;
  } else {
    cropHeight = imageWidth / targetRatio;
    cropY = (imageHeight - cropHeight) / 2;
  }

  return {
    x: 0,
    y: 0,
    width: boxWidth,
    height: boxHeight,
    crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
  };
}

function selectStateImageAssetId(
  states: Array<{ condition: StateImageCondition; assetId: string }>,
  value: unknown,
): string | undefined {
  for (const state of states) {
    if (state.condition.type === "true" && Boolean(value)) {
      return state.assetId;
    }
    if (state.condition.type === "false" && !Boolean(value)) {
      return state.assetId;
    }
    if (state.condition.type === "equals" && String(value) === String(state.condition.value)) {
      return state.assetId;
    }
    if (state.condition.type === "notEquals" && String(value) !== String(state.condition.value)) {
      return state.assetId;
    }
  }
  return undefined;
}

function selectNumericImageIndicatorAssetId(
  states: Array<{ index: number; assetId?: string }>,
  value: number,
  mode: "default" | "clamp",
): string | undefined {
  if (!Number.isFinite(value) || states.length === 0) {
    return undefined;
  }

  const uniqueIndices = [...new Set(
    states
      .map((state) => Math.floor(Number(state.index)))
      .filter((stateIndex) => Number.isFinite(stateIndex)),
  )].sort((left, right) => left - right);
  if (!uniqueIndices.length) {
    return undefined;
  }

  let targetIndex = Math.floor(value);
  if (mode === "clamp") {
    const minIndex = uniqueIndices[0]!;
    const maxIndex = uniqueIndices[uniqueIndices.length - 1]!;
    targetIndex = Math.max(minIndex, Math.min(maxIndex, targetIndex));
  }

  return states.find((state) => Math.floor(state.index) === targetIndex)?.assetId;
}

function toInternalRuntimeTag(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.startsWith("LW.") ? trimmed : `LW.${trimmed}`;
}

function toLwRuntimeTag(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

function readValueSelectTargetValue(
  object: Extract<HmiObject, { type: "valueSelect" }>,
  project: ScadaProject,
  tags: TagMap,
  context: RenderContext,
): unknown {
  if (object.target.type === "tag") {
    const indexed = resolveObjectTagField({
      object,
      fieldName: "target.tag",
      project,
      context,
      tagValues: tags,
      rawTagName: object.target.tag,
    });
    const resolvedTag = indexed.resolvedTagName ?? resolveTagName(object.target.tag, context);
    return resolvedTag ? tags[resolvedTag]?.value : undefined;
  }
  if (object.target.type === "lw") {
    return tags[toLwRuntimeTag(object.target.address)]?.value;
  }
  const normalized = toInternalRuntimeTag(object.target.name);
  return tags[normalized]?.value ?? tags[object.target.name]?.value;
}

function getNextValueSelectOption(
  options: Array<{ label: string; value: string | number | boolean }>,
  currentIndex: number,
): { label: string; value: string | number | boolean } | undefined {
  if (!options.length) {
    return undefined;
  }
  if (currentIndex < 0) {
    return options[0];
  }
  return options[(currentIndex + 1) % options.length];
}

function buildValueSelectAction(
  object: Extract<HmiObject, { type: "valueSelect" }>,
  value: string | number | boolean,
  project: ScadaProject,
  tags: TagMap,
  context: RenderContext,
): RuntimeAction | undefined {
  if (object.target.type === "internal") {
    return {
      type: "setInternalVar",
      name: object.target.name,
      value,
    };
  }
  if (object.target.type === "lw") {
    return {
      type: "setLW",
      address: object.target.address,
      value,
    };
  }
  const indexed = resolveObjectTagField({
    object,
    fieldName: "target.tag",
    project,
    context,
    tagValues: tags,
    rawTagName: object.target.tag,
  });
  const resolvedTag = indexed.resolvedTagName ?? resolveTagName(object.target.tag, context) ?? object.target.tag;
  return {
    type: "write",
    tag: resolvedTag,
    value,
  };
}

function resolveObjectParameters(object: HmiObject, params: Record<string, unknown>): HmiObject {
  if (!Object.keys(params).length) {
    return object;
  }
  return resolveParameters(object, params) as HmiObject;
}

function withRuntimeActionContext(
  context: RenderContext,
  objectId: string,
  clickTs: number,
  objectName?: string,
): RenderContext {
  const runtimeObjectId = objectId.trim();
  const runtimeObjectScope = resolveRuntimeActionScope(context.parameters, runtimeObjectId);
  const resolvedObjectName = typeof objectName === "string" && objectName.trim() ? objectName.trim() : undefined;
  return {
    ...context,
    parameters: {
      ...(context.parameters ?? {}),
      __runtimeObjectId: runtimeObjectId,
      __runtimeObjectScope: runtimeObjectScope,
      __runtimeObjectName: resolvedObjectName,
      __actionClickTs: clickTs,
    },
  };
}

function withRuntimeScopeParameter(
  parameters: Record<string, unknown> | undefined,
  objectId: string,
): Record<string, unknown> {
  const runtimeObjectId = objectId.trim();
  const runtimeObjectScope = resolveRuntimeActionScope(parameters, runtimeObjectId);
  return {
    ...(parameters ?? {}),
    __runtimeObjectScope: runtimeObjectScope,
  };
}

function resolveRuntimeActionScope(
  parameters: Record<string, unknown> | undefined,
  objectId: string,
): string {
  const parentScope = typeof parameters?.__runtimeObjectScope === "string"
    ? parameters.__runtimeObjectScope.trim()
    : "";
  if (!parentScope) {
    return objectId;
  }
  return `${parentScope}>${objectId}`;
}

function hasRuntimeStateTag(tag: string | undefined): boolean {
  return Boolean(tag?.trim());
}

function resolveObjectVisible(object: HmiObject, tags: TagMap, context: RenderContext, project: ScadaProject): boolean {
  if (!hasRuntimeStateTag(object.visibleTag)) {
    return true;
  }
  const indexed = resolveObjectTagField({
    object,
    fieldName: "visibleTag",
    project,
    context,
    tagValues: tags,
    rawTagName: object.visibleTag,
  });
  const resolvedTag = indexed.resolvedTagName ?? resolveTagName(object.visibleTag, context);
  if (indexed.usedIndexedAddress && !indexed.resolvedTagName) {
    return false;
  }
  const value = resolvedTag ? tags[resolvedTag]?.value : undefined;
  const visible = runtimeValueToBoolean(value);
  return object.visibleInvert ? !visible : visible;
}

function resolveObjectDisabled(object: HmiObject, tags: TagMap, context: RenderContext, project: ScadaProject): boolean {
  if (!hasRuntimeStateTag(object.disabledTag)) {
    return false;
  }
  const indexed = resolveObjectTagField({
    object,
    fieldName: "disabledTag",
    project,
    context,
    tagValues: tags,
    rawTagName: object.disabledTag,
  });
  const resolvedTag = indexed.resolvedTagName ?? resolveTagName(object.disabledTag, context);
  if (indexed.usedIndexedAddress && !indexed.resolvedTagName) {
    return true;
  }
  const value = resolvedTag ? tags[resolvedTag]?.value : undefined;
  const disabled = runtimeValueToBoolean(value);
  return object.disabledInvert ? !disabled : disabled;
}

function runtimeValueToBoolean(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return false;
    }
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return numeric !== 0;
    }
    return false;
  }
  return false;
}

function renderBoxText(
  text: string,
  textStyle: TextStyle,
  options: {
    width: number;
    height: number;
    wrap?: "none" | "word" | "char";
    ellipsis?: boolean;
    xOffset?: number;
    yOffset?: number;
    opacity?: number;
    shadowProps?: Record<string, unknown>;
  },
) {
  const padding = textStyle.padding ?? 0;
  const hasShadowProps = Boolean(options.shadowProps && Object.keys(options.shadowProps).length > 0);
  return (
    <Text
      x={padding + (options.xOffset ?? 0)}
      y={padding + (options.yOffset ?? 0)}
      text={text}
      width={Math.max(0, options.width - padding * 2)}
      height={Math.max(0, options.height - padding * 2)}
      wrap={options.wrap ?? "word"}
      ellipsis={options.ellipsis ?? false}
      align={textStyle.horizontalAlign}
      verticalAlign={textStyle.verticalAlign}
      fill={textStyle.color}
      fontFamily={textStyle.fontFamily}
      fontSize={textStyle.fontSize}
      fontStyle={textStyle.fontStyle ?? "normal"}
      opacity={options.opacity ?? 1}
      listening={false}
      perfectDrawEnabled={hasShadowProps ? false : undefined}
      {...(options.shadowProps ?? {})}
    />
  );
}

type ImageLoadStatus = "idle" | "loading" | "loaded" | "error";

function useImage(src: string | undefined): { image: HTMLImageElement | undefined; status: ImageLoadStatus } {
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined);
  const [status, setStatus] = useState<ImageLoadStatus>("idle");

  useEffect(() => {
    if (!src) {
      setImage(undefined);
      setStatus("idle");
      return undefined;
    }

    const cached = imageCache.get(src);
    if (cached?.status === "loaded") {
      setImage(cached.image);
      setStatus("loaded");
      return undefined;
    }
    if (cached?.status === "error") {
      setImage(undefined);
      setStatus("error");
      return undefined;
    }

    let disposed = false;
    if (cached?.status === "loading") {
      setStatus("loading");
      cached.waiters.push((nextImage) => {
        if (!disposed) {
          setImage(nextImage);
          setStatus(nextImage ? "loaded" : "error");
        }
      });
      return () => {
        disposed = true;
      };
    }

    const waiters: Array<(nextImage: HTMLImageElement | undefined) => void> = [];
    imageCache.set(src, { status: "loading", waiters });
    setStatus("loading");

    const img = new window.Image();
    img.src = src;
    img.onload = () => {
      imageCache.set(src, { status: "loaded", image: img, waiters: [] });
      setImage(img);
      setStatus("loaded");
      for (const waiter of waiters) {
        waiter(img);
      }
    };
    img.onerror = () => {
      imageCache.set(src, { status: "error", waiters: [] });
      setImage(undefined);
      setStatus("error");
      for (const waiter of waiters) {
        waiter(undefined);
      }
    };
    return () => {
      disposed = true;
    };
  }, [src]);

  return { image, status };
}

type ImageCacheItem =
  | {
      status: "loaded";
      image: HTMLImageElement;
      waiters: Array<(nextImage: HTMLImageElement | undefined) => void>;
    }
  | {
      status: "loading";
      waiters: Array<(nextImage: HTMLImageElement | undefined) => void>;
    }
  | {
      status: "error";
      waiters: Array<(nextImage: HTMLImageElement | undefined) => void>;
    };

const imageCache = new Map<string, ImageCacheItem>();
