import type { RuntimeValueSource } from "./asset-library-types";

export type RuntimeDependency =
  | { type: "tag"; tag: string }
  | { type: "lw"; address: number }
  | { type: "internal"; name: string };

export type RuntimeValueResolverWarning = {
  code: "expression-not-implemented";
  message: string;
  source: RuntimeValueSource;
};

export type RuntimeResolveContext = {
  tagStore?: {
    readTag: (tag: string) => unknown;
  };
  lwStore?: {
    getLW: (address: number) => unknown;
  };
  internalVariableStore?: {
    get: (name: string) => unknown;
  };
  tagValues?: Record<string, unknown>;
  warn?: (warning: RuntimeValueResolverWarning) => void;
};

function toLwTagName(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

function toInternalTagName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^LW\d+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed.startsWith("LW.") ? trimmed : `LW.${trimmed}`;
}

function unwrapValue(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  if ("value" in input) {
    return (input as { value?: unknown }).value;
  }
  return input;
}

function readFromTagValues(tag: string, context: RuntimeResolveContext): unknown {
  const fromTagStore = context.tagStore?.readTag(tag);
  if (fromTagStore !== undefined) {
    return unwrapValue(fromTagStore);
  }
  if (context.tagValues && tag in context.tagValues) {
    return unwrapValue(context.tagValues[tag]);
  }
  return undefined;
}

export function resolveRuntimeValueSync(
  source: RuntimeValueSource,
  context: RuntimeResolveContext,
): unknown {
  if (source.type === "static") {
    return source.value;
  }

  if (source.type === "tag") {
    return readFromTagValues(source.tag, context);
  }

  if (source.type === "lw") {
    const fromLw = context.lwStore?.getLW(source.address);
    if (fromLw !== undefined) {
      return unwrapValue(fromLw);
    }
    return readFromTagValues(toLwTagName(source.address), context);
  }

  if (source.type === "internal") {
    const fromInternal = context.internalVariableStore?.get(source.name);
    if (fromInternal !== undefined) {
      return unwrapValue(fromInternal);
    }
    const normalized = toInternalTagName(source.name);
    const direct = readFromTagValues(source.name, context);
    if (direct !== undefined) {
      return direct;
    }
    return readFromTagValues(normalized, context);
  }

  context.warn?.({
    code: "expression-not-implemented",
    message: "RuntimeValueSource expression is not implemented yet",
    source,
  });
  return undefined;
}

export async function resolveRuntimeValue(
  source: RuntimeValueSource,
  context: RuntimeResolveContext,
): Promise<unknown> {
  return resolveRuntimeValueSync(source, context);
}

export function getRuntimeValueSourceDependencies(source: RuntimeValueSource | undefined): RuntimeDependency[] {
  if (!source) {
    return [];
  }
  if (source.type === "tag") {
    return [{ type: "tag", tag: source.tag }];
  }
  if (source.type === "lw") {
    return [{ type: "lw", address: source.address }];
  }
  if (source.type === "internal") {
    return [{ type: "internal", name: source.name }];
  }
  return [];
}
