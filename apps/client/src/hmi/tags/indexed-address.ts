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
    const value = payload?.value;
    values[tagName] = value;
    if (tagName.startsWith("LW.") && tagName.length > 3) {
      values[tagName.slice(3)] = value;
    }
  }

  return values;
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

  const resolved = resolveIndexedAddress({
    config: normalizedConfig,
    values,
  });
  const matchingTag = findTagByAddress(params.project, resolved.address);
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
