import { EventEmitter } from "node:events";
import type { TagDefinition, TagSnapshot, TagValue } from "@web-scada/shared";

type TagStoreEvents = {
  "tag-changed": (value: TagValue) => void;
};

class TypedTagStoreEmitter extends EventEmitter {
  public override on<K extends keyof TagStoreEvents>(eventName: K, listener: TagStoreEvents[K]): this {
    return super.on(eventName, listener);
  }

  public override off<K extends keyof TagStoreEvents>(eventName: K, listener: TagStoreEvents[K]): this {
    return super.off(eventName, listener);
  }

  public override emit<K extends keyof TagStoreEvents>(eventName: K, ...args: Parameters<TagStoreEvents[K]>): boolean {
    return super.emit(eventName, ...args);
  }
}

export class TagStore {
  private readonly definitions = new Map<string, TagDefinition>();
  private readonly values = new Map<string, TagValue>();
  private readonly emitter = new TypedTagStoreEmitter();

  public setDefinitions(tags: TagDefinition[]): void {
    this.definitions.clear();
    for (const tag of tags) {
      this.definitions.set(tag.name, tag);
      if (!this.values.has(tag.name)) {
        this.values.set(tag.name, {
          name: tag.name,
          value: null,
          quality: "Uncertain",
          timestamp: Date.now(),
          source: "init",
        });
      }
    }
  }

  public getDefinition(name: string): TagDefinition | undefined {
    return this.definitions.get(name);
  }

  public getDefinitions(): TagDefinition[] {
    return [...this.definitions.values()];
  }

  public getValue(name: string): TagValue | undefined {
    return this.values.get(name);
  }

  public getSnapshots(): TagSnapshot[] {
    return [...this.definitions.values()].map((definition) => ({
      definition,
      value:
        this.values.get(definition.name) ?? {
          name: definition.name,
          value: null,
          quality: "Uncertain",
          timestamp: Date.now(),
          source: "missing",
        },
    }));
  }

  public upsertValue(value: TagValue): void {
    const existing = this.values.get(value.name);
    if (
      existing &&
      existing.value === value.value &&
      existing.quality === value.quality &&
      existing.source === value.source
    ) {
      return;
    }

    this.values.set(value.name, value);
    this.emitter.emit("tag-changed", value);
  }

  public subscribe(listener: (value: TagValue) => void): () => void {
    this.emitter.on("tag-changed", listener);
    return () => {
      this.emitter.off("tag-changed", listener);
    };
  }
}
