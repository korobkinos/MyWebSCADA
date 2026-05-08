import type {
  ElementBindingDefinition,
  ElementBindingAssignment,
  IndexApplyMode,
  LibraryElement,
  PrefixApplyMode,
} from "./asset-library-types";
import type { LibraryElementInstanceObject } from "./hmi-object-types";
import { resolveRuntimeValueSync, type RuntimeResolveContext } from "./runtime-value-resolver";

function getSegmentName(segment: string): string {
  const indexStart = segment.indexOf("[");
  if (indexStart === -1) {
    return segment;
  }
  return segment.slice(0, indexStart);
}

export function parseTagSegments(tag: string): string[] {
  const segments: string[] = [];
  let current = "";
  let bracketDepth = 0;
  for (const char of tag) {
    if (char === "[" && bracketDepth >= 0) {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      current += char;
      continue;
    }
    if (char === "." && bracketDepth === 0) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.filter((segment) => segment.length > 0);
}

export function applyTagPrefixTransform(baseTag: string, prefix: string, mode: PrefixApplyMode = { type: "none" }): string {
  if (!baseTag.trim()) {
    return baseTag;
  }
  if (!prefix.trim() || mode.type === "none") {
    return baseTag;
  }

  const segments = parseTagSegments(baseTag);
  if (!segments.length) {
    return baseTag;
  }

  let targetIndex = -1;
  if (mode.type === "segment") {
    targetIndex = mode.segmentIndex;
  } else if (mode.type === "segmentByName") {
    targetIndex = segments.findIndex((segment) => getSegmentName(segment) === mode.segmentName);
  } else if (mode.type === "lastSegment") {
    targetIndex = segments.length - 1;
  }

  if (targetIndex < 0 || targetIndex >= segments.length) {
    return baseTag;
  }

  const current = segments[targetIndex]!;
  segments[targetIndex] = mode.position === "prepend" ? `${prefix}${current}` : `${current}${prefix}`;
  return segments.join(".");
}

type IndexToken = {
  segmentIndex: number;
  value: number;
  start: number;
  end: number;
};

function collectIndexTokens(segments: string[]): IndexToken[] {
  const tokens: IndexToken[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!;
    const matcher = /\[(-?\d+)\]/g;
    let match: RegExpExecArray | null = matcher.exec(segment);
    while (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        tokens.push({
          segmentIndex,
          value,
          start: match.index + 1,
          end: match.index + 1 + String(match[1]).length,
        });
      }
      match = matcher.exec(segment);
    }
  }
  return tokens;
}

function replaceIndexInSegment(segment: string, token: IndexToken, nextValue: number): string {
  return `${segment.slice(0, token.start)}${String(nextValue)}${segment.slice(token.end)}`;
}

export function applyTagIndexTransform(
  baseTag: string,
  indexOffset: number | undefined,
  mode: IndexApplyMode = { type: "none" },
): string {
  if (!baseTag.trim()) {
    return baseTag;
  }
  if (mode.type === "none" || indexOffset === undefined || !Number.isFinite(indexOffset)) {
    return baseTag;
  }

  const segments = parseTagSegments(baseTag);
  if (!segments.length) {
    return baseTag;
  }
  const tokens = collectIndexTokens(segments);
  if (!tokens.length) {
    return baseTag;
  }

  let tokenToPatch: IndexToken | undefined;
  if (mode.type === "arrayIndex") {
    tokenToPatch = tokens[mode.occurrence];
  } else if (mode.type === "arrayIndexBySegment") {
    tokenToPatch = tokens.find((token) => getSegmentName(segments[token.segmentIndex] ?? "") === mode.segmentName);
  }
  if (!tokenToPatch) {
    return baseTag;
  }

  const currentSegment = segments[tokenToPatch.segmentIndex]!;
  segments[tokenToPatch.segmentIndex] = replaceIndexInSegment(currentSegment, tokenToPatch, tokenToPatch.value + indexOffset);
  return segments.join(".");
}

