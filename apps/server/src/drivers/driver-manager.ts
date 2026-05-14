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
  durationMs: number;
  batchCount: number;
  skipped: boolean;
};

export class DriverManager {
  private readonly drivers = new Map<string, Driver>();
  private readonly statuses = new Map<string, DriverStatus>();
  private defaultSimulatedDriverId: string | null = null;
  private readonly driverReadTimeoutMs = 2000;
  private readonly driverWriteTimeoutMs = 2000;
  private readonly opcUaReadBatchSize = 100;
  private readonly slowBatchWarnMs = 500;
  private readonly unavailableLogThrottleMs = 10000;
  private readonly unavailableLogAt = new Map<string, number>();
  private readonly runtimeDebug = process.env.DEBUG_RUNTIME_COMMANDS === "1";

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
          endpointUrl: config.type === "opcua" ? config.endpointUrl : undefined,
          reconnectAttempt: 0,
          readMode: config.type === "opcua" ? (config.readMode ?? "subscription") : undefined,
          subscriptionState: config.type === "opcua" ? "inactive" : undefined,
          subscriptionActive: config.type === "opcua" ? false : undefined,
        });
        continue;
      }
      const driver = createDriver(config);
      this.drivers.set(config.id, driver);
      this.mergeStatus(config.id, driver.getStatus());
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
      this.refreshDriverStatus(driver.id);
    }
    return [...this.statuses.values()];
  }

  public getStatus(driverId: string): DriverStatus | undefined {
    return this.refreshDriverStatus(driverId) ?? this.statuses.get(driverId);
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
        return this.isDriverAvailable(this.defaultSimulatedDriverId);
      }
      return false;
    }
    return this.isDriverAvailable(driverId);
  }

  public isDriverAvailable(driverId: string): boolean {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      return false;
    }
    const status = this.getStatus(driverId);
    if (!this.isDriverStatusAvailable(status)) {
      return false;
    }
    if (typeof driver.isAvailable === "function" && !driver.isAvailable()) {
      return false;
    }
    return true;
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
    this.mergeStatus(normalized.id, driver.getStatus());
    try {
      await driver.start();
    } finally {
      this.mergeStatus(normalized.id, driver.getStatus());
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
      const next = {
        ...fallback,
        health: "stopped" as const,
        message: "Disconnected by user",
        updatedAt: Date.now(),
        reconnectAttempt: 0,
        lastDisconnectedAt: Date.now(),
        pollingSkipped: true,
        pollingSkipReason: `driver ${driverId} is stopped`,
      };
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
      reconnectAttempt: 0,
      lastDisconnectedAt: Date.now(),
      pollingSkipped: true,
      pollingSkipReason: `driver ${driverId} is stopped`,
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

    if (!this.isDriverAvailable(driverId)) {
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

    if (this.runtimeDebug) {
      const perDriver = [...byDriver.entries()].map(([driverId, indexedTags]) => `${driverId}:${indexedTags.length}`).join(", ");
      console.log(`[DriverManager] readTags start total=${tags.length} drivers=${byDriver.size}${perDriver ? ` perDriver=[${perDriver}]` : ""}`);
    }

    const tasks = [...byDriver.entries()].map(([driverId, indexedTags]) => this.readDriverTags(driverId, indexedTags));
    const settled = await Promise.allSettled(tasks);

    for (const settledItem of settled) {
      if (settledItem.status !== "fulfilled") {
        continue;
      }
      const readResult = settledItem.value;
      if (this.runtimeDebug) {
        console.log(
          `[DriverManager] readTags driver=${readResult.driverId} tags=${readResult.indexedTags.length} durationMs=${readResult.durationMs} batches=${readResult.batchCount} skipped=${readResult.skipped ? "1" : "0"}`,
        );
      }
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

    if (this.runtimeDebug) {
      console.log(`[DriverManager] readTags end total=${tags.length} durationMs=${Date.now() - startedAt}`);
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
      this.logUnavailableOnce("writeTag", driverId, tag.name);
      throw new Error(`Driver ${driverId} is unavailable`);
    }

    if (!this.isDriverAvailable(driverId)) {
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

  public async subscribeTags(
    driverId: string,
    tags: TagDefinition[],
    onValues: (values: TagValue[]) => void,
  ): Promise<void> {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      throw new Error(`Driver ${driverId} is unavailable`);
    }
    if (!driver.subscribeTags) {
      throw new Error(`Driver ${driverId} does not support subscription mode`);
    }
    await driver.subscribeTags(tags, onValues);
    this.mergeStatus(driverId, driver.getStatus());
  }

  public async unsubscribeDriver(driverId: string): Promise<void> {
    const driver = this.drivers.get(driverId);
    if (!driver || !driver.unsubscribe) {
      return;
    }
    await driver.unsubscribe();
    this.mergeStatus(driverId, driver.getStatus());
  }

  private async readDriverTags(driverId: string, indexedTags: IndexedTag[]): Promise<DriverReadResult> {
    const driver = this.drivers.get(driverId);
    const startedAt = Date.now();

    if (!driver || !this.isDriverAvailable(driverId)) {
      this.logUnavailableOnce("readTags", driverId);
      const driverTimestamp = Date.now();
      const skippedReason = this.getUnavailableReason(driverId);
      this.updatePollingStatus(driverId, {
        lastPollAt: driverTimestamp,
        lastPollDurationMs: driverTimestamp - startedAt,
        lastPollTagCount: indexedTags.length,
        lastPollBatchCount: 0,
        pollingSkipped: true,
        pollingSkipReason: skippedReason,
      });
      if (this.runtimeDebug) {
        console.log(`[DriverManager] readTags skipped driver=${driverId} reason="${skippedReason}"`);
      }
      return {
        driverId,
        indexedTags,
        values: this.createBadValues(indexedTags, driverId, driverTimestamp),
        durationMs: driverTimestamp - startedAt,
        batchCount: 0,
        skipped: true,
      };
    }

    const driverTags = indexedTags.map((item) => item.tag);
    const isOpcUaBatched = driver.type === "opcua" && Boolean(driver.readTags);

    try {
      let values: TagValue[];
      let batchCount = 1;
      let skipped = false;
      if (isOpcUaBatched) {
        const batchResult = await this.readOpcUaBatches(driverId, driver, indexedTags);
        values = batchResult.values;
        batchCount = batchResult.batchCount;
        skipped = batchResult.skipped;
      } else {
        values = driver.readTags
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
      }

      const durationMs = Date.now() - startedAt;
      this.updatePollingStatus(driverId, {
        lastPollAt: Date.now(),
        lastPollDurationMs: durationMs,
        lastPollTagCount: driverTags.length,
        lastPollBatchCount: batchCount,
        pollingSkipped: skipped,
        pollingSkipReason: skipped ? this.getUnavailableReason(driverId) : undefined,
      });

      logPerf({
        component: "driver-manager",
        action: "driver-read",
        driverId,
        tagCount: driverTags.length,
        durationMs,
        status: "ok",
      });

      return { driverId, indexedTags, values, durationMs, batchCount, skipped };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      logPerf({
        component: "driver-manager",
        action: "driver-read",
        driverId,
        tagCount: driverTags.length,
        durationMs,
        status: "error",
        message,
      });
      const failTimestamp = Date.now();
      this.updatePollingStatus(driverId, {
        lastPollAt: failTimestamp,
        lastPollDurationMs: durationMs,
        lastPollTagCount: driverTags.length,
        lastPollBatchCount: isOpcUaBatched ? Math.max(1, Math.ceil(driverTags.length / this.opcUaReadBatchSize)) : 1,
        pollingSkipped: false,
        pollingSkipReason: undefined,
      });
      return {
        driverId,
        indexedTags,
        values: this.createBadValues(indexedTags, driverId, failTimestamp),
        durationMs,
        batchCount: isOpcUaBatched ? Math.max(1, Math.ceil(driverTags.length / this.opcUaReadBatchSize)) : 1,
        skipped: false,
      };
    }
  }

  private async readOpcUaBatches(
    driverId: string,
    driver: Driver,
    indexedTags: IndexedTag[],
  ): Promise<{ values: TagValue[]; batchCount: number; skipped: boolean }> {
    const readTags = driver.readTags;
    if (!readTags) {
      return {
        values: this.createBadValues(indexedTags, driverId),
        batchCount: 0,
        skipped: true,
      };
    }

    const values: TagValue[] = [];
    const batches = this.chunkIndexedTags(indexedTags, this.opcUaReadBatchSize);
    let skipped = false;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!;
      if (!this.isDriverAvailable(driverId)) {
        const remaining = indexedTags.slice(values.length);
        values.push(...this.createBadValues(remaining, driverId));
        skipped = true;
        this.logUnavailableOnce("readTags", driverId);
        if (this.runtimeDebug) {
          console.log(`[DriverManager] OPC UA batch stop driver=${driverId} batch=${batchIndex + 1}/${batches.length} reason=unavailable`);
        }
        break;
      }

      const batchStartedAt = Date.now();
      try {
        const batchTags = batch.map((item) => item.tag);
        const batchValues = await this.withTimeout(
          readTags.call(driver, batchTags),
          this.driverReadTimeoutMs,
          `Read timeout for driver ${driverId} batch ${batchIndex + 1}/${batches.length} after ${this.driverReadTimeoutMs} ms`,
        );
        const aligned = this.alignValues(batch, batchValues, driverId);
        values.push(...aligned);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/timeout/i.test(message)) {
          console.warn(
            `[DriverManager] OPC UA read batch timeout driverId=${driverId} batch=${batchIndex + 1}/${batches.length} tagCount=${batch.length} timeoutMs=${this.driverReadTimeoutMs}`,
          );
        } else if (this.runtimeDebug) {
          console.warn(
            `[DriverManager] OPC UA read batch failed driverId=${driverId} batch=${batchIndex + 1}/${batches.length} tagCount=${batch.length} error=${message}`,
          );
        }
        values.push(...this.createBadValues(batch, driverId));
        if (!this.isDriverAvailable(driverId)) {
          const remaining = indexedTags.slice(values.length);
          values.push(...this.createBadValues(remaining, driverId));
          skipped = true;
          this.logUnavailableOnce("readTags", driverId);
          break;
        }
      }

      const batchDurationMs = Date.now() - batchStartedAt;
      if (this.runtimeDebug && batchDurationMs > this.slowBatchWarnMs) {
        console.warn(
          `[DriverManager] Slow OPC UA read batch driverId=${driverId} batch=${batchIndex + 1}/${batches.length} tagCount=${batch.length} durationMs=${batchDurationMs}`,
        );
      }
      if (this.runtimeDebug) {
        console.log(
          `[DriverManager] OPC UA batch driver=${driverId} batch=${batchIndex + 1}/${batches.length} tagCount=${batch.length} durationMs=${batchDurationMs}`,
        );
      }
      await this.yieldToEventLoop();
    }

    return {
      values,
      batchCount: batches.length,
      skipped,
    };
  }

  private refreshDriverStatus(driverId: string): DriverStatus | undefined {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      return this.statuses.get(driverId);
    }
    const merged = this.mergeStatus(driverId, driver.getStatus());
    return merged;
  }

  private mergeStatus(driverId: string, next: DriverStatus): DriverStatus {
    const previous = this.statuses.get(driverId);
    const merged: DriverStatus = {
      ...next,
      lastPollAt: next.lastPollAt ?? previous?.lastPollAt,
      lastPollDurationMs: next.lastPollDurationMs ?? previous?.lastPollDurationMs,
      lastPollTagCount: next.lastPollTagCount ?? previous?.lastPollTagCount,
      lastPollBatchCount: next.lastPollBatchCount ?? previous?.lastPollBatchCount,
      pollingSkipped: next.pollingSkipped ?? previous?.pollingSkipped,
      pollingSkipReason: next.pollingSkipReason ?? previous?.pollingSkipReason,
    };
    this.statuses.set(driverId, merged);
    return merged;
  }

  private updatePollingStatus(driverId: string, patch: Partial<DriverStatus>): void {
    const current = this.getStatus(driverId) ?? {
      id: driverId,
      type: this.drivers.get(driverId)?.type ?? "opcua",
      health: "stopped",
      updatedAt: Date.now(),
    };
    const next: DriverStatus = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.statuses.set(driverId, next);
  }

  private alignValues(indexedTags: IndexedTag[], values: TagValue[], driverId: string): TagValue[] {
    const valuesByName = new Map(values.map((value) => [value.name, value]));
    return indexedTags.map((item, localIndex) => (
      valuesByName.get(item.tag.name) ?? values[localIndex] ?? {
        name: item.tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: driverId,
      }
    ));
  }

  private createBadValues(indexedTags: IndexedTag[], driverId: string, timestamp = Date.now()): TagValue[] {
    return indexedTags.map((item) => ({
      name: item.tag.name,
      value: null,
      quality: "Bad" as const,
      timestamp,
      source: driverId,
    }));
  }

  private chunkIndexedTags(indexedTags: IndexedTag[], chunkSize: number): IndexedTag[][] {
    if (indexedTags.length <= chunkSize) {
      return [indexedTags];
    }
    const chunks: IndexedTag[][] = [];
    for (let index = 0; index < indexedTags.length; index += chunkSize) {
      chunks.push(indexedTags.slice(index, index + chunkSize));
    }
    return chunks;
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
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
    const status = this.getStatus(driverId);
    const health = status?.health ?? "disconnected";
    if (String(health).toLowerCase() === "disabled") {
      return;
    }
    if (action === "readTags" && (status?.type === "opcua" || this.drivers.get(driverId)?.type === "opcua")) {
      console.warn(`[DriverManager] Skipping OPC UA polling: driver ${driverId} is ${health}`);
      return;
    }
    const tagPart = tagName ? ` tag=${tagName}` : "";
    console.warn(`[DriverManager] skip ${action}: driver unavailable driverId=${driverId} health=${health}${tagPart}`);
  }

  private getUnavailableReason(driverId: string): string {
    const status = this.getStatus(driverId);
    const health = status?.health ?? "disconnected";
    return `driver ${driverId} is ${health}`;
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
