import { memo, useEffect, useMemo, useState } from "react";
import { Circle, Group, Image as KonvaImage, Line, Rect, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  combineTagPrefix,
  resolveLibraryElementInstanceBindings,
  type ElementStateAction,
  type ElementStateCase,
  type ElementStateRule,
  resolveParameters,
  resolveTemplateString,
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
  type ScadaProject,
  type StateImageCondition,
  type TagValue,
  type TextStyle,
} from "@web-scada/shared";

type TagMap = Record<string, TagValue>;

export type ObjectSelectPayload = {
  objectId: string;
  additive: boolean;
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
  selectedObjectIds?: string[];
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames?: boolean;
  scopedAssets?: Record<string, Asset>;
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
  selected: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames: boolean;
  scopedAssets?: Record<string, Asset>;
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
  selectedObjectIds = [],
  onSelectObject,
  onMoveObject,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames = false,
  scopedAssets,
}: HmiRendererProps) {
  const selectedSet = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds]);
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
      {screen.objects.map((object) => (
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
          selected={selectedSet.has(object.id)}
          onSelectObject={onSelectObject}
          onMoveObject={onMoveObject}
          onResizeObject={onResizeObject}
          onAction={onAction}
          onDoubleClickObject={onDoubleClickObject}
          onContextMenuObject={onContextMenuObject}
          showObjectFrames={showObjectFrames}
          scopedAssets={scopedAssets}
        />
      ))}
    </>
  );
}

const MemoObjectNode = memo(ObjectNode, areObjectNodePropsEqual);