export function resolveElementBindingAssignment(
  assignment: ElementBindingAssignment,
  fallbackBaseTag?: string,
  runtimeContext?: RuntimeResolveContext,
): string {
  const resolvedOverride = assignment.overrideTagSource
    ? resolveRuntimeValueSync(assignment.overrideTagSource, runtimeContext ?? {})
    : undefined;
  if (typeof resolvedOverride === "string" && resolvedOverride.trim()) {
    return resolvedOverride.trim();
  }

  if (assignment.overrideTag?.trim()) {
    return assignment.overrideTag.trim();
  }

  let result = assignment.baseTag?.trim() || fallbackBaseTag?.trim() || "";
  if (!result) {
    return "";
  }

  const resolvedPrefix = assignment.prefixSource
    ? resolveRuntimeValueSync(assignment.prefixSource, runtimeContext ?? {})
    : undefined;
  const prefix = resolvedPrefix === undefined || resolvedPrefix === null
    ? (assignment.prefix ?? "")
    : String(resolvedPrefix);

  if (prefix.trim()) {
    result = applyTagPrefixTransform(result, prefix.trim(), assignment.prefixMode ?? { type: "none" });
  }

  const resolvedIndexOffset = assignment.indexOffsetSource
    ? resolveRuntimeValueSync(assignment.indexOffsetSource, runtimeContext ?? {})
    : undefined;
  const indexOffsetRaw = resolvedIndexOffset === undefined || resolvedIndexOffset === null
    ? assignment.indexOffset
    : Number(resolvedIndexOffset);

  if (typeof indexOffsetRaw === "number" && Number.isFinite(indexOffsetRaw)) {
    result = applyTagIndexTransform(result, indexOffsetRaw, assignment.indexMode ?? { type: "none" });
  }
  return result;
}

export function resolveLibraryElementInstanceBindings(
  element: Pick<LibraryElement, "bindings">,
  instance: Pick<LibraryElementInstanceObject, "bindingAssignments">,
  runtimeContext?: RuntimeResolveContext,
): Record<string, string> {
  return resolveLibraryElementInstanceBindingsDetailed(element, instance, runtimeContext).resolvedBindings;
}

export type BindingResolutionIssue = {
  key: string;
  displayName?: string;
  required: boolean;
  reason: "missing-required";
  fallbackBaseTag?: string;
};

export type ResolvedBindingDebugInfo = {
  baseTag: string;
  prefixValue?: string;
  indexOffsetValue?: number;
  overrideTagValue?: string;
  resolvedTag: string;
  tagExists?: boolean;
  tagQuality?: string;
  tagValue?: unknown;
};

export type BindingResolutionResult = {
  resolvedBindings: Record<string, string>;
  issues: BindingResolutionIssue[];
  debug: Record<string, ResolvedBindingDebugInfo>;
};

function resolveBindingDefinition(
  definition: ElementBindingDefinition,
  assignment: ElementBindingAssignment | undefined,
  runtimeContext?: RuntimeResolveContext,
): { tag?: string; issue?: BindingResolutionIssue; debug?: ResolvedBindingDebugInfo } | undefined {
  if (assignment) {
    const tag = resolveElementBindingAssignment(assignment, definition.defaultBaseTag, runtimeContext);
    if (tag) {
      const debugInfo: ResolvedBindingDebugInfo = {
        baseTag: assignment.baseTag?.trim() || definition.defaultBaseTag?.trim() || "",
        prefixValue: resolveResolvedPrefixValue(assignment, runtimeContext),
        indexOffsetValue: resolveResolvedIndexValue(assignment, runtimeContext),
        overrideTagValue: resolveResolvedOverrideValue(assignment, runtimeContext),
        resolvedTag: tag,
      };
      return { tag, debug: debugInfo };
    }
    if (definition.required) {
      return {
        issue: {
          key: definition.key,
          displayName: definition.displayName,
          required: true,
          reason: "missing-required",
          fallbackBaseTag: definition.defaultBaseTag,
        },
      };
    }
    return undefined;
  }

  if (definition.defaultBaseTag?.trim()) {
    return {
      tag: definition.defaultBaseTag.trim(),
      debug: {
        baseTag: definition.defaultBaseTag.trim(),
        resolvedTag: definition.defaultBaseTag.trim(),
      },
    };
  }

  if (definition.required) {
    return {
      issue: {
        key: definition.key,
        displayName: definition.displayName,
        required: true,
        reason: "missing-required",
        fallbackBaseTag: definition.defaultBaseTag,
      },
    };
  }

  return undefined;
}

