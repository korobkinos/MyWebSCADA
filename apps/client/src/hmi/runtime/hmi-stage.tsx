import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type {
  ElementLibrary,
  HmiObject,
  HmiScreen,
  RenderContext,
  RuntimeAction,
  ScadaProject,
  TagValue,
} from "@web-scada/shared";
import { HmiRenderer, type ObjectSelectPayload } from "./hmi-renderer";

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
  libraries?: ElementLibrary[];
  renderContext?: RenderContext;
  selectedObjectIds?: string[];
  activeObjectId?: string;
  selectionRect?: SelectionRect;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onSelectObjects?: (objectIds: string[], activeObjectId?: string) => void;
  onSelectionRectChange?: (rect?: SelectionRect) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames?: boolean;
  fullscreenRuntime?: boolean;
  editorZoom?: number;
  currentUserRoleLevel?: number;
};

export function HmiStage({
  project,
  mode,
  screen,
  tags,
  libraries = [],
  renderContext = {},
  selectedObjectIds = [],
  activeObjectId,
  selectionRect,
  onSelectObject,
  onSelectObjects,
  onSelectionRectChange,
  onMoveObject,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames = false,
  fullscreenRuntime = false,
  editorZoom = 1,
  currentUserRoleLevel,
}: HmiStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  const effectiveEditorZoom = mode === "editor" ? Math.min(3, Math.max(0.1, editorZoom)) : 1;
  const stageScale = mode === "runtime" ? runtimeScale : effectiveEditorZoom;
  const stageWidth = mode === "editor" ? screen.width * effectiveEditorZoom : screen.width;
  const stageHeight = mode === "editor" ? screen.height * effectiveEditorZoom : screen.height;

  const selectedObjects = screen.objects.filter((item) => selectedObjectIds.includes(item.id));
  const minWidth = Math.min(...selectedObjects.map((item) => item.minWidth ?? 8), 8);
  const minHeight = Math.min(...selectedObjects.map((item) => item.minHeight ?? 8), 8);

  const toEditorCoords = (pointer: { x: number; y: number }): { x: number; y: number } => {
    if (mode !== "editor") {
      return pointer;
    }
    return {
      x: pointer.x / effectiveEditorZoom,
      y: pointer.y / effectiveEditorZoom,
    };
  };

  const onStageMouseDown = (evt: KonvaEventObject<MouseEvent>): void => {
    if (mode !== "editor") {
      return;
    }
    const stage = evt.target.getStage();
    if (!stage || evt.target !== stage) {
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

    const hitIds = screen.objects
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
        overflow: mode === "editor" ? "visible" : "auto",
        display: mode === "editor" ? "inline-block" : "block",
        border: mode === "runtime" ? "none" : undefined,
        maxWidth: mode === "runtime" ? "100%" : undefined,
        maxHeight: mode === "runtime" ? "100%" : undefined,
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
        <Layer>
          <Rect x={0} y={0} width={screen.width} height={screen.height} fill={screen.background ?? "#1e1e1e"} listening={false} />
          <HmiRenderer
            project={project}
            screen={screen}
            mode={mode}
            tags={tags}
            libraries={libraries}
            renderContext={{
              ...renderContext,
              userRoleLevel: currentUserRoleLevel ?? renderContext.userRoleLevel,
            }}
            selectedObjectIds={selectedObjectIds}
            onSelectObject={onSelectObject}
            onMoveObject={onMoveObject}
            onResizeObject={onResizeObject}
            onAction={onAction}
            onDoubleClickObject={onDoubleClickObject}
            onContextMenuObject={onContextMenuObject}
            showObjectFrames={showObjectFrames}
          />

          {mode === "editor" && selectionRect ? (
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

          {mode === "editor" ? (
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
          ) : null}
        </Layer>
      </Stage>
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
