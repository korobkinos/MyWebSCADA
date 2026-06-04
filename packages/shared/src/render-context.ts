import type { IndexApplyMode } from "./asset-library-types";
import type { FrameTagIndexRule, RuntimeAction } from "./hmi-object-types";
import { resolveParameters, resolveTemplateString } from "./parameter-resolver";

export type RenderContext = {
  popupInstanceId?: string;
  screenId?: string;
  title?: string;
  tagPrefix?: string;
  inheritedIndexRules?: FrameTagIndexRule[];
  parameters?: Record<string, unknown>;
  bindings?: Record<string, string>;
  args?: Record<string, unknown>;
  userRoles?: string[];
  userRoleLevel?: number;
  isAuthenticated?: boolean;
};

export function isBindingReference(tag: string | undefined): boolean {
  if (!tag) {
    return false;
  }
  return tag.startsWith("$binding.");
}

export function extractBindingKey(tag: string | undefined): string | undefined {
  if (!tag || !isBindingReference(tag)) {
    return undefined;
  }
  const bindingKey = tag.slice("$binding.".length).trim();
  return bindingKey || undefined;
}

export function combineTagPrefix(parentPrefix?: string, childPrefix?: string): string | undefined {
  if (!childPrefix) {
    return parentPrefix;
  }

  if (childPrefix.startsWith(".")) {
    if (parentPrefix) {
      return `${parentPrefix}${childPrefix}`;
    }
    return childPrefix.slice(1);
  }

  return childPrefix;
}

function normalizeIndexApplyMode(mode: IndexApplyMode | undefined): IndexApplyMode {
  if (!mode || typeof mode !== "object") {
    return { type: "none" };
  }
  if (mode.type === "arrayIndex") {
    const occurrence = Number(mode.occurrence);
    return {
      type: "arrayIndex",
      occurrence: Number.isFinite(occurrence) ? Math.max(0, Math.floor(occurrence)) : 0,
      operation: "add",
      valueFrom: "indexOffset",
    };
  }
  if (mode.type === "arrayIndexBySegment") {
    const segmentName = typeof mode.segmentName === "string" ? mode.segmentName.trim() : "";
    if (!segmentName) {
      return { type: "none" };
    }
    return {
      type: "arrayIndexBySegment",
      segmentName,
      operation: "add",
      valueFrom: "indexOffset",
    };
  }
  return { type: "none" };
}

function normalizeFrameTagIndexRule(rule: FrameTagIndexRule | undefined, index: number): FrameTagIndexRule | undefined {
  if (!rule || typeof rule !== "object") {
    return undefined;
  }
  const id = typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : `frame-index-rule-${index + 1}`;
  const indexOffset = Number(rule.indexOffset);
  return {
    id,
    enabled: rule.enabled !== false,
    name: typeof rule.name === "string" && rule.name.trim() ? rule.name.trim() : undefined,
    indexOffset: Number.isFinite(indexOffset) ? indexOffset : 0,
    indexOffsetSource: rule.indexOffsetSource,
    indexMode: normalizeIndexApplyMode(rule.indexMode),
    conflictMode: "skipLocal",
  };
}

export function getEnabledFrameTagIndexRules(
  rules: FrameTagIndexRule[] | undefined,
): FrameTagIndexRule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    return [];
  }
  const normalized: FrameTagIndexRule[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = normalizeFrameTagIndexRule(rules[index], index);
    if (!rule || rule.enabled === false) {
      continue;
    }
    normalized.push(rule);
  }
  return normalized;
}

export function getFrameTagIndexRulesSignature(rules: FrameTagIndexRule[] | undefined): string {
  const activeRules = getEnabledFrameTagIndexRules(rules);
  if (activeRules.length === 0) {
    return "";
  }
  return JSON.stringify(activeRules.map((rule) => ({
    id: rule.id,
    enabled: rule.enabled,
    indexOffset: rule.indexOffset,
    indexOffsetSource: rule.indexOffsetSource,
    conflictMode: rule.conflictMode ?? "skipLocal",
    indexMode: rule.indexMode,
  })));
}

export function resolveTagName(tag: string | undefined, context: RenderContext): string | undefined {
  if (!tag) {
    return tag;
  }

  if (isBindingReference(tag)) {
    const bindingKey = extractBindingKey(tag);
    if (!bindingKey) {
      return undefined;
    }
    const bound = context.bindings?.[bindingKey];
    if (!bound) {
      return undefined;
    }
    return resolveTagName(bound, { ...context, bindings: undefined });
  }

  if (!tag.startsWith(".")) {
    return tag;
  }

  if (!context.tagPrefix) {
    return tag.slice(1);
  }

  return `${context.tagPrefix}${tag}`;
}

export function resolveRuntimeAction(action: RuntimeAction, context: RenderContext): RuntimeAction {
  if (action.type === "write") {
    return {
      ...action,
      tag: resolveTagName(action.tag, context) ?? action.tag,
    };
  }

  if (action.type === "pulse" || action.type === "hold" || action.type === "momentary") {
    return {
      ...action,
      tag: resolveTagName(action.tag, context) ?? action.tag,
    };
  }

  if (action.type === "toggle") {
    return {
      ...action,
      tag: resolveTagName(action.tag, context) ?? action.tag,
    };
  }

  if (action.type === "writeConst" && action.target === "tag") {
    return {
      ...action,
      name: resolveTagName(action.name, context) ?? action.name,
    };
  }

  if (action.type === "writeNumberPrompt" && action.target === "tag") {
    return {
      ...action,
      name: resolveTagName(action.name, context) ?? action.name,
    };
  }

  if (action.type === "openPopup") {
    return {
      ...action,
      title: action.title ? resolveTemplateString(action.title, context.parameters ?? {}) : action.title,
      tagPrefix: combineTagPrefix(context.tagPrefix, action.tagPrefix),
      tagIndexRules: action.tagIndexRules,
      args: action.args ? (resolveParameters(action.args, context.parameters ?? {}) as Record<string, unknown>) : action.args,
    };
  }

  return action;
}
