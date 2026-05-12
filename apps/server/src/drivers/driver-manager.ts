import type { DriverConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";
import { OpcUaDriver } from "./opcua-driver.js";
import { SimulatedDriver } from "./simulated-driver.js";

function createDriver(config: DriverConfig): Driver {
  if (config.type === "simulated") {
    return new SimulatedDriver(config);
  }
  return new OpcUaDriver(config);
}

export class DriverManager {
  private readonly drivers = new Map<string, Driver>();
  private readonly statuses = new Map<string, DriverStatus>();
  private defaultSimulatedDriverId: string | null = null;

  public configure(configs: DriverConfig[]): void {
    this.statuses.clear();
    this.drivers.clear();
    this.defaultSimulatedDriverId = null;
    for (const config of configs) {
      if (!config.enabled) {
        this.statuses.set(config.id, {
          id: config.id,
          type: config.type,
          health: "disabled",
          updatedAt: Date.now(),
          message: "Driver disabled",
        });
        continue;
      }
      const driver = createDriver(config);
      this.drivers.set(config.id, driver);
      this.statuses.set(config.id, driver.getStatus());
      if (config.type === "simulated" && !this.defaultSimulatedDriverId) {
        this.defaultSimulatedDriverId = config.id;
      }
    }
  }

  public async startAll(): Promise<void> {
    const startTasks = [...this.drivers.values()].map((driver) => driver.start().catch(() => undefined));
    await Promise.all(startTasks);
  }

  public async stopAll(): Promise<void> {
    await Promise.all([...this.drivers.values()].map((driver) => driver.stop().catch(() => undefined)));
  }

  public getStatuses(): DriverStatus[] {
    for (const driver of this.drivers.values()) {
      this.statuses.set(driver.id, driver.getStatus());
    }
    return [...this.statuses.values()];
  }

  public getStatus(driverId: string): DriverStatus | undefined {
    const driver = this.drivers.get(driverId);
    if (driver) {
      const status = driver.getStatus();
      this.statuses.set(driverId, status);
      return status;
    }
    return this.statuses.get(driverId);
  }

  public async connectDriver(config: DriverConfig): Promise<DriverStatus> {
    const existing = this.drivers.get(config.id);
    if (existing) {
      await existing.stop().catch(() => undefined);
      this.drivers.delete(config.id);
    }

    const normalized: DriverConfig = config.enabled ? config : { ...config, enabled: true };
    const driver = createDriver(normalized);
    this.drivers.set(normalized.id, driver);
    this.statuses.set(normalized.id, driver.getStatus());
    try {
      await driver.start();
    } finally {
      this.statuses.set(normalized.id, driver.getStatus());
    }
    return this.statuses.get(normalized.id)!;
  }

  public async disconnectDriver(driverId: string): Promise<DriverStatus> {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      const fallback: DriverStatus = this.statuses.get(driverId) ?? {
        id: driverId,
        type: "opcua",
        health: "stopped",
        updatedAt: Date.now(),
      };
      const next = { ...fallback, health: "stopped" as const, message: "Disconnected by user", updatedAt: Date.now() };
      this.statuses.set(driverId, next);
      return next;
    }

    await driver.stop().catch(() => undefined);
    this.drivers.delete(driverId);
    const next: DriverStatus = {
      ...driver.getStatus(),
      health: "stopped",
      message: "Disconnected by user",
      updatedAt: Date.now(),
    };
    this.statuses.set(driverId, next);
    return next;
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    const driverId = this.resolveDriverId(tag);
    if (!driverId) {
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: "none",
      };
    }

    const driver = this.drivers.get(driverId);
    if (!driver) {
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: driverId,
      };
    }

    return driver.readTag(tag);
  }


public async readTags(tags: TagDefinition[]): Promise<TagValue[]> {
  if (tags.length === 0) {
    return [];
  }

  type IndexedTag = {
    tag: TagDefinition;
    index: number;
  };

  const timestamp = Date.now();
  const result: Array<TagValue | undefined> = new Array(tags.length);
  const byDriver = new Map<string, IndexedTag[]>();

    for (let index = 0; index < tags.length; index += 1) {
      const tag = tags[index]!;
      const driverId = this.resolveDriverId(tag);

      if (!driverId) {
        result[index] = {
          name: tag.name,
          value: null,
          quality: "Bad",
          timestamp,
        source: "none",
      };
      continue;
      }

      const group = byDriver.get(driverId);
      if (group) {
        group.push({ tag, index });
      } else {
        byDriver.set(driverId, [{ tag, index }]);
      }
  }

  for (const [driverId, indexedTags] of byDriver.entries()) {
    const driver = this.drivers.get(driverId);

    if (!driver) {
      const driverTimestamp = Date.now();
      for (const item of indexedTags) {
        result[item.index] = {
          name: item.tag.name,
          value: null,
          quality: "Bad",
          timestamp: driverTimestamp,
          source: driverId,
        };
      }
      continue;
    }

    const driverTags = indexedTags.map((item) => item.tag);

    if (driver.readTags) {
      const values = await driver.readTags(driverTags);

      // Основной путь: драйвер вернул значения в том же порядке, что и получил теги.
      // Дополнительная защита: если порядок нарушен, пытаемся сопоставить по имени тега.
      const valuesByName = new Map(values.map((value) => [value.name, value]));

      for (let localIndex = 0; localIndex < indexedTags.length; localIndex += 1) {
        const item = indexedTags[localIndex]!;
        const valueByPosition = values[localIndex];
        const valueByName = valuesByName.get(item.tag.name);

        result[item.index] = valueByName ?? valueByPosition ?? {
          name: item.tag.name,
          value: null,
          quality: "Bad",
          timestamp: Date.now(),
          source: driverId,
        };
      }
      continue;
    }

    const values = await Promise.all(driverTags.map((tag) => driver.readTag(tag)));
    for (let localIndex = 0; localIndex < indexedTags.length; localIndex += 1) {
      const item = indexedTags[localIndex]!;
      result[item.index] = values[localIndex] ?? {
        name: item.tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: driverId,
      };
    }
  }

  return result.map((value, index) => {
    if (value) {
      return value;
    }

      const tag = tags[index]!;
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: this.resolveDriverId(tag) ?? "none",
      };
    });
}


  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    const driverId = this.resolveDriverId(tag);
    if (!driverId) {
      throw new Error(`Tag ${tag.name} has no driver`);
    }

    const driver = this.drivers.get(driverId);
    if (!driver) {
      throw new Error(`Driver ${driverId} is unavailable`);
    }
    const startedAt = Date.now();
    try {
      await driver.writeTag(tag, value);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const text = error instanceof Error ? error.message : String(error);
      console.error(
        `[DriverManager] writeTag failed driverId=${driverId} tag=${tag.name} durationMs=${durationMs} error=${text}`,
      );
      throw error;
    }
    const durationMs = Date.now() - startedAt;
    if (durationMs > 250) {
      console.warn(`[DriverManager] Slow writeTag driverId=${driverId} tag=${tag.name} durationMs=${durationMs}`);
    }
  }

  private resolveDriverId(tag: TagDefinition): string | undefined {
    if (tag.driverId) {
      return tag.driverId;
    }
    if (tag.sourceType === "simulated" && this.defaultSimulatedDriverId) {
      return this.defaultSimulatedDriverId;
    }
    return undefined;
  }
}
