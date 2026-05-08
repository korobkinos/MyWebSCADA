export type RenderContext = {
  popupInstanceId?: string;
  screenId?: string;
  title?: string;
  tagPrefix?: string;
  parameters?: Record<string, unknown>;
  bindings?: Record<string, string>;
  args?: Record<string, unknown>;
};

import type { RuntimeAction } from "./hmi-object-types";
import { resolveParameters, resolveTemplateString } from "./parameter-resolver";

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
      title: action.title ? resolveTemplateString(action.title, context.parameters ?? {}) : action.title,
      tagPrefix: combineTagPrefix(context.tagPrefix, action.tagPrefix),
      args: action.args ? (resolveParameters(action.args, context.parameters ?? {}) as Record<string, unknown>) : action.args,
    };
  }

  return action;
}