function areObjectNodePropsEqual(prev: BaseNodeProps, next: BaseNodeProps): boolean {
  if (prev.object !== next.object) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.interactive !== next.interactive) return false;
  if (prev.showObjectFrames !== next.showObjectFrames) return false;
  if (prev.mode !== next.mode) return false;
  if (prev.renderContext.tagPrefix !== next.renderContext.tagPrefix) return false;
  if (prev.renderContext.parameters !== next.renderContext.parameters) return false;

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

  if (object.type === "group") {
    const tags = new Set<string>();
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
  switch (object.type) {
    case "value-display":
    case "value-input":
    case "state-indicator":
    case "switch":
    case "stateImage":
      candidates.push(object.tag);
      break;
    case "image":
      candidates.push(object.stateTag);
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
  selected,
  onSelectObject,
  onMoveObject,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames,
  scopedAssets,
}: BaseNodeProps) {
  const resolvedObject = useMemo(() => resolveObjectParameters(object, renderContext.parameters ?? {}), [object, renderContext.parameters]);
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

  const tagValue = (name: string | undefined): TagValue | undefined => {
    const resolved = resolveTagName(name, renderContext);
    return resolved ? tags[resolved] : undefined;
  };

  const selectable = interactive;

  const commonGroupProps = {
    id: `hmi-${resolvedObject.id}`,
    x: resolvedObject.x,
    y: resolvedObject.y,
    rotation: resolvedObject.rotation ?? 0,
    visible: resolvedObject.visible ?? true,
    draggable: interactive && !resolvedObject.locked,
    onClick: (evt: KonvaEventObject<MouseEvent>) => {
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
    onDragEnd: (evt: KonvaEventObject<DragEvent>) => {
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
        selected={selected}
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onResizeObject={onResizeObject}
        onAction={onAction}
        onDoubleClickObject={onDoubleClickObject}
        onContextMenuObject={onContextMenuObject}
        showObjectFrames={showObjectFrames}
        scopedAssets={scopedAssets}
        groupProps={commonGroupProps}
      />
    );
  }

  if (resolvedObject.type === "text") {
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        {renderBoxText(resolvedObject.text, resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
        })}
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "line") {
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Line points={resolvedObject.points} stroke={resolvedObject.stroke} strokeWidth={resolvedObject.strokeWidth} />
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "rectangle") {
    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect
          width={resolvedObject.width}
          height={resolvedObject.height}
          fill={resolvedObject.fill}
          stroke={resolvedObject.stroke}
          strokeWidth={resolvedObject.strokeWidth}
          cornerRadius={resolvedObject.cornerRadius}
        />
        <SelectionOutline object={resolvedObject} selected={selected || showObjectFrames} />
      </Group>
    );
  }

  if (resolvedObject.type === "value-display") {
    const value = tagValue(resolvedObject.tag);
    const text = !value
      ? "---"
      : value.quality === "Bad"
        ? resolvedObject.badQualityText ?? "BAD"
        : `${value.value ?? "---"}${resolvedObject.suffix ?? ""}`;

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
    const value = tagValue(resolvedObject.tag)?.value;
    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          onAction?.(
            {
              type: "writeNumberPrompt",
              target: "tag",
              name: resolvedObject.tag,
              min: resolvedObject.min,
              max: resolvedObject.max,
              confirm: resolvedObject.confirm,
              confirmText: resolvedObject.confirmText,
            },
            renderContext,
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill="#141414" stroke="#595959" cornerRadius={4} />
        {renderBoxText(`${value ?? "--"}${resolvedObject.suffix ?? ""}`, resolvedObject.textStyle, {
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
    const value = tagValue(resolvedObject.tag);
    const isBad = !value || value.quality === "Bad";
    const boolValue = Boolean(value?.value);
    const fill = isBad ? resolvedObject.badColor : boolValue ? resolvedObject.trueColor : resolvedObject.falseColor;
    const text = isBad ? "BAD" : boolValue ? resolvedObject.trueText : resolvedObject.falseText;

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill={fill} cornerRadius={8} />
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
        forceFrame={showObjectFrames}
      />
    );
  }

  if (resolvedObject.type === "switch") {
    const isOn = Boolean(tagValue(resolvedObject.tag)?.value);
    return (
      <Group
        {...commonGroupProps}
        onClick={(evt: KonvaEventObject<MouseEvent>) => {
          if (interactive) {
            onSelectObject?.({
              objectId: resolvedObject.id,
              additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
            });
            return;
          }
          onAction?.(
            {
              type: "write",
              tag: resolvedObject.tag,
              value: !isOn,
            },
            renderContext,
          );
        }}
      >
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill={isOn ? "#389e0d" : "#434343"} cornerRadius={8} />
        {renderBoxText(isOn ? resolvedObject.onText ?? "ON" : resolvedObject.offText ?? "OFF", resolvedObject.textStyle, {
          width: resolvedObject.width,
          height: resolvedObject.height,
          wrap: resolvedObject.wrap,
          ellipsis: resolvedObject.ellipsis,
        })}
        <SelectionOutline object={resolvedObject} selected={selected} />
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
        stateValue={resolvedObject.stateTag ? tagValue(resolvedObject.stateTag)?.value : undefined}
        interactive={interactive}
        onSelectObject={onSelectObject}
        onAction={onAction}
        renderContext={renderContext}
        forceFrame={showObjectFrames}
      />
    );
  }

  if (resolvedObject.type === "stateImage") {
    const tag = tagValue(resolvedObject.tag);
    const stateAssetId = selectStateImageAssetId(resolvedObject.states, tag?.value);
    const activeAssetId = tag?.quality === "Bad" ? (resolvedObject.badQualityAssetId ?? stateAssetId ?? resolvedObject.defaultAssetId) : (stateAssetId ?? resolvedObject.defaultAssetId);
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
        forceFrame={showObjectFrames}
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
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onResizeObject={onResizeObject}
        onAction={onAction}
        commonGroupProps={commonGroupProps}
      />
    );
  }

  if (resolvedObject.type === "valve") {
    const open = Boolean(tagValue(resolvedObject.openTag)?.value);
    const closed = Boolean(tagValue(resolvedObject.closedTag)?.value);
    const fault = Boolean(tagValue(resolvedObject.errorTag)?.value);
    const color = fault ? "#d9363e" : open ? "#73d13d" : closed ? "#1677ff" : "#faad14";

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill="#141414" stroke="#595959" cornerRadius={8} />
        <Line points={[20, 20, resolvedObject.width - 20, resolvedObject.height - 20]} stroke={color} strokeWidth={6} />
        <Line points={[resolvedObject.width - 20, 20, 20, resolvedObject.height - 20]} stroke={color} strokeWidth={6} />
        {renderBoxText(resolvedObject.label ?? "Valve", resolvedObject.textStyle, { width: resolvedObject.width, height: resolvedObject.height })}
        <SelectionOutline object={resolvedObject} selected={selected} />
      </Group>
    );
  }

  if (resolvedObject.type === "pump") {
    const run = Boolean(tagValue(resolvedObject.runTag)?.value);
    const fault = Boolean(tagValue(resolvedObject.faultTag)?.value);
    const color = fault ? "#ff4d4f" : run ? "#52c41a" : "#8c8c8c";

    return (
      <Group {...commonGroupProps}>
        <SelectionHitArea object={resolvedObject} enabled={interactive} />
        <Rect width={resolvedObject.width} height={resolvedObject.height} fill="#141414" stroke="#595959" cornerRadius={8} />
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
      />
    );
  }

  return <Group {...commonGroupProps} />;
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
  selected,
  onSelectObject,
  onMoveObject,
  onResizeObject,
  onAction,
  onDoubleClickObject,
  onContextMenuObject,
  showObjectFrames,
  scopedAssets,
  groupProps,
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
  selected: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  onDoubleClickObject?: (objectId: string) => void;
  onContextMenuObject?: (payload: { objectId: string; clientX: number; clientY: number; additive: boolean }) => void;
  showObjectFrames: boolean;
  scopedAssets?: Record<string, Asset>;
  groupProps: Record<string, unknown>;
}) {
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
        renderContext={renderContext}
        frameStack={frameStack}
        instanceStack={instanceStack}
        interactive={false}
        onSelectObject={onSelectObject}
        onMoveObject={onMoveObject}
        onResizeObject={onResizeObject}
        onAction={onAction}
        onDoubleClickObject={onDoubleClickObject}
        onContextMenuObject={onContextMenuObject}
        showObjectFrames={showObjectFrames}
        scopedAssets={scopedAssets}
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
  onResizeObject,
  onAction,
  commonGroupProps,
  scopedAssets,
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
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  commonGroupProps: Record<string, unknown>;
  scopedAssets?: Record<string, Asset>;
}) {
  const screen = project.screens.find((item) => item.id === object.screenId);
  const hasCycle = frameStack.includes(object.screenId);

  const context: RenderContext = {
    tagPrefix: combineTagPrefix(renderContext.tagPrefix, object.tagPrefix),
    parameters: renderContext.parameters,
    bindings: renderContext.bindings,
  };

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
          onSelectObject={onSelectObject}
          onMoveObject={onMoveObject}
          onResizeObject={onResizeObject}
          onAction={onAction}
          scopedAssets={scopedAssets}
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
  onSelectObject,
  onMoveObject,
  onResizeObject,
  onAction,
  commonGroupProps,
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
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  commonGroupProps: Record<string, unknown>;
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
  const context: RenderContext = {
    tagPrefix: combineTagPrefix(renderContext.tagPrefix, object.tagPrefix),
    parameters: { ...(renderContext.parameters ?? {}), ...instanceParams },
    bindings: {
      ...(renderContext.bindings ?? {}),
      ...resolveLibraryElementInstanceBindings(element, object),
    },
  };
  const resolvedObjects = useMemo(
    () => applyElementStateRules(element.objects, element.stateRules ?? [], context, tags),
    [context, element.objects, element.stateRules, tags],
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

  return (
    <Group {...commonGroupProps}>
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
          onSelectObject={onSelectObject}
          onMoveObject={onMoveObject}
          onResizeObject={onResizeObject}
          onAction={onAction}
          scopedAssets={scopedAssets}
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
  forceFrame = false,
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
  forceFrame?: boolean;
}) {
  const stateEntry = object.stateImages?.find((item) => String(item.state) === String(stateValue));
  const stateSrc = stateEntry?.src;
  const stateAssetId = stateEntry?.assetId;
  const activeAssetId = stateAssetId ?? object.assetId;
  const source =
    stateSrc ??
    resolveAssetUrl(activeAssetId, {
      projectAssets: project.assets ?? [],
      scopedAssets,
      libraries,
    }) ??
    object.src;
  const { image, status: imageStatus } = useImage(source);
  const placement = useMemo(
    () => computeImagePlacement(object.width, object.height, image?.width, image?.height, object.fit),
    [image?.height, image?.width, object.fit, object.height, object.width],
  );

  return (
    <Group
      {...groupProps}
      opacity={object.opacity ?? 1}
      onClick={(evt: KonvaEventObject<MouseEvent>) => {
        if (interactive) {
          onSelectObject?.({
            objectId: object.id,
            additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
          });
          return;
        }
        if (object.action) {
          onAction?.(object.action, renderContext);
        }
      }}
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
        />
      ) : source && imageStatus === "loading" ? null : (
        <>
          <Rect width={object.width} height={object.height} stroke="#434343" dash={[4, 3]} />
          <Text
            text={source ? (activeAssetId ? `Asset not found: ${activeAssetId}` : "Failed to load image") : "Image source is empty"}
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
  forceFrame = false,
}: {
  object: Extract<HmiObject, { type: "button" }>;
  selected: boolean;
  groupProps: Record<string, unknown>;
  project: ScadaProject;
  libraries: ElementLibrary[];
  scopedAssets?: Record<string, Asset>;
  interactive: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  renderContext: RenderContext;
  forceFrame?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
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
  const currentSrc = pressed && pressedSrc ? pressedSrc : normalSrc;
  const { image } = useImage(currentSrc);
  const placement = useMemo(
    () => computeImagePlacement(object.width, object.height, image?.width, image?.height, "stretch"),
    [image?.height, image?.width, object.height, object.width],
  );

  return (
    <Group
      {...groupProps}
      onMouseDown={() => {
        if (!interactive) {
          setPressed(true);
        }
      }}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={(evt: KonvaEventObject<MouseEvent>) => {
        if (interactive) {
          onSelectObject?.({
            objectId: object.id,
            additive: evt.evt.ctrlKey || evt.evt.metaKey || evt.evt.shiftKey,
          });
          return;
        }
        onAction?.(object.action, renderContext);
      }}
    >
      <Rect
        width={object.width}
        height={object.height}
        fill={object.backgroundColor ?? "#0958d9"}
        stroke={object.borderColor}
        strokeWidth={object.borderWidth ?? 0}
        cornerRadius={6}
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

function toResolvedParameterMap(element: LibraryElement, values?: Record<string, unknown>): Record<string, unknown> {
  const defaults = Object.fromEntries((element.parameters ?? []).map((item) => [item.name, item.defaultValue]));
  return { ...defaults, ...(values ?? {}) };
}

function applyElementStateRules(
  objects: HmiObject[],
  rules: ElementStateRule[],
  context: RenderContext,
  tags: TagMap,
): HmiObject[] {
  if (!rules.length) {
    return objects;
  }

  const cloned = structuredClone(objects) as HmiObject[];
  for (const rule of rules) {
    const sourceValue = resolveRuleSourceValue(rule, context, tags);
    const matchingCase = rule.cases.find((candidate) => matchesStateCase(candidate, sourceValue));
    if (!matchingCase) {
      continue;
    }
    for (const action of matchingCase.actions) {
      applyStateAction(cloned, action, context);
    }
  }

  return cloned;
}

function resolveRuleSourceValue(rule: ElementStateRule, context: RenderContext, tags: TagMap): unknown {
  if (rule.source.type === "parameter") {
    return context.parameters?.[rule.source.value];
  }

  if (rule.source.type === "expression") {
    return context.parameters?.[rule.source.value];
  }

  const resolvedTagTemplate = resolveTemplateString(rule.source.value, context.parameters ?? {});
  const tagName = resolveTagName(resolvedTagTemplate, context);
  if (!tagName) {
    return undefined;
  }
  return tags[tagName]?.value;
}

function matchesStateCase(stateCase: ElementStateCase, sourceValue: unknown): boolean {
  const condition = stateCase.condition;

  if (condition.type === "true") {
    return Boolean(sourceValue);
  }
  if (condition.type === "false") {
    return !Boolean(sourceValue);
  }
  if (condition.type === "equals") {
    return String(sourceValue) === String(condition.value);
  }
  if (condition.type === "notEquals") {
    return String(sourceValue) !== String(condition.value);
  }

  const numericValue = Number(sourceValue);
  if (!Number.isFinite(numericValue)) {
    return false;
  }

  if (condition.type === "greaterThan") {
    return numericValue > condition.value;
  }
  if (condition.type === "lessThan") {
    return numericValue < condition.value;
  }
  if (condition.type === "between") {
    return numericValue >= condition.min && numericValue <= condition.max;
  }

  return false;
}

function applyStateAction(objects: HmiObject[], action: ElementStateAction, context: RenderContext): boolean {
  for (let index = 0; index < objects.length; index += 1) {
    const current = objects[index]!;
    if (current.id === action.objectId) {
      objects[index] = patchObjectByStateAction(current, action, context);
      return true;
    }
    if (current.type === "group") {
      const foundInChildren = applyStateAction(current.objects, action, context);
      if (foundInChildren) {
        return true;
      }
    }
  }
  return false;
}

function patchObjectByStateAction(object: HmiObject, action: ElementStateAction, context: RenderContext): HmiObject {
  if (action.type === "setVisible") {
    return { ...object, visible: action.visible };
  }

  if (action.type === "setAsset") {
    const nextAssetId = resolveTemplateString(action.assetId, context.parameters ?? {});
    if (object.type === "image") {
      return { ...object, assetId: nextAssetId };
    }
    if (object.type === "stateImage") {
      return { ...object, defaultAssetId: nextAssetId };
    }
    return object;
  }

  if (action.type === "setText") {
    const nextText = resolveTemplateString(action.text, context.parameters ?? {});
    if ("text" in object) {
      return { ...object, text: nextText } as HmiObject;
    }
    return object;
  }

  if (action.type === "setFill") {
    if (object.type === "rectangle") {
      return { ...object, fill: action.color };
    }
    return object;
  }

  if (action.type === "setStroke") {
    if (object.type === "rectangle") {
      return { ...object, stroke: action.color };
    }
    if (object.type === "line") {
      return { ...object, stroke: action.color };
    }
    return object;
  }

  return object;
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

function resolveObjectParameters(object: HmiObject, params: Record<string, unknown>): HmiObject {
  if (!Object.keys(params).length) {
    return object;
  }
  return resolveParameters(object, params) as HmiObject;
}

function renderBoxText(
  text: string,
  textStyle: TextStyle,
  options: {
    width: number;
    height: number;
    wrap?: "none" | "word" | "char";
    ellipsis?: boolean;
  },
) {
  const padding = textStyle.padding ?? 0;
  return (
    <Text
      x={padding}
      y={padding}
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
      listening={false}
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
