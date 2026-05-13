export type IndexedAddressValueSource =
  | "constant"
  | "runtimeArg"
  | "internalVariable"
  | "tag"
  | "macroVariable";

export type IndexedAddressBinding = {
  key: string;
  slotIndex: number;
  baseValue: number;
  source: IndexedAddressValueSource;
  sourceName?: string;
  constantValue?: number;
  offset?: number;
};

export type IndexedTagAddress = {
  enabled: boolean;
  template: string;
  bindings: IndexedAddressBinding[];
};

export type IndexedAddressSlot = {
  key: string;
  slotIndex: number;
  baseValue: number;
  start: number;
  end: number;
  token: string;
};

export type ResolveIndexedAddressInput = {
  config: IndexedTagAddress;
  values: Record<string, unknown>;
};

export type ResolveIndexedAddressPart = {
  key: string;
  baseValue: number;
  runtimeValue: number;
  offset: number;
  resultValue: number;
  source: IndexedAddressValueSource;
  sourceName?: string;
};

export type ResolveIndexedAddressOutput = {
  address: string;
  parts: ResolveIndexedAddressPart[];
  errors: string[];
};

const INDEX_SLOT_PATTERN = /\[(\d+)\]/g;

export function extractIndexedAddressSlots(template: string): IndexedAddressSlot[] {
  if (!template) {
    return [];
  }

  const slots: IndexedAddressSlot[] = [];
  INDEX_SLOT_PATTERN.lastIndex = 0;
  let match = INDEX_SLOT_PATTERN.exec(template);
  while (match) {
    const token = match[0];
    const tokenValue = Number(match[1]);
    const start = match.index;
    const slotIndex = slots.length;
    slots.push({
      key: `INDEX_${slotIndex + 1}`,
      slotIndex,
      baseValue: Number.isFinite(tokenValue) ? tokenValue : 0,
      start,
      end: start + token.length,
      token,
    });
    match = INDEX_SLOT_PATTERN.exec(template);
  }

  return slots;
}

export function resolveIndexedAddress(input: ResolveIndexedAddressInput): ResolveIndexedAddressOutput {
  const template = input.config.template ?? "";
  const slots = extractIndexedAddressSlots(template);
  if (!slots.length) {
    return {
      address: template,
      parts: [],
      errors: [],
    };
  }

  const errors: string[] = [];
  const bindingsBySlot = new Map<number, IndexedAddressBinding>();
  for (const binding of input.config.bindings ?? []) {
    const normalizedSlotIndex = toSlotIndex(binding.slotIndex);
    if (normalizedSlotIndex === undefined) {
      continue;
    }
    if (!bindingsBySlot.has(normalizedSlotIndex)) {
      bindingsBySlot.set(normalizedSlotIndex, {
        ...binding,
        slotIndex: normalizedSlotIndex,
      });
    }
  }

  const replacements: string[] = [];
  const parts: ResolveIndexedAddressPart[] = [];

  for (const slot of slots) {
    const binding = bindingsBySlot.get(slot.slotIndex) ?? bindingsBySlot.get(slot.slotIndex + 1) ?? {
      key: slot.key,
      slotIndex: slot.slotIndex,
      baseValue: slot.baseValue,
      source: "constant" as const,
      constantValue: 0,
      offset: 0,
    };
    const runtimeValue = resolveRuntimeValue(binding, input.values, errors);
    const offset = toNumeric(binding.offset, `${binding.key} offset`, errors);
    const resultValue = slot.baseValue + runtimeValue + offset;

    parts.push({
      key: binding.key || slot.key,
      baseValue: slot.baseValue,
      runtimeValue,
      offset,
      resultValue,
      source: binding.source,
      sourceName: binding.sourceName,
    });
    replacements.push(`[${formatIndexNumber(resultValue)}]`);
  }

  let address = "";
  let cursor = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    address += template.slice(cursor, slot.start);
    address += replacements[index]!;
    cursor = slot.end;
  }
  address += template.slice(cursor);

  return {
    address,
    parts,
    errors,
  };
}

function resolveRuntimeValue(
  binding: IndexedAddressBinding,
  values: Record<string, unknown>,
  errors: string[],
): number {
  if (binding.source === "constant") {
    return toNumeric(binding.constantValue, `${binding.key} constant`, errors);
  }

  const sourceName = (binding.sourceName ?? "").trim();
  if (!sourceName) {
    errors.push(`${binding.key}: sourceName is missing`);
    return 0;
  }

  let rawRuntimeValue: unknown;
  switch (binding.source) {
    case "runtimeArg":
    case "internalVariable":
    case "tag":
    case "macroVariable":
      rawRuntimeValue = values[sourceName];
      break;
    default:
      rawRuntimeValue = values[sourceName];
      break;
  }

  const numeric = toIndexedNumber(rawRuntimeValue);
  if (!numeric.ok) {
    errors.push(`${binding.key}: value "${sourceName}" is missing or non-numeric`);
    return 0;
  }
  return numeric.value;
}

function toMaybeNumeric(value: unknown): number | undefined {
  const numeric = toIndexedNumber(value);
  if (numeric.ok) {
    return numeric.value;
  }
  return undefined;
}

function extractIndexedSourceValue(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "value" in raw
  ) {
    return (raw as { value?: unknown }).value;
  }
  return raw;
}

function toIndexedNumber(raw: unknown): { value: number; ok: boolean } {
  const extracted = extractIndexedSourceValue(raw);

  if (typeof extracted === "number") {
    return Number.isFinite(extracted)
      ? { value: extracted, ok: true }
      : { value: 0, ok: false };
  }
  if (typeof extracted === "string" && extracted.trim() !== "") {
    const parsed = Number(extracted.trim());
    if (Number.isFinite(parsed)) {
      return { value: parsed, ok: true };
    }
  }
  if (typeof extracted === "boolean") {
    return { value: extracted ? 1 : 0, ok: true };
  }

  return { value: 0, ok: false };
}

function toNumeric(value: unknown, label: string, errors: string[]): number {
  const numeric = toMaybeNumeric(value);
  if (numeric === undefined) {
    if (value !== undefined) {
      errors.push(`${label} is non-numeric`);
    }
    return 0;
  }
  return numeric;
}

function formatIndexNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

function toSlotIndex(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}
