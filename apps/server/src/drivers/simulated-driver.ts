import type { SimulatedDriverConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";

function toNumber(value: TagScalarValue): number {
  return typeof value === "number" ? value : 0;
}

export class SimulatedDriver implements Driver {
  public readonly id: string;
  public readonly type = "simulated";

  private status: DriverStatus;
  private readonly overrides = new Map<string, TagScalarValue>();
  private readonly startTs = Date.now();

  public constructor(private readonly config: SimulatedDriverConfig) {
    this.id = config.id;
    this.status = {
      id: config.id,
      type: this.type,
      health: "stopped",
      updatedAt: Date.now(),
    };
  }

  public async start(): Promise<void> {
    this.status = { ...this.status, health: "running", updatedAt: Date.now(), message: undefined };
  }

  public async stop(): Promise<void> {
    this.status = { ...this.status, health: "stopped", updatedAt: Date.now() };
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    const now = Date.now();
    const existing = this.overrides.get(tag.name);
    const value = existing ?? this.generate(tag, now);
    return {
      name: tag.name,
      value,
      quality: "Good",
      timestamp: now,
      source: this.id,
    };
  }

  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    if (!tag.writable) {
      throw new Error(`Tag ${tag.name} is not writable`);
    }
    this.overrides.set(tag.name, value);
  }

  public getStatus(): DriverStatus {
    return this.status;
  }

  private generate(tag: TagDefinition, now: number): TagScalarValue {
    const address = (tag.address ?? {}) as Record<string, unknown>;
    const pattern = (address.pattern as string | undefined) ?? this.defaultPattern(tag);

    if (tag.dataType === "BOOL") {
      if (pattern === "static") {
        return Boolean(address.value ?? false);
      }
      const periodMs = Number(address.periodMs ?? tag.scanRateMs ?? this.config.updateIntervalMs ?? 1000);
      return Math.floor((now - this.startTs) / periodMs) % 2 === 0;
    }

    if (tag.dataType === "REAL" || tag.dataType === "INT" || tag.dataType === "DINT" || tag.dataType === "UINT" || tag.dataType === "UDINT") {
      const periodMs = Number(address.periodMs ?? this.config.updateIntervalMs ?? 5000);
      const elapsed = (now - this.startTs) % periodMs;
      const phase = (elapsed / periodMs) * Math.PI * 2;
      const min = Number(address.min ?? this.config.defaultMin ?? 0);
      const max = Number(address.max ?? this.config.defaultMax ?? 100);
      const step = Number(address.step ?? this.config.defaultStep ?? (tag.dataType === "REAL" ? 0.1 : 1));
      const amplitude = Number(address.amplitude ?? (max - min) / 2);
      const center = min + (max - min) / 2;

      if (pattern === "random") {
        const random = min + Math.random() * (max - min);
        if (Number.isFinite(step) && step > 0) {
          return Math.round(random / step) * step;
        }
        return random;
      }

      if (pattern === "static") {
        return toNumber(address.value as TagScalarValue);
      }

      const raw = center + Math.sin(phase) * amplitude;
      const sine = Number.isFinite(step) && step > 0
        ? Math.round(raw / step) * step
        : raw;
      if (tag.dataType === "REAL") {
        return Number(sine.toFixed(2));
      }
      return Math.round(sine);
    }

    if (pattern === "static" && typeof address.value === "string") {
      return address.value;
    }
    return `${tag.name}`;
  }

  private defaultPattern(tag: TagDefinition): "toggle" | "sine" | "random" | "static" {
    if (this.config.defaultMode === "manual") {
      return "static";
    }
    if (this.config.defaultMode === "random") {
      return "random";
    }
    if (tag.dataType === "BOOL") {
      return "toggle";
    }
    return "sine";
  }
}
