import type {
  ElementBindingAssignment,
  IndexApplyMode,
  LibraryElement,
  PrefixApplyMode,
} from "./asset-library-types";
import type { LibraryElementInstanceObject } from "./hmi-object-types";

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
): string {
  if (assignment.overrideTag?.trim()) {
    return assignment.overrideTag.trim();
  }

  let result = assignment.baseTag?.trim() || fallbackBaseTag?.trim() || "";
  if (!result) {
    return "";
  }

  if (assignment.prefix?.trim()) {
    result = applyTagPrefixTransform(result, assignment.prefix.trim(), assignment.prefixMode ?? { type: "none" });
  }
  if (assignment.indexOffset !== undefined) {
    result = applyTagIndexTransform(result, assignment.indexOffset, assignment.indexMode ?? { type: "none" });
  }
  return result;
}

export function resolveLibraryElementInstanceBindings(
  element: Pick<LibraryElement, "bindings">,
  instance: Pick<LibraryElementInstanceObject, "bindingAssignments">,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const definition of element.bindings ?? []) {
    const assignment = instance.bindingAssignments?.[definition.key];
    if (assignment) {
      const tag = resolveElementBindingAssignment(assignment, definition.defaultBaseTag);
      if (tag) {
        resolved[definition.key] = tag;
      }
      continue;
    }
    if (definition.defaultBaseTag?.trim()) {
      resolved[definition.key] = definition.defaultBaseTag.trim();
    }
  }
  return resolved;
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
