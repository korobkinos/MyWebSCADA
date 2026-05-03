import type { InternalVariableDefinition, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";

export function toInternalTagName(name: string): string {
  return name.startsWith("LW.") ? name : `LW.${name}`;
}

export function variableToTagDefinition(variable: InternalVariableDefinition): TagDefinition {
  return {
    name: toInternalTagName(variable.name),
    description: variable.description,
    dataType: variable.dataType,
    writable: variable.writable ?? true,
  };
}

export class InternalVariableService {
  public constructor(private readonly tagStore: TagStore) {}

  public setup(variables: InternalVariableDefinition[]): void {
    for (const variable of variables) {
      const name = toInternalTagName(variable.name);
      this.tagStore.upsertValue({
        name,
        value: variable.initialValue ?? null,
        quality: "Good",
        timestamp: Date.now(),
        source: "internal",
      });
    }
  }

  public getAll(): TagValue[] {
    return this.tagStore
      .getDefinitions()
      .filter((definition) => definition.name.startsWith("LW."))
      .map((definition) => this.tagStore.getValue(definition.name))
      .filter((value): value is TagValue => Boolean(value));
  }

  public get(name: string): TagValue | undefined {
    return this.tagStore.getValue(toInternalTagName(name));
  }

  public write(name: string, value: TagScalarValue): void {
    const tagName = toInternalTagName(name);
    this.tagStore.upsertValue({
      name: tagName,
      value,
      quality: "Good",
      timestamp: Date.now(),
      source: "internal",
    });
  }
}
