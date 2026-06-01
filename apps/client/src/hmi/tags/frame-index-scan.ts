import {
  applyTagIndexTransform,
  extractTagIndexTokens,
  getEnabledFrameTagIndexRules,
  type FrameTagIndexRule,
  type HmiObject,
} from "@web-scada/shared";

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
};

export type FrameIndexScanStatus =
  | "No index"
  | "Local override"
  | "No matching rule"
  | "Inherited"
  | "Resolved";

export type FrameIndexScanEvaluation = {
  status: FrameIndexScanStatus;
  preview: string;
  skippedByLocal: boolean;
  matchedRuleIds: string[];
};

export function scanFrameIndexTags(screenObjects: HmiObject[]): FrameIndexScanItem[] {
  const out: FrameIndexScanItem[] = [];
  for (const object of screenObjects) {
    collectObjectTags(object, out);
  }
  return out;
}

export function evaluateFrameIndexScanItem(
  item: FrameIndexScanItem,
  rules: FrameTagIndexRule[] | undefined,
): FrameIndexScanEvaluation {
  if (item.hasLocalIndexing) {
    return {
      status: "Local override",
      preview: "Skipped by local indexing",
      skippedByLocal: true,
      matchedRuleIds: [],
    };
  }

  if (item.indexTokens.length === 0) {
    return {
      status: "No index",
      preview: item.rawTag,
      skippedByLocal: false,
      matchedRuleIds: [],
    };
  }

  const preview = previewFrameIndexTag(item.rawTag, rules);
  if (preview.matchedRuleIds.length === 0) {
    return {
      status: "No matching rule",
      preview: item.rawTag,
      skippedByLocal: false,
      matchedRuleIds: [],
    };
  }

  return {
    status: preview.resolvedTag === item.rawTag ? "Inherited" : "Resolved",
    preview: preview.resolvedTag,
    skippedByLocal: false,
    matchedRuleIds: preview.matchedRuleIds,
  };
}

export function previewFrameIndexTag(
  rawTag: string,
  rules: FrameTagIndexRule[] | undefined,
): { resolvedTag: string; matchedRuleIds: string[] } {
  const activeRules = getEnabledFrameTagIndexRules(rules);
  if (!rawTag.trim() || activeRules.length === 0) {
    return { resolvedTag: rawTag, matchedRuleIds: [] };
  }

  let current = rawTag;
  const matchedRuleIds: string[] = [];
  for (const rule of activeRules) {
    if (isRuleMatchingTag(current, rule)) {
      matchedRuleIds.push(rule.id);
    }
    current = applyTagIndexTransform(current, rule.indexOffset, rule.indexMode);
  }
  return { resolvedTag: current, matchedRuleIds };
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

function collectObjectTags(object: HmiObject, out: FrameIndexScanItem[]): void {
  for (const field of listObjectTagFields(object)) {
    const rawTag = field.rawTag?.trim();
    if (!rawTag) {
      continue;
    }
    const localIndexingSource = resolveLocalIndexingSource(object, field.fieldPath);
    out.push({
      objectId: object.id,
      objectName: object.name,
      objectType: object.type,
      fieldPath: field.fieldPath,
      rawTag,
      indexTokens: extractTagIndexTokens(rawTag).map((token) => ({
        occurrence: token.occurrence,
        segmentName: token.segmentName || undefined,
        value: token.value,
        token: token.token,
      })),
      hasLocalIndexing: Boolean(localIndexingSource),
      localIndexingSource,
      runtimeSupport: field.runtimeSupport,
    });
  }

  if (object.type === "group") {
    for (const child of object.objects) {
      collectObjectTags(child, out);
    }
  }
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
