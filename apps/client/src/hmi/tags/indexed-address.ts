import {
  applyTagIndexTransform,
  extractIndexedAddressSlots,
  getEnabledFrameTagIndexRules,
  getRuntimeValueSourceDependencies,
  resolveRuntimeValueSync,
  resolveIndexedAddress,
  resolveTagName,
  type FrameTagIndexRule,
  type HmiObject,
  type IndexedAddressBinding,
  type IndexedTagAddress,
  type RuntimeDependency,
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

type IndexedRuntimeSources = {
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

export type FrameRuleOffsetResolution = {
  value: number;
  usedSource: boolean;
  fallbackUsed: boolean;
  warning?: string;
};

const tagAddressMapCache = new WeakMap<ScadaProject, Map<string, TagDefinition>>();

export function getTagAddressTemplate(tag: TagDefinition | undefined): string {
  if (!tag) {
    return "";
  }

  const raw = tag as TagDefinition & { addressRaw?: unknown };
  const fromAddress = raw.address && typeof raw.address === "object" ? raw.address as Record<string, unknown> : undefined;
  const candidates = [
    typeof raw.addressRaw === "string" ? raw.addressRaw : undefined,
    typeof tag.address === "string" ? tag.address : undefined,
    tag.nodeId,
    typeof fromAddress?.nodeId === "string" ? fromAddress.nodeId : undefined,
    tag.name,
  ]
    .map((item) => normalizeAddress(item))
    .filter((item): item is string => Boolean(item));

  const uniqueCandidates: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    uniqueCandidates.push(candidate);
  }

  return uniqueCandidates.find((candidate) => extractIndexedAddressSlots(candidate).length > 0)
    ?? uniqueCandidates[0]
    ?? tag.name;
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

export function resolveFrameRuleOffset(
  rule: FrameTagIndexRule,
  input: {
    context: RenderContext;
    runtimeValues?: Record<string, unknown>;
  },
): FrameRuleOffsetResolution {
  const fallbackCandidate = Number(rule.indexOffset);
  const fallback = Number.isFinite(fallbackCandidate) ? fallbackCandidate : 0;

  if (!rule.indexOffsetSource) {
    return {
      value: fallback,
      usedSource: false,
      fallbackUsed: !Number.isFinite(fallbackCandidate),
      warning: Number.isFinite(fallbackCandidate) ? undefined : "Invalid fallback offset. Using 0.",
    };
  }

  const source = rule.indexOffsetSource.type === "tag"
    ? {
        ...rule.indexOffsetSource,
        tag: resolveTagName(rule.indexOffsetSource.tag, input.context) ?? rule.indexOffsetSource.tag,
      }
    : rule.indexOffsetSource;

  const resolved = resolveRuntimeValueSync(source, {
    tagValues: input.runtimeValues,
  });
  const sourceOffset = Number(resolved);

  if (Number.isFinite(sourceOffset)) {
    return {
      value: sourceOffset,
      usedSource: true,
      fallbackUsed: false,
    };
  }

  const warning = resolved === undefined || resolved === null
    ? "Offset source value is unavailable. Fallback offset is used."
    : "Offset source value is not numeric. Fallback offset is used.";

  return {
    value: fallback,
    usedSource: false,
    fallbackUsed: true,
    warning: Number.isFinite(fallbackCandidate) ? warning : `${warning} Fallback offset is invalid; using 0.`,
  };
}

export function collectFrameRuleDependencyTags(rule: FrameTagIndexRule, context: RenderContext): string[] {
  const dependencies = getRuntimeValueSourceDependencies(rule.indexOffsetSource);
  if (dependencies.length === 0) {
    return [];
  }
  const out = new Set<string>();
  for (const dependency of dependencies) {
    const normalized = normalizeRuntimeDependencyTag(dependency, context);
    if (normalized) {
      out.add(normalized);
    }
  }
  return [...out];
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

function normalizeRuntimeDependencyTag(dependency: RuntimeDependency, context: RenderContext): string | undefined {
  if (dependency.type === "tag") {
    const resolved = resolveTagName(dependency.tag, context) ?? dependency.tag;
    const trimmed = resolved.trim();
    return trimmed || undefined;
  }
  if (dependency.type === "lw") {
    return `LW${Math.max(0, Math.floor(dependency.address))}`;
  }
  const raw = dependency.name.trim();
  if (!raw) {
    return undefined;
  }
  if (/^LW\d+$/i.test(raw)) {
    return raw.toUpperCase();
  }
  return raw.startsWith("LW.") ? raw : `LW.${raw}`;
}

function getIndexedBindingRuntimeValue(
  binding: IndexedAddressBinding,
  sources: IndexedRuntimeSources,
): unknown {
  const sourceName = binding.sourceName?.trim();
  if (binding.source === "constant") {
    return binding.constantValue ?? 0;
  }
  if (!sourceName) {
    return undefined;
  }

  switch (binding.source) {
    case "runtimeArg":
      return sources.context?.parameters?.[sourceName]
        ?? (sources.context as Record<string, unknown> | undefined)?.[sourceName];
    case "tag":
      return extractRuntimeTagValue(
        (sources.tagValues as Record<string, unknown> | undefined)?.[sourceName],
      );
    case "internalVariable":
      return findInternalVariableValue(sources.variables, sourceName);
    case "macroVariable":
      return sources.context?.parameters?.[sourceName]
        ?? (sources.context as Record<string, unknown> | undefined)?.[sourceName];
    default:
      return undefined;
  }
}

function findInternalVariableValue(
  variables: ScadaProject["variables"] | undefined,
  name: string,
): unknown {
  const trimmed = name.trim();
  if (!trimmed) {
    return undefined;
  }

  const variable = (variables ?? []).find((item) => (
    item.name === trimmed
    || `LW.${item.name}` === trimmed
    || (typeof item.lwAddress === "number" && `LW${item.lwAddress}` === trimmed)
  ));

  return variable?.currentValue ?? variable?.initialValue;
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
  const localIndexedEnabled = config?.enabled === true;

  if (localIndexedEnabled) {
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

  if (!localIndexedEnabled) {
    const inheritedRules = getEnabledFrameTagIndexRules(params.context.inheritedIndexRules);
    if (inheritedRules.length === 0) {
      return {
        usedIndexedAddress: false,
        rawTagName,
        resolvedTagName: rawTagName,
        errors: [],
        dependencyTags: [],
      };
    }

    const runtimeValues = buildIndexedAddressRuntimeValues({
      context: params.context,
      tagValues: params.tagValues,
      variables: params.project.variables,
    });
    let resolvedTagName = rawTagName;
    const dependencyTags = new Set<string>();
    for (const rule of inheritedRules) {
      const offset = resolveFrameRuleOffset(rule, {
        context: params.context,
        runtimeValues,
      });
      resolvedTagName = applyTagIndexTransform(resolvedTagName, offset.value, rule.indexMode);
      for (const dependency of collectFrameRuleDependencyTags(rule, params.context)) {
        dependencyTags.add(dependency);
      }
    }
    return {
      usedIndexedAddress: true,
      rawTagName,
      resolvedTagName,
      errors: [],
      dependencyTags: [...dependencyTags],
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
  const scopedValues: Record<string, unknown> = { ...values };
  const bindingSourceValues = new Map<string, unknown>();

  for (const binding of normalizedConfig.bindings) {
    const sourceSpecificValue = getIndexedBindingRuntimeValue(binding, {
      context: params.context,
      tagValues: params.tagValues,
      variables: params.project.variables,
    });
    bindingSourceValues.set(binding.key, sourceSpecificValue);
    if (binding.sourceName?.trim()) {
      scopedValues[binding.sourceName.trim()] = sourceSpecificValue;
    }
  }

  for (const binding of normalizedConfig.bindings) {
    if (binding.source !== "tag" || !binding.sourceName) {
      continue;
    }
    const original = config.bindings.find((item) => item.slotIndex === binding.slotIndex)?.sourceName;
    if (!original || original === binding.sourceName) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(scopedValues, binding.sourceName)) {
      scopedValues[original] = scopedValues[binding.sourceName];
    }
  }

  debugIndexedAddress("resolveObjectTagField:values", {
    fieldName: params.fieldName,
    template,
    valuesForBindings: normalizedConfig.bindings.map((binding) => {
      const sourceName = binding.sourceName?.trim();
      const flatValue = sourceName ? values[sourceName] : undefined;
      const sourceSpecificValue = bindingSourceValues.get(binding.key);
      const numericDebug = toIndexedDebugNumber(sourceSpecificValue);
      return {
        key: binding.key,
        source: binding.source,
        sourceName: binding.sourceName,
        flatValue,
        sourceSpecificValue,
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

  debugIndexedAddress("resolveObjectTagField:beforeResolveCall", {
    fieldName: params.fieldName,
    template: normalizedConfig.template,
    bindings: normalizedConfig.bindings,
    valuesCounterFlat: values.Counter,
    valuesCounterScoped: scopedValues.Counter,
    valuesCounterType: typeof scopedValues.Counter,
    valuesHasCounter: Object.prototype.hasOwnProperty.call(scopedValues, "Counter"),
    valuesKeysIncludesCounter: Object.keys(scopedValues).includes("Counter"),
    tagValueCounterRaw: (params.tagValues as Record<string, unknown> | undefined)?.Counter,
    variableCounter: findInternalVariableValue(params.project.variables, "Counter"),
    directManualExpectedAddress:
      typeof scopedValues.Counter === "number"
        ? normalizedConfig.template.replace("[0]", `[${scopedValues.Counter}]`)
        : undefined,
  });

  if (isIndexedAddressDebugEnabled()) {
    const testResolved = resolveIndexedAddress({
      config: {
        enabled: true,
        template: "x[0]",
        bindings: [
          {
            key: "INDEX_1",
            slotIndex: 0,
            baseValue: 0,
            source: "tag",
            sourceName: "Counter",
            constantValue: 0,
            offset: 0,
          },
        ],
      },
      values: { Counter: scopedValues.Counter },
    });

    debugIndexedAddress("resolveObjectTagField:selfTest", {
      counter: scopedValues.Counter,
      result: testResolved,
    });
  }

  const resolved = resolveIndexedAddress({
    config: normalizedConfig,
    values: scopedValues,
  });
  debugIndexedAddress("resolveObjectTagField:afterResolveCall", {
    address: resolved.address,
    parts: resolved.parts,
    errors: resolved.errors,
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
