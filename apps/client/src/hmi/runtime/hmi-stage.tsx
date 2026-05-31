import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type {
  ElementLibrary,
  HmiObject,
  HmiScreen,
  RenderContext,
  RuntimeAction,
  ScadaProject,
  DriverStatus,
  TagValue,
} from "@web-scada/shared";
import { HmiRenderer, type NumericInputOpenPayload, type ObjectSelectPayload, type RuntimeOverlayState, type RuntimeWidgetOverlayState } from "./hmi-renderer";
import { sortObjectsByZIndex } from "../editor/z-order";

type TagMap = Record<string, TagValue>;

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HmiStageProps = {
  project: ScadaProject;
  mode: "editor" | "runtime";
  screen: HmiScreen;
  tags: TagMap;
  drivers?: DriverStatus[];
  libraries?: ElementLibrary[];
  renderContext?: RenderContext;
  selectedObjectIds?: string[];
  activeObjectId?: string;
  selectionRect?: SelectionRect;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onSelectObjects?: (objectIds: string[], activeObjectId?: string) => void;
  onSelectionRectChange?: (rect?: SelectionRect) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onMoveObjectEnd?: () => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void | Promise<void>;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  onEmptySpaceMouseDown?: (event: MouseEvent) => void;
  showObjectFrames?: boolean;
  fullscreenRuntime?: boolean;
  editorZoom?: number;
  showEditorGrid?: boolean;
  editorGridColor?: string;
  editorGridLineWidth?: number;
  editorGridLineStyle?: "solid" | "dashed" | "dotted" | "dashDot";
  currentUserRoleLevel?: number;
  onRequestNumericInput?: (state: NumericInputOpenPayload) => void;
  suspendEditorInteractions?: boolean;
};

export const OFFSCREEN_PAD = 2000;
const MIN_EDITOR_OFFSCREEN_PAD = 600;
const TARGET_VISIBLE_EDITOR_OFFSCREEN_PAD = 300;

export function getEditorOffscreenPad(editorZoom: number): number {
  if (!Number.isFinite(editorZoom) || editorZoom <= 0) {
    return OFFSCREEN_PAD;
  }
  return Math.min(
    OFFSCREEN_PAD,
    Math.max(MIN_EDITOR_OFFSCREEN_PAD, TARGET_VISIBLE_EDITOR_OFFSCREEN_PAD / editorZoom),
  );
}
const EMPTY_DRIVERS: DriverStatus[] = [];

