import type { TagValue } from "@web-scada/shared";

type TagMap = Record<string, TagValue>;

export function createRuntimeDependencyTagSignature(
  dependencyTags: string[],
  tags: TagMap,
): string {
  return dependencyTags
    .map((tagName) => `${tagName}=${serializeRuntimeDependencyTag(tags[tagName])}`)
    .join("|");
}

export function haveSameRuntimeSubscriptionTags(left: string[], right: string[]): boolean {
  const leftTags = new Set(left.map((tag) => tag.trim()).filter(Boolean));
  const rightTags = new Set(right.map((tag) => tag.trim()).filter(Boolean));
  if (leftTags.size !== rightTags.size) {
    return false;
  }
  for (const tag of leftTags) {
    if (!rightTags.has(tag)) {
      return false;
    }
  }
  return true;
}

function serializeRuntimeDependencyTag(value: TagValue | undefined): string {
  if (!value) {
    return "missing";
  }
  const rawValue = value.value;
  const valuePart = rawValue === null
    ? "null"
    : `${typeof rawValue}:${String(rawValue)}`;
  return `present:${valuePart}:${value.quality}`;
}