export function resolveLibraryElementInstanceBindingsDetailed(
  element: Pick<LibraryElement, "bindings">,
  instance: Pick<LibraryElementInstanceObject, "bindingAssignments">,
  runtimeContext?: RuntimeResolveContext,
): BindingResolutionResult {
  const resolvedBindings: Record<string, string> = {};
  const issues: BindingResolutionIssue[] = [];
  const debug: Record<string, ResolvedBindingDebugInfo> = {};

  for (const definition of element.bindings ?? []) {
    const assignment = instance.bindingAssignments?.[definition.key];
    const result = resolveBindingDefinition(definition, assignment, runtimeContext);
    if (!result) {
      continue;
    }
    if (result.tag) {
      resolvedBindings[definition.key] = result.tag;
      if (result.debug) {
        const tagRaw = runtimeContext?.tagValues?.[result.tag];
        let tagValue: unknown = undefined;
        let tagQuality: string | undefined;
        if (tagRaw && typeof tagRaw === "object") {
          tagValue = "value" in tagRaw ? (tagRaw as { value?: unknown }).value : tagRaw;
          tagQuality = "quality" in tagRaw ? String((tagRaw as { quality?: unknown }).quality) : undefined;
        } else {
          tagValue = tagRaw;
        }
        debug[definition.key] = {
          ...result.debug,
          tagExists: runtimeContext?.tagValues ? result.tag in runtimeContext.tagValues : undefined,
          tagValue,
          tagQuality,
        };
      }
      continue;
    }
    if (result.issue) {
      issues.push(result.issue);
    }
  }

  return { resolvedBindings, issues, debug };
}

export function resolveBindingReferenceTag(
  tag: string | undefined,
  resolvedBindings: Record<string, string> | undefined,
): string | undefined {
  if (!tag) {
    return undefined;
  }
  if (!tag.startsWith("$binding.")) {
    return tag;
  }
  const bindingKey = tag.slice("$binding.".length).trim();
  if (!bindingKey) {
    return undefined;
  }
  return resolvedBindings?.[bindingKey];
}

function resolveResolvedPrefixValue(
  assignment: ElementBindingAssignment,
  runtimeContext?: RuntimeResolveContext,
): string | undefined {
  if (assignment.prefixSource) {
    const value = resolveRuntimeValueSync(assignment.prefixSource, runtimeContext ?? {});
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value);
  }
  return assignment.prefix;
}

function resolveResolvedIndexValue(
  assignment: ElementBindingAssignment,
  runtimeContext?: RuntimeResolveContext,
): number | undefined {
  if (assignment.indexOffsetSource) {
    const value = resolveRuntimeValueSync(assignment.indexOffsetSource, runtimeContext ?? {});
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return undefined;
    }
    return num;
  }
  return assignment.indexOffset;
}

function resolveResolvedOverrideValue(
  assignment: ElementBindingAssignment,
  runtimeContext?: RuntimeResolveContext,
): string | undefined {
  if (assignment.overrideTagSource) {
    const value = resolveRuntimeValueSync(assignment.overrideTagSource, runtimeContext ?? {});
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value);
  }
  return assignment.overrideTag;
}