export function HmiStage({
  project,
  mode,
  screen,
  tags,
  drivers = EMPTY_DRIVERS,
  libraries = [],
  renderContext = {},
  selectedObjectIds = [],
  activeObjectId,
  selectionRect,
  onSelectObject,
  onSelectObjects,
  onSelectionRectChange,
  onMoveObject,
  onMoveObjectEnd,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  onEmptySpaceMouseDown,
  showObjectFrames = false,
  fullscreenRuntime = false,
  editorZoom = 1,
  showEditorGrid = false,
  editorGridColor = "rgba(255, 255, 255, 0.08)",
  editorGridLineWidth = 1,
  editorGridLineStyle = "solid",
  currentUserRoleLevel,
  onRequestNumericInput,
  suspendEditorInteractions = false,
}: HmiStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [runtimeOverlay, setRuntimeOverlay] = useState<RuntimeOverlayState | null>(null);
  const [runtimeWidgetOverlays, setRuntimeWidgetOverlays] = useState<Record<string, RuntimeWidgetOverlayState>>({});

  const handleShowOverlay = useCallback((overlay: RuntimeOverlayState) => {
    setRuntimeOverlay(overlay);
  }, []);

  const handleHideOverlay = useCallback(() => {
    setRuntimeOverlay(null);
  }, []);

  const handleUpsertWidgetOverlay = useCallback((overlay: RuntimeWidgetOverlayState) => {
    setRuntimeWidgetOverlays((prev) => ({
      ...prev,
      [overlay.objectId]: overlay,
    }));
  }, []);

  const handleRemoveWidgetOverlay = useCallback((objectId: string) => {
    setRuntimeWidgetOverlays((prev) => {
      if (!prev[objectId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[objectId];
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (mode !== "runtime" || !runtimeOverlay) {
      return;
    }
    const onWindowMouseDown = (event: MouseEvent) => {
      const wrapElement = wrapRef.current;
      const target = event.target as Node | null;
      if (!wrapElement || !target) {
        return;
      }
      if (wrapElement.contains(target)) {
        return;
      }
      setRuntimeOverlay(null);
    };
    window.addEventListener("mousedown", onWindowMouseDown);
    return () => window.removeEventListener("mousedown", onWindowMouseDown);
  }, [mode, runtimeOverlay]);

  useEffect(() => {
    if (mode !== "runtime") {
      setRuntimeWidgetOverlays({});
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "editor") {
      return;
    }

    const stage = stageRef.current;
    const transformer = transformerRef.current;
    if (!stage || !transformer) {
      return;
    }

    const selectedNodes = selectedObjectIds
      .map((id) => stage.findOne(`#hmi-${id}`))
      .filter((node): node is Konva.Node => Boolean(node));

    const unlockedNodes = selectedNodes.filter((node) => {
      const id = node.id().replace("hmi-", "");
      const object = screen.objects.find((item) => item.id === id);
      if (!object || object.locked) {
        return false;
      }
      if (object.type === "group" && object.objects.some((child) => child.locked)) {
        return false;
      }
      return true;
    });

    transformer.nodes(unlockedNodes);
    transformer.getLayer()?.batchDraw();
  }, [mode, screen.objects, selectedObjectIds]);

  const runtimeScale = useMemo(() => {
    if (mode !== "runtime") {
      return 1;
    }
    return Math.min(1, Math.min(viewport.width / screen.width, viewport.height / screen.height));
  }, [mode, screen.height, screen.width, viewport.height, viewport.width]);

  const effectiveEditorZoom = mode === "editor" ? editorZoom : 1;
  const editorOffscreenPad = mode === "editor" ? getEditorOffscreenPad(effectiveEditorZoom) : 0;
  const effectiveRenderContext = useMemo(
    () => ({
      ...renderContext,
      userRoleLevel: currentUserRoleLevel ?? renderContext.userRoleLevel,
    }),
    [currentUserRoleLevel, renderContext],
  );
  const stageScale = mode === "runtime" ? runtimeScale : 1;
  const screenBackground = screen.background ?? "#1e1e1e";
  const stageWidth = mode === "editor"
    ? (screen.width + 2 * editorOffscreenPad) * effectiveEditorZoom
    : screen.width;
  const stageHeight = mode === "editor"
    ? (screen.height + 2 * editorOffscreenPad) * effectiveEditorZoom
    : screen.height;

  const gridPatternImage = useMemo(() => {
    if (mode !== "editor" || !showEditorGrid) {
      return null;
    }
    const dashByStyle: Record<NonNullable<HmiStageProps["editorGridLineStyle"]>, number[]> = {
      solid: [],
      dashed: [6, 4],
      dotted: [1, 3],
      dashDot: [8, 3, 1, 3],
    };
    const lineWidth = Number.isFinite(editorGridLineWidth) ? Math.min(6, Math.max(0.5, editorGridLineWidth)) : 1;
    const step = 24;
    const canvas = document.createElement("canvas");
    canvas.width = step;
    canvas.height = step;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.clearRect(0, 0, step, step);
    ctx.strokeStyle = editorGridColor;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashByStyle[editorGridLineStyle] ?? dashByStyle.solid);
    ctx.lineCap = "butt";
    const offset = lineWidth / 2;
    ctx.beginPath();
    ctx.moveTo(step - offset, 0);
    ctx.lineTo(step - offset, step);
    ctx.moveTo(0, step - offset);
    ctx.lineTo(step, step - offset);
    ctx.stroke();
    return canvas;
  }, [editorGridColor, editorGridLineStyle, editorGridLineWidth, mode, showEditorGrid]);

  const selectedObjects = screen.objects.filter((item) => selectedObjectIds.includes(item.id));
  const minWidth = Math.min(...selectedObjects.map((item) => item.minWidth ?? 8), 8);
  const minHeight = Math.min(...selectedObjects.map((item) => item.minHeight ?? 8), 8);

  const toEditorCoords = (pointer: { x: number; y: number }): { x: number; y: number } => {
    if (mode !== "editor") {
      return pointer;
    }
    return {
      x: pointer.x / effectiveEditorZoom - editorOffscreenPad,
      y: pointer.y / effectiveEditorZoom - editorOffscreenPad,
    };
  };

  const onStageMouseDown = (evt: KonvaEventObject<MouseEvent>): void => {
    if (mode === "runtime" && runtimeOverlay) {
      const openedObjectId = `hmi-${runtimeOverlay.objectId}`;
      let node: Konva.Node | null = evt.target;
      let clickedInsideOpenedObject = false;
      while (node) {
        if (node.id() === openedObjectId) {
          clickedInsideOpenedObject = true;
          break;
        }
        node = node.getParent();
      }
      if (!clickedInsideOpenedObject) {
        setRuntimeOverlay(null);
      }
    }

    if (mode !== "editor") {
      return;
    }
    const stage = evt.target.getStage();
    if (!stage || evt.target !== stage) {
      return;
    }
    if (evt.evt.button === 2) {
      onEmptySpaceMouseDown?.(evt.evt);
      return;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }
    const stagePoint = toEditorCoords(pointer);
    dragStartRef.current = stagePoint;
    onSelectionRectChange?.({
      x: stagePoint.x,
      y: stagePoint.y,
      width: 0,
      height: 0,
    });

    if (!evt.evt.ctrlKey && !evt.evt.metaKey && !evt.evt.shiftKey) {
      onSelectObjects?.([], undefined);
    }
  };

  const onStageMouseMove = (evt: KonvaEventObject<MouseEvent>): void => {
    if (mode !== "editor") {
      return;
    }
    const start = dragStartRef.current;
    if (!start) {
      return;
    }
    const stage = evt.target.getStage();
    if (!stage) {
      return;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }
    const stagePoint = toEditorCoords(pointer);
    onSelectionRectChange?.({
      x: Math.min(start.x, stagePoint.x),
      y: Math.min(start.y, stagePoint.y),
      width: Math.abs(stagePoint.x - start.x),
      height: Math.abs(stagePoint.y - start.y),
    });
  };

  const onStageMouseUp = (): void => {
    if (mode !== "editor") {
      return;
    }
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || !selectionRect || selectionRect.width < 3 || selectionRect.height < 3) {
      onSelectionRectChange?.(undefined);
      return;
    }

    const sorted = sortObjectsByZIndex(screen.objects);
    const hitIds = sorted
      .filter((obj) => intersectsRect(selectionRect, { x: obj.x, y: obj.y, width: obj.width, height: obj.height }))
      .map((obj) => obj.id);
    onSelectObjects?.(hitIds, hitIds[hitIds.length - 1]);
    onSelectionRectChange?.(undefined);
  };

  useEffect(() => {
    if (!import.meta.env.DEV || mode !== "editor") {
      return;
    }
    const viewportWidth = wrapRef.current?.clientWidth ?? 0;
    const viewportHeight = wrapRef.current?.clientHeight ?? 0;
    // eslint-disable-next-line no-console
    console.debug("[Editor Canvas]", {
      screenId: screen.id,
      screenName: screen.name,
      screenSize: [screen.width, screen.height],
      objects: screen.objects.length,
      viewport: [viewportWidth, viewportHeight],
      stageSize: [stageWidth, stageHeight],
      zoom: mode === "editor" ? effectiveEditorZoom : runtimeScale,
    });
    if (viewportWidth === 0 || viewportHeight === 0) {
      // eslint-disable-next-line no-console
      console.warn("[Editor Canvas] zero viewport size detected", {
        viewportWidth,
        viewportHeight,
      });
    }
  }, [effectiveEditorZoom, mode, runtimeScale, screen.height, screen.id, screen.name, screen.objects.length, screen.width, stageHeight, stageWidth]);

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      style={{
        width: mode === "runtime" && fullscreenRuntime ? "100%" : undefined,
        height: mode === "runtime" && fullscreenRuntime ? "100%" : undefined,
        overflow: mode === "editor" ? "visible" : (fullscreenRuntime ? "hidden" : "auto"),
        display: mode === "editor" ? "inline-block" : "block",
        border: mode === "runtime" ? "none" : undefined,
        maxWidth: mode === "runtime" ? "100%" : undefined,
        maxHeight: mode === "runtime" ? "100%" : undefined,
        position: "relative",
      }}
    >
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        scaleX={stageScale}
        scaleY={stageScale}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
      >
        <Layer listening={!(mode === "editor" && suspendEditorInteractions)} hitGraphEnabled={!(mode === "editor" && suspendEditorInteractions)}>
          {mode === "editor" ? (
            <Group
              x={editorOffscreenPad * effectiveEditorZoom}
              y={editorOffscreenPad * effectiveEditorZoom}
              scaleX={effectiveEditorZoom}
              scaleY={effectiveEditorZoom}
            >
              <Rect x={0} y={0} width={screen.width} height={screen.height} fill={screenBackground} listening={false} />
              {showEditorGrid && gridPatternImage ? (
                <Rect
                  x={0}
                  y={0}
                  width={screen.width}
                  height={screen.height}
                  fillPatternImage={gridPatternImage as unknown as HTMLImageElement}
                  fillPatternRepeat="repeat"
                  listening={false}
                />
              ) : null}
              <HmiRenderer
                project={project}
                screen={screen}
                mode={mode}
                tags={tags}
                drivers={drivers}
                libraries={libraries}
                renderContext={effectiveRenderContext}
                selectedObjectIds={selectedObjectIds}
                onSelectObject={onSelectObject}
                onMoveObject={onMoveObject}
                onCommitObjectMove={onMoveObjectEnd}
                onResizeObject={onResizeObject}
                onAction={onAction}
                onDoubleClickObject={onDoubleClickObject}
                onContextMenuObject={onContextMenuObject}
                showObjectFrames={showObjectFrames}
                overlayState={runtimeOverlay}
                onShowOverlay={handleShowOverlay}
                onHideOverlay={handleHideOverlay}
                onUpsertWidgetOverlay={handleUpsertWidgetOverlay}
                onRemoveWidgetOverlay={handleRemoveWidgetOverlay}
                onRequestNumericInput={onRequestNumericInput}
                renderFlowMode="all"
              />
              {selectionRect ? (
                <Rect
                  x={selectionRect.x}
                  y={selectionRect.y}
                  width={selectionRect.width}
                  height={selectionRect.height}
                  stroke="#69c0ff"
                  dash={[4, 3]}
                  fill="rgba(105,192,255,0.12)"
                  listening={false}
                />
              ) : null}
              <Transformer
                ref={transformerRef}
                rotateEnabled
                enabledAnchors={[
                  "top-left",
                  "top-center",
                  "top-right",
                  "middle-left",
                  "middle-right",
                  "bottom-left",
                  "bottom-center",
                  "bottom-right",
                ]}
                boundBoxFunc={(_, newBox) => {
                  if (newBox.width < minWidth || newBox.height < minHeight) {
                    return {
                      ...newBox,
                      width: Math.max(newBox.width, minWidth),
                      height: Math.max(newBox.height, minHeight),
                    };
                  }
                  return newBox;
                }}
              />
            </Group>
          ) : (
            <>
              <Rect x={0} y={0} width={screen.width} height={screen.height} fill={screenBackground} listening={false} />
              <HmiRenderer
                project={project}
                screen={screen}
                mode={mode}
                tags={tags}
                drivers={drivers}
                libraries={libraries}
                renderContext={effectiveRenderContext}
                selectedObjectIds={selectedObjectIds}
                onSelectObject={onSelectObject}
                onMoveObject={onMoveObject}
                onCommitObjectMove={onMoveObjectEnd}
                onResizeObject={onResizeObject}
                onAction={onAction}
                onDoubleClickObject={onDoubleClickObject}
                onContextMenuObject={onContextMenuObject}
                showObjectFrames={showObjectFrames}
                overlayState={runtimeOverlay}
                onShowOverlay={handleShowOverlay}
                onHideOverlay={handleHideOverlay}
                onUpsertWidgetOverlay={handleUpsertWidgetOverlay}
                onRemoveWidgetOverlay={handleRemoveWidgetOverlay}
                onRequestNumericInput={onRequestNumericInput}
                renderFlowMode="all"
              />
            </>
          )}
        </Layer>
      </Stage>
      {runtimeOverlay ? (
        <div
          className="hmi-runtime-overlay"
          style={{
            position: "absolute",
            left: runtimeOverlay.x,
            top: runtimeOverlay.y,
            width: runtimeOverlay.width,
            height: runtimeOverlay.height,
            zIndex: 1000,
          }}
        >
          {runtimeOverlay.content}
        </div>
      ) : null}
      {mode === "runtime"
        ? Object.values(runtimeWidgetOverlays).map((overlay) => (
            <div
              key={overlay.objectId}
              className="hmi-runtime-widget-overlay"
              style={{
                position: "absolute",
                left: overlay.x * stageScale,
                top: overlay.y * stageScale,
                width: overlay.width * stageScale,
                height: overlay.height * stageScale,
                zIndex: 910,
              }}
            >
              {overlay.content}
            </div>
          ))
        : null}
    </div>
  );
}

function intersectsRect(a: SelectionRect, b: SelectionRect): boolean {
  return !(
    a.x > b.x + b.width ||
    a.x + a.width < b.x ||
    a.y > b.y + b.height ||
    a.y + a.height < b.y
  );
}
