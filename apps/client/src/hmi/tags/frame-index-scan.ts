import {
  applyTagIndexTransform,
  extractBindingKey,
  extractTagIndexTokens,
  getEnabledFrameTagIndexRules,
  isBindingReference,
  resolveLibraryElementInstanceBindingsDetailed,
  resolveParameters,
  type ElementLibrary,
  type FrameTagIndexRule,
  type HmiObject,
  type RenderContext,
} from "@web-scada/shared";
import { resolveFrameRuleOffset } from "./indexed-address";

export type FrameIndexScanItem = {
  objectId: string;
  objectName?: string;
  objectType: HmiObject["type"];
  fieldPath: string;
  rawTag: string;
  indexTokens: Array<{
    occurrence: number;
    segmentName?: string;
    value: number;
    token: string;
  }>;
  hasLocalIndexing: boolean;
  localIndexingSource?: "tagIndexing" | "tagIndexingByField";
  runtimeSupport: "full" | "limited";
  bindingStatus?: "resolved" | "unresolved";
  note?: string;
};

export type FrameIndexScanStatus =
  | "No index"
  | "Local override"
  | "No matching rule"
  | "Inherited"
  | "Resolved"
  | "Unresolved binding";

export type FrameIndexScanEvaluation = {
  status: FrameIndexScanStatus;
  preview: string;
  skippedByLocal: boolean;
  matchedRuleIds: string[];
  warnings: string[];
};

export type FrameIndexScanOptions = {
  libraries?: ElementLibrary[];
  runtimeValues?: Record<string, unknown>;
  renderContext?: RenderContext;
};

export type FrameIndexScanResult = {
  items: FrameIndexScanItem[];
  diagnostics: string[];
};

type ScanPathContext = {
  labelPrefix?: string;
  idPrefix?: string;
};

type ScanContext = {
  librariesById: Map<string, ElementLibrary>;
  runtimeValues?: Record<string, unknown>;
  renderContext: RenderContext;
  diagnostics: string[];
  libraryStack: Set<string>;
};

export function scanFrameIndexTags(screenObjects: HmiObject[], options?: FrameIndexScanOptions): FrameIndexScanItem[] {
  return scanFrameIndexTagsDetailed(screenObjects, options).items;
}

export function scanFrameIndexTagsDetailed(screenObjects: HmiObject[], options?: FrameIndexScanOptions): FrameIndexScanResult {
  const out: FrameIndexScanItem[] = [];
  const diagnostics: string[] = [];
  const context: ScanContext = {
    librariesById: new Map((options?.libraries ?? []).map((library) => [library.id, library])),
    runtimeValues: options?.runtimeValues,
    renderContext: options?.renderContext ?? {},
    diagnostics,
    libraryStack: new Set<string>(),
  };

  for (const object of screenObjects) {
    collectObjectTags(object, out, context);
  }

  return { items: out, diagnostics };
}

export function evaluateFrameIndexScanItem(
  item: FrameIndexScanItem,
  rules: FrameTagIndexRule[] | undefined,
  options?: Pick<FrameIndexScanOptions, "runtimeValues" | "renderContext">,
): FrameIndexScanEvaluation {
  if (item.bindingStatus === "unresolved") {
    return {
      status: "Unresolved binding",
      preview: item.rawTag,
      skippedByLocal: false,
      matchedRuleIds: [],
      warnings: item.note ? [item.note] : [],
    };
  }

  if (item.hasLocalIndexing) {
    return {
      status: "Local override",
      preview: "Skipped by local indexing",
      skippedByLocal: true,
      matchedRuleIds: [],
      warnings: [],
    };
  }

  if (item.indexTokens.length === 0) {
    return {
      status: "No index",
      preview: item.rawTag,
      skippedByLocal: false,
      matchedRuleIds: [],
      warnings: [],
    };
  }

  const preview = previewFrameIndexTag(item.rawTag, rules, options);
  if (preview.matchedRuleIds.length === 0) {
    return {
      status: "No matching rule",
      preview: item.rawTag,
      skippedByLocal: false,
      matchedRuleIds: [],
      warnings: preview.warnings,
    };
  }

  return {
    status: preview.resolvedTag === item.rawTag ? "Inherited" : "Resolved",
    preview: preview.resolvedTag,
    skippedByLocal: false,
    matchedRuleIds: preview.matchedRuleIds,
    warnings: preview.warnings,
  };
}

export function previewFrameIndexTag(
  rawTag: string,
  rules: FrameTagIndexRule[] | undefined,
  options?: Pick<FrameIndexScanOptions, "runtimeValues" | "renderContext">,
): { resolvedTag: string; matchedRuleIds: string[]; warnings: string[] } {
  const activeRules = getEnabledFrameTagIndexRules(rules);
  if (!rawTag.trim() || activeRules.length === 0) {
    return { resolvedTag: rawTag, matchedRuleIds: [], warnings: [] };
  }

  let current = rawTag;
  const matchedRuleIds: string[] = [];
  const warnings: string[] = [];
  for (const rule of activeRules) {
    if (isRuleMatchingTag(current, rule)) {
      matchedRuleIds.push(rule.id);
    }

    const offset = resolveFrameRuleOffset(rule, {
      context: options?.renderContext ?? {},
      runtimeValues: options?.runtimeValues,
    });
    if (offset.warning) {
      warnings.push(`${rule.name?.trim() || rule.id}: ${offset.warning}`);
    }
    current = applyTagIndexTransform(current, offset.value, rule.indexMode);
  }
  return { resolvedTag: current, matchedRuleIds, warnings };
}

