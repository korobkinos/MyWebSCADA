import { memo, useEffect, useMemo, useState } from "react";
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

type TagMap = Record<string, TagValue>;
type ResolvedTagValue = {
  resolvedName?: string;
  value?: TagValue;
  missingBindingReference: boolean;
  missingIndexedTag?: boolean;
  indexedAddress?: string;
};

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
  inheritedDisabled?: boolean;
  selectedObjectIds?: string[];
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void | Promise<void>;
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
  inheritedDisabled: boolean;
  selected: boolean;
  onSelectObject?: (payload: ObjectSelectPayload) => void;
  onMoveObject?: (objectId: string, x: number, y: number) => void;
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void | Promise<void>;
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
  inheritedDisabled = false,
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
          inheritedDisabled={inheritedDisabled}
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
  if (prev.inheritedDisabled !== next.inheritedDisabled) return false;
  if (prev.showObjectFrames !== next.showObjectFrames) return false;
  if (prev.mode !== next.mode) return false;
  if (prev.renderContext.tagPrefix !== next.renderContext.tagPrefix) return false;
  if (prev.renderContext.parameters !== next.renderContext.parameters) return false;
  if (prev.renderContext.isAuthenticated !== next.renderContext.isAuthenticated) return false;
  if (prev.renderContext.userRoleLevel !== next.renderContext.userRoleLevel) return false;
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
  inheritedDisabled,
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
  const runtimeMode = mode === "runtime";
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
    };
  };

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

  const commonGroupProps = {
    id: `hmi-${resolvedObject.id}`,
    x: resolvedObject.x,
    y: resolvedObject.y,
    rotation: resolvedObject.rotation ?? 0,
    opacity: resolvedObject.opacity ?? 1,
    visible: (resolvedObject.visible ?? true) && visibleByRole,
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
        inheritedDisabled={runtimeDisabled}
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
        <Line
          points={resolvedObject.points}
          stroke={resolvedObject.stroke}
          strokeWidth={resolvedObject.strokeWidth}
          closed={resolvedObject.closed ?? false}
          fill={resolvedObject.fill}
        />
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
        runtimeDisabled={runtimeDisabled}
        forceFrame={showObjectFrames}
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
          fill={runtimeDisabled ? "#4a4a4a" : fillColor}
          stroke={resolvedObject.borderColor}
          strokeWidth={resolvedObject.borderWidth ?? 0}
          cornerRadius={8}
          opacity={runtimeDisabled ? 0.65 : 1}
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
      />
    );
  }

  if (resolvedObject.type === "valve") {
    const open = runtimeMode ? Boolean(tagValue(resolvedObject.openTag, { useObjectIndexing: true, fieldName: "openTag" }).value?.value) : false;
    const closed = runtimeMode ? Boolean(tagValue(resolvedObject.closedTag, { useObjectIndexing: true, fieldName: "closedTag" }).value?.value) : false;
    const fault = runtimeMode ? Boolean(tagValue(resolvedObject.errorTag, { useObjectIndexing: true, fieldName: "errorTag" }).value?.value) : false;
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
    const run = runtimeMode ? Boolean(tagValue(resolvedObject.runTag, { useObjectIndexing: true, fieldName: "runTag" }).value?.value) : false;
    const fault = runtimeMode ? Boolean(tagValue(resolvedObject.faultTag, { useObjectIndexing: true, fieldName: "faultTag" }).value?.value) : false;
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
        inheritedDisabled={runtimeDisabled}
      />
    );
  }

  return <Group {...commonGroupProps} />;
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
  inheritedDisabled: boolean;
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
  inheritedDisabled,
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
  inheritedDisabled: boolean;
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
  inheritedDisabled,
  onSelectObject,
  onMoveObject,
  onResizeObject,
  onAction,
  commonGroupProps,
  runtimeDisabled,
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
  onResizeObject?: (objectId: string, patch: Partial<HmiObject>) => void;
  onAction?: (action: RuntimeAction, context: RenderContext) => void;
  commonGroupProps: Record<string, unknown>;
  runtimeDisabled: boolean;
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
  runtimeDisabled,
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
  runtimeDisabled: boolean;
  forceFrame?: boolean;
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
          <Rect width={object.width} height={object.height} stroke="#434343" dash={[4, 3]} />
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
          <Rect width={object.width} height={object.height} stroke="#434343" dash={[4, 3]} />
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
  const { image } = useImage(currentSrc);
  const placement = useMemo(
    () => computeImagePlacement(object.width, object.height, image?.width, image?.height, "stretch"),
    [image?.height, image?.width, object.height, object.width],
  );

  return (
    <Group
      {...groupProps}
      onMouseDown={() => {
        if (!interactive && !isDisabled) {
          setPressed(true);
        }
      }}
      onMouseUp={() => setPressed(false)}
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
        fill={currentFill}
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
      object.type === "stateImage"
    ) {
      collectMissingBindingReference(object.tag, resolvedBindings, output);
    }
    if (object.type === "image") {
      collectMissingBindingReference(object.stateTag, resolvedBindings, output);
    }
    if (object.type === "valueSelect" && object.target.type === "tag") {
      collectMissingBindingReference(object.target.tag, resolvedBindings, output);
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
