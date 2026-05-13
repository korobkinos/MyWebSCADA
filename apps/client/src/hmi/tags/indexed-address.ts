import {
  extractIndexedAddressSlots,
  resolveIndexedAddress,
  resolveTagName,
  type HmiObject,
  type IndexedTagAddress,
  type RenderContext,
  type ScadaProject,
  type TagDefinition,
  type TagValue,
} from "@web-scada/shared";

type TagMap = Record<string, TagValue>;

type RuntimeValueInput = {
  context?: RenderContext;
  tagValues?: TagMap;
  variables?: ScadaProject["variables"];
};

export type ResolvedIndexedObjectTag = {
  usedIndexedAddress: boolean;
  rawTagName?: string;
  resolvedAddress?: string;
  resolvedTagName?: string;
  matchingTag?: TagDefinition;
  errors: string[];
  dependencyTags: string[];
};

const tagAddressMapCache = new WeakMap<ScadaProject, Map<string, TagDefinition>>();

export function getTagAddressTemplate(tag: TagDefinition | undefined): string {
  if (!tag) {
    return "";
  }

  const raw = tag as TagDefinition & { addressRaw?: unknown };
  const fromAddress = raw.address && typeof raw.address === "object" ? raw.address as Record<string, unknown> : undefined;
  const candidates = [
    tag.nodeId,
    typeof fromAddress?.nodeId === "string" ? fromAddress.nodeId : undefined,
    typeof raw.addressRaw === "string" ? raw.addressRaw : undefined,
    typeof tag.address === "string" ? tag.address : undefined,
    tag.name,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeAddress(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return tag.name;
}

export function findTagByAddress(project: ScadaProject, address: string): TagDefinition | undefined {
  const normalizedAddress = normalizeAddress(address)?.toLowerCase();
  if (!normalizedAddress) {
    return undefined;
  }

  let cache = tagAddressMapCache.get(project);
  if (!cache) {
    cache = new Map<string, TagDefinition>();
    for (const tag of project.tags ?? []) {
      for (const candidate of collectAddressCandidates(tag)) {
        cache.set(candidate.toLowerCase(), tag);
      }
    }
    tagAddressMapCache.set(project, cache);
  }

  return cache.get(normalizedAddress);
}

export function findTagByAddressInTags(tags: TagDefinition[], address: string): TagDefinition | undefined {
  const normalizedAddress = normalizeAddress(address)?.toLowerCase();
  if (!normalizedAddress) {
    return undefined;
  }

  for (const tag of tags) {
    for (const candidate of collectAddressCandidates(tag)) {
      if (candidate.toLowerCase() === normalizedAddress) {
        return tag;
      }
    }
  }
  return undefined;
}

export function buildIndexedAddressRuntimeValues(input: RuntimeValueInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  if (input.context) {
    Object.assign(values, input.context);
    if (input.context.parameters) {
      Object.assign(values, input.context.parameters);
    }
  }

  for (const variable of input.variables ?? []) {
    const value = variable.currentValue ?? variable.initialValue ?? null;
    const trimmedName = variable.name.trim();
    if (!trimmedName) {
      continue;
    }
    values[trimmedName] = value;
    values[`LW.${trimmedName}`] = value;
  }

  for (const [tagName, payload] of Object.entries(input.tagValues ?? {})) {
    const value = extractRuntimeTagValue(payload);
    values[tagName] = value;
    if (tagName.startsWith("LW.") && tagName.length > 3) {
      values[tagName.slice(3)] = value;
    }
  }

  debugIndexedAddress("runtimeValues:built", {
    keys: Object.keys(values).slice(0, 80),
    counter: values.Counter,
    lwCounter: values["LW.Counter"],
    sample: {
      Counter: values.Counter,
      "LW.Counter": values["LW.Counter"],
      tagPrefix: values.tagPrefix,
    },
  });

  return values;
}

function extractRuntimeTagValue(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === "object" &&
    "value" in payload
  ) {
    return (payload as { value?: unknown }).value;
  }

  return payload;
}

export function resolveIndexedObjectMainTag(params: {
  object: HmiObject;
  project: ScadaProject;
  context: RenderContext;
  tagValues?: TagMap;
  rawTagName?: string;
}): ResolvedIndexedObjectTag {
  return resolveObjectTagField({
    ...params,
    fieldName: "tag",
  });
}

export function resolveObjectTagField(params: {
  object: HmiObject;
  fieldName: string;
  project: ScadaProject;
  context: RenderContext;
  tagValues?: TagMap;
  rawTagName?: string;
}): ResolvedIndexedObjectTag {
  const rawTagName = resolveTagName(params.rawTagName, params.context);
  const config = getObjectIndexedConfigForField(params.object, params.fieldName);

  if (config?.enabled) {
    debugIndexedAddress("resolveObjectTagField:start", {
      objectId: params.object.id,
      objectName: params.object.name,
      objectType: params.object.type,
      fieldName: params.fieldName,
      rawTagNameInput: params.rawTagName,
      rawTagNameResolved: rawTagName,
      hasConfig: Boolean(config),
      configEnabled: config.enabled,
      template: config.template,
      bindings: config.bindings,
      context: params.context,
      tagValuesKeys: Object.keys(params.tagValues ?? {}).slice(0, 50),
      tagValuesHasCounter: Object.prototype.hasOwnProperty.call(params.tagValues ?? {}, "Counter"),
      tagValueCounterRaw: (params.tagValues as Record<string, unknown> | undefined)?.Counter,
    });
  }

  if (!rawTagName) {
    return {
      usedIndexedAddress: false,
      rawTagName: rawTagName ?? undefined,
      resolvedTagName: rawTagName ?? undefined,
      errors: [],
      dependencyTags: [],
    };
  }

  if (!config?.enabled) {
    return {
      usedIndexedAddress: false,
      rawTagName,
      resolvedTagName: rawTagName,
      errors: [],
      dependencyTags: [],
    };
  }

  const rawTagDefinition = params.project.tags.find((tag) => tag.name === rawTagName);
  const template = normalizeAddress(config.template) ?? getTagAddressTemplate(rawTagDefinition);
  const slotCount = extractIndexedAddressSlots(template).length;
  if (slotCount === 0) {
    return {
      usedIndexedAddress: false,
      rawTagName,
      resolvedTagName: rawTagName,
      errors: [],
      dependencyTags: collectBindingTagDependencies(config, params.context),
    };
  }

  const normalizedConfig = normalizeIndexedConfig({
    ...config,
    template,
  }, params.context);
  const values = buildIndexedAddressRuntimeValues({
    context: params.context,
    tagValues: params.tagValues,
    variables: params.project.variables,
  });
  for (const binding of normalizedConfig.bindings) {
    if (binding.source !== "tag" || !binding.sourceName) {
      continue;
    }
    const original = config.bindings.find((item) => item.slotIndex === binding.slotIndex)?.sourceName;
    if (!original || original === binding.sourceName) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, binding.sourceName)) {
      values[original] = values[binding.sourceName];
    }
  }

  debugIndexedAddress("resolveObjectTagField:values", {
    fieldName: params.fieldName,
    template,
    valuesForBindings: normalizedConfig.bindings.map((binding) => {
      const rawValueFromValues = binding.sourceName ? values[binding.sourceName] : undefined;
      const numericDebug = toIndexedDebugNumber(rawValueFromValues);
      return {
        key: binding.key,
        source: binding.source,
        sourceName: binding.sourceName,
        rawValueFromValues,
        extractedValue: numericDebug.extracted,
        numericValue: numericDebug.value,
        ok: numericDebug.ok,
        constantValue: binding.constantValue,
        offset: binding.offset,
        baseValue: binding.baseValue,
        slotIndex: binding.slotIndex,
      };
    }),
  });

  const resolved = resolveIndexedAddress({
    config: normalizedConfig,
    values,
  });
  debugIndexedAddress("resolveObjectTagField:resolved", {
    fieldName: params.fieldName,
    rawTagName,
    resolvedAddress: resolved.address,
    parts: resolved.parts,
    errors: resolved.errors,
  });
  const matchingTag = findTagByAddress(params.project, resolved.address);
  debugIndexedAddress("resolveObjectTagField:matchingTag", {
    resolvedAddress: resolved.address,
    found: Boolean(matchingTag),
    matchingTagName: matchingTag?.name,
    matchingTagNodeId: matchingTag?.nodeId,
    similarAddresses: matchingTag ? undefined : findSimilarAddressCandidates(params.project, resolved.address),
  });
  if (!matchingTag) {
    return {
      usedIndexedAddress: true,
      rawTagName,
      resolvedAddress: resolved.address,
      resolvedTagName: undefined,
      errors: [...resolved.errors, `Indexed tag not found: ${resolved.address}`],
      dependencyTags: collectBindingTagDependencies(config, params.context),
    };
  }

  return {
    usedIndexedAddress: true,
    rawTagName,
    resolvedAddress: resolved.address,
    resolvedTagName: matchingTag.name,
    matchingTag,
    errors: resolved.errors,
    dependencyTags: collectBindingTagDependencies(config, params.context),
  };
}