function isRuleMatchingTag(tag: string, rule: FrameTagIndexRule): boolean {
  const tokens = extractTagIndexTokens(tag);
  if (tokens.length === 0) {
    return false;
  }
  if (rule.indexMode.type === "arrayIndex") {
    return Boolean(tokens[rule.indexMode.occurrence]);
  }
  if (rule.indexMode.type === "arrayIndexBySegment") {
    const segmentName = rule.indexMode.segmentName.trim();
    if (!segmentName) {
      return false;
    }
    return tokens.some((token) => token.segmentName === segmentName);
  }
  return false;
}

function collectObjectTags(
  object: HmiObject,
  out: FrameIndexScanItem[],
  scanContext: ScanContext,
  pathContext?: ScanPathContext,
): void {
  const objectLabel = object.name?.trim() || object.id;
  const objectPathLabel = pathContext?.labelPrefix ? `${pathContext.labelPrefix} / ${objectLabel}` : undefined;
  const objectPathId = pathContext?.idPrefix ? `${pathContext.idPrefix} > ${object.id}` : undefined;

  for (const field of listObjectTagFields(object)) {
    const rawTag = field.rawTag?.trim();
    if (!rawTag) {
      continue;
    }
    const localIndexingSource = resolveLocalIndexingSource(object, field.fieldPath);
    const resolvedBinding = resolveBindingTag(rawTag, scanContext.renderContext.bindings);
    const effectiveTag = resolvedBinding.tag;
    if (!effectiveTag.trim()) {
      continue;
    }
    out.push({
      objectId: objectPathId ?? object.id,
      objectName: objectPathLabel ?? object.name,
      objectType: object.type,
      fieldPath: field.fieldPath,
      rawTag: effectiveTag,
      indexTokens: extractTagIndexTokens(effectiveTag).map((token) => ({
        occurrence: token.occurrence,
        segmentName: token.segmentName || undefined,
        value: token.value,
        token: token.token,
      })),
      hasLocalIndexing: Boolean(localIndexingSource),
      localIndexingSource,
      runtimeSupport: field.runtimeSupport,
      bindingStatus: resolvedBinding.bindingStatus,
      note: resolvedBinding.note,
    });
  }

  if (object.type === "group") {
    const childPath = objectPathLabel && objectPathId
      ? { labelPrefix: objectPathLabel, idPrefix: objectPathId }
      : pathContext;
    for (const child of object.objects) {
      collectObjectTags(child, out, scanContext, childPath);
    }
    return;
  }

  if (object.type === "libraryElementInstance") {
    collectLibraryElementInstanceTags(object, out, scanContext, objectPathLabel, objectPathId);
  }
}

function collectLibraryElementInstanceTags(
  object: Extract<HmiObject, { type: "libraryElementInstance" }>,
  out: FrameIndexScanItem[],
  scanContext: ScanContext,
  objectPathLabel: string | undefined,
  objectPathId: string | undefined,
): void {
  const library = scanContext.librariesById.get(object.libraryId);
  const instanceLabel = object.name?.trim() || object.id;
  const instanceId = object.id;

  if (!library) {
    scanContext.diagnostics.push(`Library not found for instance ${instanceLabel}: ${object.libraryId}`);
    return;
  }
  const element = library.elements.find((item) => item.id === object.elementId);
  if (!element) {
    scanContext.diagnostics.push(`Library element not found for instance ${instanceLabel}: ${object.libraryId}/${object.elementId}`);
    return;
  }

  const recursionKey = `${library.id}:${element.id}`;
  if (scanContext.libraryStack.has(recursionKey)) {
    scanContext.diagnostics.push(`Recursive library reference skipped for ${instanceLabel}: ${recursionKey}`);
    return;
  }

  const defaults = Object.fromEntries((element.parameters ?? []).map((item) => [item.name, item.defaultValue]));
  const resolvedParameters = {
    ...defaults,
    ...(resolveParameters((object.parameterValues ?? {}) as Record<string, unknown>, scanContext.renderContext.parameters ?? {}) as Record<string, unknown>),
  } as Record<string, unknown>;
  const resolvedBindings = resolveLibraryElementInstanceBindingsDetailed(
    element,
    object,
    { tagValues: scanContext.runtimeValues },
  ).resolvedBindings;
  const childContext: ScanContext = {
    ...scanContext,
    renderContext: {
      ...scanContext.renderContext,
      parameters: resolvedParameters,
      bindings: {
        ...(scanContext.renderContext.bindings ?? {}),
        ...resolvedBindings,
      },
    },
  };
  const childPath: ScanPathContext = {
    labelPrefix: objectPathLabel ?? instanceLabel,
    idPrefix: objectPathId ?? instanceId,
  };

  scanContext.libraryStack.add(recursionKey);
  try {
    for (const child of element.objects) {
      const resolvedChild = resolveParameters(child as object, resolvedParameters) as HmiObject;
      collectObjectTags(resolvedChild, out, childContext, childPath);
    }
  } finally {
    scanContext.libraryStack.delete(recursionKey);
  }
}

