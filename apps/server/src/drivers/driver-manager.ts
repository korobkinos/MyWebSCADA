import type { DriverConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import { logPerf } from "../runtime/perf-logger.js";
import type { Driver, DriverStatus } from "./driver.js";
import { OpcUaDriver } from "./opcua-driver.js";
import { SimulatedDriver } from "./simulated-driver.js";

function createDriver(config: DriverConfig): Driver {
  if (config.type === "simulated") {
    return new SimulatedDriver(config);
  }
  return new OpcUaDriver(config);
}

type IndexedTag = {
  tag: TagDefinition;
  index: number;
};

type DriverReadResult = {
  driverId: string;
  indexedTags: IndexedTag[];
  values: TagValue[];
};

export class DriverManager {
  private readonly drivers = new Map<string, Driver>();
  private readonly statuses = new Map<string, DriverStatus>();
  private defaultSimulatedDriverId: string | null = null;
  private readonly driverReadTimeoutMs = 2000;
  private readonly driverWriteTimeoutMs = 2000;
  private readonly unavailableLogThrottleMs = 5000;
  private readonly unavailableLogAt = new Map<string, number>();

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

  public getTagDriverStatus(tag: TagDefinition): DriverStatus | undefined {
    const driverId = this.resolveDriverId(tag);
    if (!driverId) {
      return undefined;
    }
    return this.getStatus(driverId);
  }

  public isTagDriverAvailable(tag: TagDefinition): boolean {
    const driverId = this.resolveDriverId(tag);
    if (!driverId) {
      if (tag.sourceType === "simulated" && this.defaultSimulatedDriverId) {
        return this.isDriverStatusAvailable(this.getStatus(this.defaultSimulatedDriverId));
      }
      return false;
    }
    const driver = this.drivers.get(driverId);
    if (!driver) {
      return false;
    }
    return this.isDriverStatusAvailable(this.getStatus(driverId));
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
      this.logUnavailableOnce("readTag", driverId, tag.name);
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: driverId,
      };
    }

    if (!this.isTagDriverAvailable(tag)) {
      this.logUnavailableOnce("readTag", driverId, tag.name);
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: driverId,
      };
    }

    const startedAt = Date.now();
    try {
      const value = await this.withTimeout(
        driver.readTag(tag),
        this.driverReadTimeoutMs,
        `Read timeout for tag ${tag.name} after ${this.driverReadTimeoutMs} ms`,
      );
      logPerf({
        component: "driver-manager",
        action: "readTag",
        driverId,
        tag: tag.name,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPerf({
        component: "driver-manager",
        action: "readTag",
        driverId,
        tag: tag.name,
        durationMs: Date.now() - startedAt,
        status: "error",
        message,
      });
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: driverId,
      };
    }
  }

  public async readTags(tags: TagDefinition[]): Promise<TagValue[]> {
    if (tags.length === 0) {
      return [];
    }

    const timestamp = Date.now();
    const startedAt = Date.now();
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

    const tasks = [...byDriver.entries()].map(([driverId, indexedTags]) => this.readDriverTags(driverId, indexedTags));
    const settled = await Promise.allSettled(tasks);

    for (const settledItem of settled) {
      if (settledItem.status !== "fulfilled") {
        continue;
      }
      const readResult = settledItem.value;
      const valuesByName = new Map(readResult.values.map((value) => [value.name, value]));
      for (let localIndex = 0; localIndex < readResult.indexedTags.length; localIndex += 1) {
        const target = readResult.indexedTags[localIndex]!;
        const valueByPosition = readResult.values[localIndex];
        const valueByName = valuesByName.get(target.tag.name);
        result[target.index] = valueByName ?? valueByPosition ?? {
          name: target.tag.name,
          value: null,
          quality: "Bad",
          timestamp: Date.now(),
          source: readResult.driverId,
        };
      }
    }

    logPerf({
      component: "driver-manager",
      action: "readTags",
      tagCount: tags.length,
      driverCount: byDriver.size,
      durationMs: Date.now() - startedAt,
    });

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
      this.logUnavailableOnce("writeTag", driverId, tag.name);
      throw new Error(`Driver ${driverId} is unavailable`);
    }

    if (!this.isTagDriverAvailable(tag)) {
      this.logUnavailableOnce("writeTag", driverId, tag.name);
      throw new Error(`Driver ${driverId} is unavailable for tag ${tag.name}`);
    }

    const startedAt = Date.now();
    try {
      await this.withTimeout(
        driver.writeTag(tag, value),
        this.driverWriteTimeoutMs,
        `Write timeout for tag ${tag.name} after ${this.driverWriteTimeoutMs} ms`,
      );
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

  private async readDriverTags(driverId: string, indexedTags: IndexedTag[]): Promise<DriverReadResult> {
    const driver = this.drivers.get(driverId);

    if (!driver || !this.isDriverStatusAvailable(this.getStatus(driverId))) {
      this.logUnavailableOnce("readTags", driverId);
      const driverTimestamp = Date.now();
      return {
        driverId,
        indexedTags,
        values: indexedTags.map((item) => ({
          name: item.tag.name,
          value: null,
          quality: "Bad" as const,
          timestamp: driverTimestamp,
          source: driverId,
        })),
      };
    }

    const driverTags = indexedTags.map((item) => item.tag);
    const startedAt = Date.now();
    try {
      const values = driver.readTags
        ? await this.withTimeout(
            driver.readTags(driverTags),
            this.driverReadTimeoutMs,
            `Read timeout for driver ${driverId} after ${this.driverReadTimeoutMs} ms`,
          )
        : await this.withTimeout(
            Promise.all(driverTags.map((tag) => driver.readTag(tag))),
            this.driverReadTimeoutMs,
            `Read timeout for driver ${driverId} after ${this.driverReadTimeoutMs} ms`,
          );

      logPerf({
        component: "driver-manager",
        action: "driver-read",
        driverId,
        tagCount: driverTags.length,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });

      return { driverId, indexedTags, values };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPerf({
        component: "driver-manager",
        action: "driver-read",
        driverId,
        tagCount: driverTags.length,
        durationMs: Date.now() - startedAt,
        status: "error",
        message,
      });
      const failTimestamp = Date.now();
      return {
        driverId,
        indexedTags,
        values: indexedTags.map((item) => ({
          name: item.tag.name,
          value: null,
          quality: "Bad" as const,
          timestamp: failTimestamp,
          source: driverId,
        })),
      };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private isDriverStatusAvailable(status: DriverStatus | undefined): boolean {
    if (!status) {
      return false;
    }
    switch (String(status.health).toLowerCase()) {
      case "connected":
      case "ok":
      case "running":
      case "healthy":
        return true;
      case "error":
      case "stopped":
      case "disabled":
      case "reconnecting":
      case "disconnected":
      case "starting":
        return false;
      default:
        return false;
    }
  }

  private logUnavailableOnce(action: "readTag" | "readTags" | "writeTag", driverId: string, tagName?: string): void {
    const key = `${action}:${driverId}`;
    const now = Date.now();
    const lastAt = this.unavailableLogAt.get(key) ?? 0;
    if (now - lastAt < this.unavailableLogThrottleMs) {
      return;
    }
    this.unavailableLogAt.set(key, now);
    const tagPart = tagName ? ` tag=${tagName}` : "";
    console.warn(`[DriverManager] skip ${action}: driver unavailable driverId=${driverId}${tagPart}`);
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
