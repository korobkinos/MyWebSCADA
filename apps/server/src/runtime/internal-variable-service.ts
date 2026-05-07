import type { InternalVariableDefinition, LwStoreConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";

const LW_ADDRESS_NAME = /^LW\d+$/i;

export function toLwTagName(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

export function toInternalTagName(name: string): string {
  const trimmed = name.trim();
  if (LW_ADDRESS_NAME.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed.startsWith("LW.") ? trimmed : `LW.${trimmed}`;
}

export function variableToTagDefinitions(variable: InternalVariableDefinition): TagDefinition[] {
  const out: TagDefinition[] = [];
  out.push({
    name: toInternalTagName(variable.name),
    description: variable.description,
    dataType: variable.dataType,
    writable: variable.writable ?? true,
    sourceType: "internal",
    internalVariableName: variable.name,
    persistent: variable.persistent,
  });
  if (typeof variable.lwAddress === "number" && Number.isFinite(variable.lwAddress)) {
    out.push({
      name: toLwTagName(variable.lwAddress),
      description: variable.description ?? variable.name,
      dataType: variable.dataType,
      writable: variable.writable ?? true,
      sourceType: "lw",
      lwAddress: variable.lwAddress,
      persistent: variable.persistent,
    });
  }
  return out;
}

export function lwStoreToTagDefinitions(lwStore: LwStoreConfig | undefined): TagDefinition[] {
  const values = lwStore?.values ?? {};
  return Object.keys(values)
    .map((addressText) => Number(addressText))
    .filter((address) => Number.isFinite(address))
    .map((address) => ({
      name: toLwTagName(address),
      description: `LW address ${address}`,
      sourceType: "lw" as const,
      dataType: "INT" as const,
      lwAddress: address,
      writable: true,
      persistent: lwStore?.mode === "persistent",
    }));
}

export function buildInternalAndLwTagDefinitions(
  variables: InternalVariableDefinition[],
  lwStore?: LwStoreConfig,
): TagDefinition[] {
  const byName = new Map<string, TagDefinition>();
  for (const variable of variables) {
    for (const definition of variableToTagDefinitions(variable)) {
      byName.set(definition.name, definition);
    }
  }
  for (const definition of lwStoreToTagDefinitions(lwStore)) {
    if (!byName.has(definition.name)) {
      byName.set(definition.name, definition);
    }
  }
  return [...byName.values()];
}

export class InternalVariableService {
  private readonly aliasToLwTag = new Map<string, string>();
  private readonly lwTagToAliases = new Map<string, string[]>();

  public constructor(private readonly tagStore: TagStore) {}

  public setup(variables: InternalVariableDefinition[], lwStore?: LwStoreConfig): void {
    this.aliasToLwTag.clear();
    this.lwTagToAliases.clear();
    const lwValues = lwStore?.values ?? {};

    for (const variable of variables) {
      const aliasTag = toInternalTagName(variable.name);
      const lwTag =
        typeof variable.lwAddress === "number" && Number.isFinite(variable.lwAddress)
          ? toLwTagName(variable.lwAddress)
          : undefined;
      const lwValue =
        lwTag && typeof variable.lwAddress === "number"
          ? lwValues[variable.lwAddress]
          : undefined;
      const initialValue: TagScalarValue = lwValue ?? variable.initialValue ?? null;

      if (lwTag) {
        this.aliasToLwTag.set(aliasTag, lwTag);
        const aliases = this.lwTagToAliases.get(lwTag) ?? [];
        this.lwTagToAliases.set(lwTag, [...aliases, aliasTag]);
        this.tagStore.upsertValue({
          name: lwTag,
          value: initialValue,
          quality: "Good",
          timestamp: Date.now(),
          source: "lw",
        });
      }

      this.tagStore.upsertValue({
        name: aliasTag,
        value: initialValue,
        quality: "Good",
        timestamp: Date.now(),
        source: "internal",
      });
    }

    for (const [addressText, value] of Object.entries(lwValues)) {
      const address = Number(addressText);
      if (!Number.isFinite(address)) {
        continue;
      }
      const lwTag = toLwTagName(address);
      if (!this.tagStore.getDefinition(lwTag)) {
        continue;
      }
      this.tagStore.upsertValue({
        name: lwTag,
        value,
        quality: "Good",
        timestamp: Date.now(),
        source: "lw",
      });
    }
  }

  public getAll(): TagValue[] {
    return this.tagStore
      .getDefinitions()
      .filter(
        (definition) =>
          definition.sourceType === "lw" ||
          definition.sourceType === "internal" ||
          definition.name.startsWith("LW."),
      )
      .map((definition) => this.tagStore.getValue(definition.name))
      .filter((value): value is TagValue => Boolean(value));
  }

  public get(name: string): TagValue | undefined {
    const direct = this.tagStore.getValue(name);
    if (direct) {
      return direct;
    }
    return this.tagStore.getValue(toInternalTagName(name));
  }

  public write(name: string, value: TagScalarValue): void {
    const directTag = this.tagStore.getDefinition(name) ? name : undefined;
    const normalizedTag = directTag ?? toInternalTagName(name);
    const effectiveTag = this.tagStore.getDefinition(normalizedTag) ? normalizedTag : toInternalTagName(name);
    const timestamp = Date.now();

    this.tagStore.upsertValue({
      name: effectiveTag,
      value,
      quality: "Good",
      timestamp,
      source: LW_ADDRESS_NAME.test(effectiveTag) ? "lw" : "internal",
    });

    const lwTag = LW_ADDRESS_NAME.test(effectiveTag) ? effectiveTag : this.aliasToLwTag.get(effectiveTag);
    if (lwTag) {
      if (lwTag !== effectiveTag) {
        this.tagStore.upsertValue({
          name: lwTag,
          value,
          quality: "Good",
          timestamp,
          source: "lw",
        });
      }
      for (const alias of this.lwTagToAliases.get(lwTag) ?? []) {
        if (alias === effectiveTag) {
          continue;
        }
        this.tagStore.upsertValue({
          name: alias,
          value,
          quality: "Good",
          timestamp,
          source: "internal",
        });
      }
    }
  }
}