function resolveBindingTag(
  rawTag: string,
  bindings: Record<string, string> | undefined,
): { tag: string; bindingStatus?: "resolved" | "unresolved"; note?: string } {
  if (!isBindingReference(rawTag)) {
    return { tag: rawTag };
  }
  const key = extractBindingKey(rawTag);
  const resolved = key ? bindings?.[key] : undefined;
  if (resolved?.trim()) {
    return { tag: resolved.trim(), bindingStatus: "resolved" };
  }
  return { tag: rawTag, bindingStatus: "unresolved", note: `Unresolved binding: ${rawTag}` };
}

function resolveLocalIndexingSource(
  object: HmiObject,
  fieldPath: string,
): "tagIndexing" | "tagIndexingByField" | undefined {
  if (object.tagIndexingByField?.[fieldPath]?.enabled === true) {
    return "tagIndexingByField";
  }
  if (fieldPath === "tag" && object.tagIndexing?.enabled === true) {
    return "tagIndexing";
  }
  return undefined;
}

function listObjectTagFields(
  object: HmiObject,
): Array<{ fieldPath: string; rawTag: string | undefined; runtimeSupport: "full" | "limited" }> {
  const fields: Array<{ fieldPath: string; rawTag: string | undefined; runtimeSupport: "full" | "limited" }> = [
    { fieldPath: "visibleTag", rawTag: object.visibleTag, runtimeSupport: "full" },
    { fieldPath: "disabledTag", rawTag: object.disabledTag, runtimeSupport: "full" },
    { fieldPath: "rotationAnimation.triggerTag", rawTag: object.rotationAnimation?.triggerTag, runtimeSupport: "full" },
    { fieldPath: "rotationAnimation.speedTag", rawTag: object.rotationAnimation?.speedTag, runtimeSupport: "full" },
  ];

  if ("action" in object && object.action && (object.action.type === "write" || object.action.type === "pulse" || object.action.type === "toggle")) {
    fields.push({ fieldPath: "action.tag", rawTag: object.action.tag, runtimeSupport: "full" });
  }

  switch (object.type) {
    case "text":
    case "value-display":
    case "value-input":
    case "state-indicator":
    case "switch":
    case "stateImage":
    case "numeric-image-indicator":
    case "progress-bar":
      fields.push({ fieldPath: "tag", rawTag: object.tag, runtimeSupport: "full" });
      break;
    case "line":
      fields.push({ fieldPath: "stateTag", rawTag: object.stateTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "flowAnimation.triggerTag", rawTag: object.flowAnimation?.triggerTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "flowAnimation.speedTag", rawTag: object.flowAnimation?.speedTag, runtimeSupport: "full" });
      break;
    case "image":
      fields.push({ fieldPath: "stateTag", rawTag: object.stateTag, runtimeSupport: "full" });
      break;
    case "valueSelect":
      if (object.target.type === "tag") {
        fields.push({ fieldPath: "target.tag", rawTag: object.target.tag, runtimeSupport: "full" });
      }
      break;
    case "checkbox":
    case "slider":
    case "select":
    case "radio-group":
      fields.push({ fieldPath: "tag", rawTag: object.tag, runtimeSupport: "full" });
      fields.push({ fieldPath: "writeTag", rawTag: object.writeTag, runtimeSupport: "full" });
      break;
    case "numeric-input":
      fields.push({ fieldPath: "tag", rawTag: object.tag, runtimeSupport: "full" });
      fields.push({ fieldPath: "writeTag", rawTag: object.writeTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "errorTag", rawTag: object.errorTag, runtimeSupport: "full" });
      break;
    case "valve":
      fields.push({ fieldPath: "openTag", rawTag: object.openTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "closedTag", rawTag: object.closedTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "errorTag", rawTag: object.errorTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "commandOpenTag", rawTag: object.commandOpenTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "commandCloseTag", rawTag: object.commandCloseTag, runtimeSupport: "full" });
      break;
    case "pump":
      fields.push({ fieldPath: "runTag", rawTag: object.runTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "faultTag", rawTag: object.faultTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "commandStartTag", rawTag: object.commandStartTag, runtimeSupport: "full" });
      fields.push({ fieldPath: "commandStopTag", rawTag: object.commandStopTag, runtimeSupport: "full" });
      break;
    case "trendChart":
      object.selectedTags.forEach((selected, index) => {
        fields.push({
          fieldPath: `selectedTags[${index}].tag`,
          rawTag: selected.tag,
          runtimeSupport: "limited",
        });
      });
      break;
    case "eventTable":
      fields.push({
        fieldPath: "sourceTagFilter",
        rawTag: object.sourceTagFilter,
        runtimeSupport: "limited",
      });
      break;
    default:
      break;
  }

  return fields;
}
