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

  public configure(configs: DriverConfig[]): void {
    this.statuses.clear();
    this.drivers.clear();
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

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    if (!tag.driverId) {
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: "none",
      };
    }

    const driver = this.drivers.get(tag.driverId);
    if (!driver) {
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: tag.driverId,
      };
    }

    return driver.readTag(tag);
  }

  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    if (!tag.driverId) {
      throw new Error(`Tag ${tag.name} has no driver`);
    }

    const driver = this.drivers.get(tag.driverId);
    if (!driver) {
      throw new Error(`Driver ${tag.driverId} is unavailable`);
    }

    await driver.writeTag(tag, value);
  }
}