export function getObjectIndexedConfigForField(object: HmiObject, fieldName: string): IndexedTagAddress | undefined {
  const byField = object.tagIndexingByField?.[fieldName];
  if (byField) {
    return byField;
  }
  if (fieldName === "tag") {
    return object.tagIndexing;
  }
  return undefined;
}

export function collectBindingTagDependencies(config: IndexedTagAddress | undefined, context: RenderContext): string[] {
  if (!config?.enabled) {
    return [];
  }

  const out = new Set<string>();
  for (const binding of config.bindings ?? []) {
    if (binding.source !== "tag") {
      continue;
    }
    const resolved = resolveTagName(binding.sourceName, context);
    if (resolved?.trim()) {
      out.add(resolved.trim());
    }
  }
  return [...out];
}

function normalizeIndexedConfig(config: IndexedTagAddress, context: RenderContext): IndexedTagAddress {
  return {
    ...config,
    bindings: (config.bindings ?? []).map((binding) => {
      if (binding.source !== "tag") {
        return binding;
      }
      const resolved = resolveTagName(binding.sourceName, context);
      return {
        ...binding,
        sourceName: resolved ?? binding.sourceName,
      };
    }),
  };
}

function collectAddressCandidates(tag: TagDefinition): string[] {
  const raw = tag as TagDefinition & { addressRaw?: unknown };
  const fromAddress = raw.address && typeof raw.address === "object" ? raw.address as Record<string, unknown> : undefined;
  const candidates = [
    tag.nodeId,
    typeof fromAddress?.nodeId === "string" ? fromAddress.nodeId : undefined,
    typeof raw.addressRaw === "string" ? raw.addressRaw : undefined,
    typeof tag.address === "string" ? tag.address : undefined,
  ];
  return candidates
    .map((item) => normalizeAddress(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeAddress(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isIndexedAddressDebugEnabled(): boolean {
  return typeof window !== "undefined" &&
    window.localStorage.getItem("scada.debugIndexedAddress") === "1";
}

function debugIndexedAddress(label: string, payload: Record<string, unknown>): void {
  if (!isIndexedAddressDebugEnabled()) {
    return;
  }
  // eslint-disable-next-line no-console
  console.debug("[indexed-address]", label, payload);
}

function findSimilarAddressCandidates(project: ScadaProject, address: string): string[] {
  const limited: string[] = [];
  const seen = new Set<string>();
  const normalized = normalizeAddress(address) ?? "";
  const bracketIndex = normalized.indexOf("[");
  const prefix = bracketIndex > 0 ? normalized.slice(0, bracketIndex) : normalized;
  const markerMatch = normalized.match(/[A-Za-z0-9_]+(?=\[\d+\])/);
  const marker = markerMatch?.[0];

  for (const tag of project.tags ?? []) {
    const candidates = collectAddressCandidates(tag);
    for (const candidate of candidates) {
      const hitByMarker = marker ? candidate.includes(`${marker}[`) : false;
      const hitByPrefix = prefix ? candidate.startsWith(prefix) : false;
      if (!hitByMarker && !hitByPrefix) {
        continue;
      }
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      limited.push(candidate);
      if (limited.length >= 10) {
        return limited;
      }
    }
  }

  return limited;
}

function extractIndexedDebugValue(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "value" in raw
  ) {
    return (raw as { value?: unknown }).value;
  }
  return raw;
}

function toIndexedDebugNumber(raw: unknown): { extracted: unknown; value: number; ok: boolean } {
  const extracted = extractIndexedDebugValue(raw);
  if (typeof extracted === "number") {
    return Number.isFinite(extracted)
      ? { extracted, value: extracted, ok: true }
      : { extracted, value: 0, ok: false };
  }
  if (typeof extracted === "string" && extracted.trim() !== "") {
    const parsed = Number(extracted.trim());
    if (Number.isFinite(parsed)) {
      return { extracted, value: parsed, ok: true };
    }
  }
  if (typeof extracted === "boolean") {
    return { extracted, value: extracted ? 1 : 0, ok: true };
  }
  return { extracted, value: 0, ok: false };
}
