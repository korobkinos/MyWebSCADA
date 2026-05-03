export type RenderContext = {
  tagPrefix?: string;
  parameters?: Record<string, unknown>;
};

import type { RuntimeAction } from "./hmi-object-types";

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

export function resolveTagName(tag: string | undefined, context: RenderContext): string | undefined {
  if (!tag) {
    return tag;
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

  if (action.type === "pulse") {
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
      tagPrefix: combineTagPrefix(context.tagPrefix, action.tagPrefix),
    };
  }

  return action;
}
