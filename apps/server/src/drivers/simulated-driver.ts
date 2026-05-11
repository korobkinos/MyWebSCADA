import type {
  SimulatedDriverConfig,
  TagDefinition,
  TagScalarValue,
  TagSimulationMode,
  TagValue,
} from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";

function toNumber(value: TagScalarValue): number {
  return typeof value === "number" ? value : 0;
}

type NumericTagDataType = "INT" | "UINT" | "DINT" | "UDINT" | "REAL";

type SimulatedTagRuntimeState = {
  value: TagScalarValue;
  direction: 1 | -1;
  lastUpdate: number;
};

type EffectiveSimulationSettings = {
  mode: TagSimulationMode;
  intervalMs: number;
  initialValue?: TagScalarValue;
  min: number;
  max: number;
  step: number;
};

export class SimulatedDriver implements Driver {
  public readonly id: string;
  public readonly type = "simulated";

  private status: DriverStatus;
  private readonly overrides = new Map<string, TagScalarValue>();
  private readonly states = new Map<string, SimulatedTagRuntimeState>();
  private readonly warnings = new Set<string>();
  private startTs = Date.now();

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
    this.startTs = Date.now();
    this.states.clear();
    this.warnings.clear();
    this.status = { ...this.status, health: "running", updatedAt: Date.now(), message: undefined };
  }

  public async stop(): Promise<void> {
    this.states.clear();
    this.warnings.clear();
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
    const settings = this.resolveSettings(tag);
    const state = this.getOrCreateState(tag, settings, now);
    const elapsed = now - state.lastUpdate;
    if (elapsed < settings.intervalMs || settings.intervalMs <= 0) {
      return state.value;
    }

    const ticks = Math.max(1, Math.floor(elapsed / settings.intervalMs));

    if (tag.dataType === "BOOL") {
      if (settings.mode === "toggle") {
        state.value = ticks % 2 === 0 ? Boolean(state.value) : !Boolean(state.value);
      } else if (settings.mode === "random") {
        state.value = Math.random() >= 0.5;
      } else {
        state.value = Boolean(state.value);
      }
      state.lastUpdate += ticks * settings.intervalMs;
      return state.value;
    }

    if (this.isNumericTagType(tag.dataType)) {
      if (settings.mode === "range" || settings.mode === "random") {
        state.value = this.randomInRange(settings.min, settings.max, settings.step, tag.dataType);
      } else if (settings.mode === "ramp") {
        const next = this.nextRampValue(
          typeof state.value === "number" ? state.value : settings.min,
          state.direction,
          settings.min,
          settings.max,
          settings.step,
          ticks,
        );
        state.value = this.coerceNumericValue(next.value, tag.dataType);
        state.direction = next.direction;
      } else if (settings.mode === "sine") {
        const cycleMs = Math.max(settings.intervalMs * 20, settings.intervalMs);
        const elapsedMs = (now - this.startTs) % cycleMs;
        const phase = (elapsedMs / cycleMs) * Math.PI * 2;
        const center = settings.min + (settings.max - settings.min) / 2;
        const amplitude = (settings.max - settings.min) / 2;
        const raw = center + Math.sin(phase) * amplitude;
        state.value = this.coerceNumericValue(this.applyStep(raw, settings.min, settings.step), tag.dataType);
      } else {
        state.value = this.coerceNumericValue(toNumber(state.value), tag.dataType);
      }
      state.lastUpdate += ticks * settings.intervalMs;
      return state.value;
    }

    state.value = typeof state.value === "string" ? state.value : String(settings.initialValue ?? "");
    state.lastUpdate += ticks * settings.intervalMs;
    return state.value;
  }

  private resolveSettings(tag: TagDefinition): EffectiveSimulationSettings {
    const address = (tag.address ?? {}) as Record<string, unknown>;
    const modeFromPattern = this.modeFromLegacyPattern(address.pattern, tag.dataType);
    const mode = this.coerceMode(
      tag.simulation?.mode
      ?? modeFromPattern
      ?? this.config.defaultMode
      ?? (tag.dataType === "BOOL" ? "toggle" : "manual"),
      tag.dataType,
      tag.name,
    );

    const rawInterval = this.pickNumber([
      tag.simulation?.intervalMs,
      typeof address.periodMs === "number" ? address.periodMs : undefined,
      tag.scanRateMs,
      this.config.updateIntervalMs,
      1000,
    ]);
    const intervalMs = rawInterval > 0 ? rawInterval : 1000;
    if (rawInterval <= 0) {
      this.warnOnce(tag.name, "intervalMs", `Invalid simulation interval for tag ${tag.name}; using 1000ms`);
    }

    let min = this.pickNumber([
      tag.simulation?.min,
      typeof address.min === "number" ? address.min : undefined,
      this.config.defaultMin,
      0,
    ]);
    let max = this.pickNumber([
      tag.simulation?.max,
      typeof address.max === "number" ? address.max : undefined,
      this.config.defaultMax,
      100,
    ]);
    if (min > max) {
      this.warnOnce(tag.name, "range", `Simulation min is greater than max for tag ${tag.name}; swapping values`);
      [min, max] = [max, min];
    }

    const defaultStep = tag.dataType === "REAL" ? 0.1 : 1;
    const rawStep = this.pickNumber([
      tag.simulation?.step,
      typeof address.step === "number" ? address.step : undefined,
      this.config.defaultStep,
      defaultStep,
    ]);
    const step = rawStep > 0 ? rawStep : defaultStep;
    if (rawStep <= 0) {
      this.warnOnce(tag.name, "step", `Invalid simulation step for tag ${tag.name}; using ${defaultStep}`);
    }

    return {
      mode,
      intervalMs,
      initialValue: tag.simulation?.initialValue ?? (address.value as TagScalarValue | undefined),
      min,
      max,
      step,
    };
  }

  private getOrCreateState(
    tag: TagDefinition,
    settings: EffectiveSimulationSettings,
    now: number,
  ): SimulatedTagRuntimeState {
    const existing = this.states.get(tag.name);
    if (existing) {
      return existing;
    }
    const initial = this.coerceInitialValue(tag, settings);
    const next: SimulatedTagRuntimeState = {
      value: initial,
      direction: this.initialDirection(settings, initial),
      lastUpdate: now,
    };
    this.states.set(tag.name, next);
    return next;
  }

  private initialDirection(settings: EffectiveSimulationSettings, initial: TagScalarValue): 1 | -1 {
    if (typeof initial !== "number") {
      return 1;
    }
    return initial >= settings.max ? -1 : 1;
  }

  private coerceInitialValue(tag: TagDefinition, settings: EffectiveSimulationSettings): TagScalarValue {
    const initial = settings.initialValue;
    if (tag.dataType === "BOOL") {
      return typeof initial === "boolean" ? initial : false;
    }
    if (this.isNumericTagType(tag.dataType)) {
      const numericInitial = typeof initial === "number" ? initial : settings.min;
      if (settings.mode === "manual") {
        return this.coerceNumericValue(numericInitial, tag.dataType);
      }
      const clamped = Math.min(settings.max, Math.max(settings.min, numericInitial));
      return this.coerceNumericValue(clamped, tag.dataType);
    }
    return typeof initial === "string" ? initial : tag.name;
  }

  private isNumericTagType(dataType: TagDefinition["dataType"]): dataType is NumericTagDataType {
    return dataType === "INT" || dataType === "UINT" || dataType === "DINT" || dataType === "UDINT" || dataType === "REAL";
  }

  private coerceNumericValue(value: number, dataType: NumericTagDataType): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (dataType === "REAL") {
      return Number(value.toFixed(6));
    }
    if (dataType === "UINT" || dataType === "UDINT") {
      return Math.max(0, Math.round(value));
    }
    return Math.round(value);
  }

  private randomInRange(min: number, max: number, step: number, dataType: NumericTagDataType): number {
    const random = min + Math.random() * (max - min);
    const stepped = this.applyStep(random, min, step);
    return this.coerceNumericValue(Math.min(max, Math.max(min, stepped)), dataType);
  }

  private applyStep(value: number, min: number, step: number): number {
    if (!Number.isFinite(step) || step <= 0) {
      return value;
    }
    const relative = (value - min) / step;
    return min + Math.round(relative) * step;
  }

  private nextRampValue(
    current: number,
    direction: 1 | -1,
    min: number,
    max: number,
    step: number,
    ticks: number,
  ): { value: number; direction: 1 | -1 } {
    if (max <= min) {
      return { value: min, direction: 1 };
    }
    let value = current;
    let nextDirection = direction;
    for (let index = 0; index < ticks; index += 1) {
      let next = value + nextDirection * step;
      while (next > max || next < min) {
        if (next > max) {
          next = max - (next - max);
          nextDirection = -1;
        } else if (next < min) {
          next = min + (min - next);
          nextDirection = 1;
        }
      }
      value = next;
    }
    return {
      value: Math.min(max, Math.max(min, value)),
      direction: nextDirection,
    };
  }

  private coerceMode(mode: TagSimulationMode, dataType: TagDefinition["dataType"], tagName: string): TagSimulationMode {
    if (dataType === "BOOL") {
      if (mode === "ramp" || mode === "sine") {
        return "toggle";
      }
      if (mode === "manual" || mode === "toggle" || mode === "random") {
        return mode;
      }
      this.warnOnce(tagName, "mode", `Simulation mode "${mode}" is not supported for BOOL tag ${tagName}; using manual`);
      return "manual";
    }
    if (dataType === "STRING") {
      if (mode !== "manual") {
        this.warnOnce(tagName, "mode", `Simulation mode "${mode}" is not supported for STRING tag ${tagName}; using manual`);
      }
      return "manual";
    }
    if (mode === "toggle") {
      this.warnOnce(tagName, "mode", `Simulation mode "toggle" is not supported for numeric tag ${tagName}; using manual`);
      return "manual";
    }
    if (mode === "random") {
      return "range";
    }
    return mode;
  }

  private modeFromLegacyPattern(
    pattern: unknown,
    dataType: TagDefinition["dataType"],
  ): TagSimulationMode | undefined {
    const value = typeof pattern === "string" ? pattern : undefined;
    if (!value) {
      return undefined;
    }
    if (value === "static") {
      return "manual";
    }
    if (value === "random") {
      return dataType === "BOOL" ? "random" : "range";
    }
    if (value === "toggle") {
      return "toggle";
    }
    if (value === "sine") {
      return "sine";
    }
    return undefined;
  }

  private pickNumber(values: Array<number | undefined>): number {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return 0;
  }

  private warnOnce(tagName: string, code: string, message: string): void {
    const key = `${tagName}:${code}`;
    if (this.warnings.has(key)) {
      return;
    }
    this.warnings.add(key);
    console.warn(`[SimulatedDriver:${this.id}] ${message}`);
  }
}
