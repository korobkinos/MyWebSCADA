import type {
  SimulatedDriverConfig,
  TagDefinition,
  TagScalarValue,
  TagSimulationProfile,
  TagSimulationSettings,
  TagValue,
} from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";

type NumericTagDataType = "INT" | "UINT" | "DINT" | "UDINT" | "REAL";
type VariationMode = "same" | "perTagSeed" | "perTagPhase" | "perTagOffset" | "perTagNoise";
type RampDirection = "up" | "down" | "pingPong";
type NoiseType = "uniform" | "normal";

type NormalizedSimulationPolicy = {
  enabled: boolean;
  profile: TagSimulationProfile;
  dataType: TagDefinition["dataType"];
  updateIntervalMs: number;
  variationMode: VariationMode;
  initialValue: TagScalarValue;
  min?: number;
  max?: number;
  ramp: {
    step: number;
    direction: RampDirection;
    resetOnLimit: boolean;
  };
  random: {
    min: number;
    max: number;
  };
  sin: {
    amplitude: number;
    offset: number;
    periodMs: number;
    phaseDeg: number;
  };
  noise: {
    amplitude: number;
    type: NoiseType;
  };
  toggle: {
    trueMs: number;
    falseMs: number;
  };
  randomBool: {
    trueProbability: number;
  };
};

type TagRampState = {
  value: number;
  direction: 1 | -1;
};

type TagToggleState = {
  value: boolean;
  elapsedInStateMs: number;
};

type SimulationTagRuntime = {
  name: string;
  dataType: TagDefinition["dataType"];
  seed: number;
  phaseShiftRad: number;
  offsetShift: number;
  rampState?: TagRampState;
  toggleState?: TagToggleState;
};

type SimulationGroup = {
  key: string;
  policy: NormalizedSimulationPolicy;
  tags: SimulationTagRuntime[];
  nextRunAt: number;
  tickIndex: number;
};

const MIN_SIM_INTERVAL_MS = 100;
const DEFAULT_SIM_INTERVAL_MS = 1000;
const DEFAULT_SCHEDULER_TICK_MS = 100;

function isNumericTagType(dataType: TagDefinition["dataType"]): dataType is NumericTagDataType {
  return dataType === "INT" || dataType === "UINT" || dataType === "DINT" || dataType === "UDINT" || dataType === "REAL";
}

function isBooleanTagType(dataType: TagDefinition["dataType"]): boolean {
  return dataType === "BOOL";
}

function isStringTagType(dataType: TagDefinition["dataType"]): boolean {
  return dataType === "STRING";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom01(seed: number): number {
  let value = seed >>> 0;
  value = Math.imul(value ^ (value >>> 15), 1 | value);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",");
  return `{${body}}`;
}

export class SimulatedDriver implements Driver {
  public readonly id: string;
  public readonly type = "simulated";

  private status: DriverStatus;
  private readonly warnings = new Set<string>();
  private readonly overrides = new Map<string, TagScalarValue>();
  private readonly values = new Map<string, TagScalarValue>();
  private readonly definitionsByName = new Map<string, TagDefinition>();
  private readonly groups = new Map<string, SimulationGroup>();
  private scheduler: NodeJS.Timeout | null = null;
  private generationStartMs = Date.now();
  private generatedUpdates = 0;
  private droppedUpdates = 0;
  private lastTickDurationMs = 0;
  private lastBatchSize = 0;
  private lastError: string | undefined;
  private lastConfigSignature = "";

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
    this.generatedUpdates = 0;
    this.droppedUpdates = 0;
    this.lastTickDurationMs = 0;
    this.lastBatchSize = 0;
    this.lastError = undefined;
    this.generationStartMs = Date.now();
    this.clearScheduler();
    const tickMs = this.resolveSchedulerTickMs();
    this.scheduler = setInterval(() => {
      this.runSchedulerTick();
    }, tickMs);
    this.status = {
      ...this.status,
      health: "running",
      updatedAt: Date.now(),
      message: undefined,
    };
    this.updateStatusDiagnostics();
  }

  public async stop(): Promise<void> {
    this.clearScheduler();
    this.groups.clear();
    this.definitionsByName.clear();
    this.values.clear();
    this.warnings.clear();
    this.lastConfigSignature = "";
    this.status = {
      ...this.status,
      health: "stopped",
      updatedAt: Date.now(),
    };
    this.updateStatusDiagnostics();
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    this.ensureDefinitions([tag]);
    const now = Date.now();
    const value = this.overrides.get(tag.name) ?? this.values.get(tag.name) ?? this.ensureInitialValue(tag);
    return {
      name: tag.name,
      value,
      quality: "Good",
      timestamp: now,
      source: this.id,
    };
  }

  public async readTags(tags: TagDefinition[]): Promise<TagValue[]> {
    this.ensureDefinitions(tags);
    const now = Date.now();
    return tags.map((tag) => {
      const value = this.overrides.get(tag.name) ?? this.values.get(tag.name) ?? this.ensureInitialValue(tag);
      return {
        name: tag.name,
        value,
        quality: "Good",
        timestamp: now,
        source: this.id,
      };
    });
  }

  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    if (!tag.writable) {
      throw new Error(`Tag ${tag.name} is not writable`);
    }
    this.overrides.set(tag.name, value);
    this.values.set(tag.name, value);
  }

  public getStatus(): DriverStatus {
    return this.status;
  }

  public isAvailable(): boolean {
    return this.status.health === "running";
  }

  private ensureDefinitions(tags: TagDefinition[]): void {
    if (tags.length === 0) {
      return;
    }
    for (const tag of tags) {
      this.definitionsByName.set(tag.name, tag);
      if (!this.values.has(tag.name)) {
        this.values.set(tag.name, this.ensureInitialValue(tag));
      }
    }
    this.rebuildGroupsIfNeeded();
  }

  private rebuildGroupsIfNeeded(): void {
    const simulatedTags = [...this.definitionsByName.values()]
      .filter((tag) => tag.sourceType === "simulated");
    const normalizedEntries = simulatedTags
      .map((tag) => ({ tag, policy: this.normalizePolicy(tag) }))
      .filter((entry) => entry.policy.enabled);

    const signature = normalizedEntries
      .map(({ tag, policy }) => `${tag.name}:${this.buildPolicyKey(policy)}`)
      .sort()
      .join("|");

    if (signature === this.lastConfigSignature) {
      return;
    }

    const oldStatesByTag = new Map<string, SimulationTagRuntime>();
    for (const group of this.groups.values()) {
      for (const tagRuntime of group.tags) {
        oldStatesByTag.set(tagRuntime.name, tagRuntime);
      }
    }

    const nextGroups = new Map<string, SimulationGroup>();
    const now = Date.now();
    for (const entry of normalizedEntries) {
      const policyKey = this.buildPolicyKey(entry.policy);
      const seed = hashString(`${this.config.globalSeed ?? 0}:${entry.tag.name}`);
      const existingState = oldStatesByTag.get(entry.tag.name);
      const runtime: SimulationTagRuntime = {
        name: entry.tag.name,
        dataType: entry.tag.dataType,
        seed,
        phaseShiftRad: (seededRandom01(seed ^ 0x5f356495) * Math.PI * 2) - Math.PI,
        offsetShift: (seededRandom01(seed ^ 0x91e10da5) - 0.5),
        rampState: existingState?.rampState,
        toggleState: existingState?.toggleState,
      };

      const existingGroup = nextGroups.get(policyKey);
      if (existingGroup) {
        existingGroup.tags.push(runtime);
      } else {
        nextGroups.set(policyKey, {
          key: policyKey,
          policy: entry.policy,
          tags: [runtime],
          nextRunAt: now + entry.policy.updateIntervalMs,
          tickIndex: 0,
        });
      }
      if (!this.values.has(entry.tag.name)) {
        this.values.set(entry.tag.name, this.coerceInitialValue(entry.tag, entry.policy));
      }
    }
    this.groups.clear();
    for (const [key, group] of nextGroups.entries()) {
      this.groups.set(key, group);
    }
    this.lastConfigSignature = signature;
    this.updateStatusDiagnostics();
  }

  private runSchedulerTick(): void {
    if (this.status.health !== "running") {
      return;
    }
    const startedAt = Date.now();
    const updates: TagValue[] = [];
    try {
      for (const group of this.groups.values()) {
        if (startedAt < group.nextRunAt) {
          continue;
        }
        const elapsedMs = Math.max(group.policy.updateIntervalMs, startedAt - group.nextRunAt + group.policy.updateIntervalMs);
        const ticks = Math.max(1, Math.floor(elapsedMs / group.policy.updateIntervalMs));
        group.nextRunAt += ticks * group.policy.updateIntervalMs;
        group.tickIndex += ticks;
        const groupUpdates = this.generateGroupUpdates(group, startedAt, ticks);
        updates.push(...groupUpdates);
      }
      if (updates.length > 0) {
        for (const update of updates) {
          this.values.set(update.name, update.value);
        }
        this.generatedUpdates += updates.length;
      }
      this.lastBatchSize = updates.length;
      this.lastTickDurationMs = Date.now() - startedAt;
      this.lastError = undefined;
      this.updateStatusDiagnostics();
    } catch (error) {
      this.lastTickDurationMs = Date.now() - startedAt;
      this.lastBatchSize = 0;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.updateStatusDiagnostics();
      this.warnOnce("scheduler", "error", `Simulation scheduler error: ${this.lastError}`);
    }
  }

  private generateGroupUpdates(group: SimulationGroup, now: number, ticks: number): TagValue[] {
    const updates: TagValue[] = [];
    const policy = group.policy;
    const groupRandomSeed = hashString(`${group.key}:${group.tickIndex}`);
    const sharedRandom = seededRandom01(groupRandomSeed ^ 0x9e3779b9);

    for (const runtimeTag of group.tags) {
      if (this.overrides.has(runtimeTag.name)) {
        this.droppedUpdates += 1;
        continue;
      }
      const definition = this.definitionsByName.get(runtimeTag.name);
      if (!definition) {
        continue;
      }

      const value = this.generateTagValue({
        definition,
        policy,
        runtimeTag,
        now,
        ticks,
        groupTickIndex: group.tickIndex,
        sharedRandom,
      });
      updates.push({
        name: definition.name,
        value,
        quality: "Good",
        timestamp: now,
        source: this.id,
      });
    }
    return updates;
  }

  private generateTagValue(args: {
    definition: TagDefinition;
    policy: NormalizedSimulationPolicy;
    runtimeTag: SimulationTagRuntime;
    now: number;
    ticks: number;
    groupTickIndex: number;
    sharedRandom: number;
  }): TagScalarValue {
    const { definition, policy, runtimeTag, now, ticks, groupTickIndex, sharedRandom } = args;
    if (isStringTagType(definition.dataType)) {
      return typeof policy.initialValue === "string" ? policy.initialValue : "";
    }
    if (isBooleanTagType(definition.dataType)) {
      return this.generateBoolValue(policy, runtimeTag, ticks, groupTickIndex, sharedRandom);
    }
    if (!isNumericTagType(definition.dataType)) {
      return null;
    }

    let numeric = 0;
    if (policy.profile === "constant") {
      numeric = typeof policy.initialValue === "number" ? policy.initialValue : policy.random.min;
    } else if (policy.profile === "ramp" || policy.profile === "rampNoise") {
      numeric = this.nextRampNumericValue(policy, runtimeTag, ticks);
      if (policy.profile === "rampNoise") {
        numeric += this.generateNoise(policy, runtimeTag, groupTickIndex, sharedRandom);
      }
    } else if (policy.profile === "random") {
      numeric = this.generateRandomNumeric(policy, runtimeTag, groupTickIndex, sharedRandom);
    } else if (policy.profile === "sin" || policy.profile === "sinNoise") {
      const phaseRad = (policy.sin.phaseDeg * Math.PI) / 180;
      const elapsed = now - this.generationStartMs;
      const normalizedPhase = (Math.PI * 2 * elapsed) / Math.max(MIN_SIM_INTERVAL_MS, policy.sin.periodMs);
      const tagPhase = policy.variationMode === "perTagPhase" || policy.variationMode === "perTagSeed"
        ? runtimeTag.phaseShiftRad
        : 0;
      numeric = policy.sin.offset + policy.sin.amplitude * Math.sin(normalizedPhase + phaseRad + tagPhase);
      if (policy.profile === "sinNoise") {
        numeric += this.generateNoise(policy, runtimeTag, groupTickIndex, sharedRandom);
      }
    } else {
      numeric = typeof policy.initialValue === "number" ? policy.initialValue : policy.random.min;
    }

    if ((policy.variationMode === "perTagOffset" || policy.variationMode === "perTagSeed")
      && Number.isFinite(policy.max) && Number.isFinite(policy.min)) {
      const min = policy.min as number;
      const max = policy.max as number;
      const spread = (max - min) * 0.03;
      numeric += runtimeTag.offsetShift * spread;
    }

    if (Number.isFinite(policy.min) && Number.isFinite(policy.max)) {
      numeric = clamp(numeric, policy.min as number, policy.max as number);
    }
    return this.coerceNumericValue(numeric, definition.dataType as NumericTagDataType);
  }

  private generateBoolValue(
    policy: NormalizedSimulationPolicy,
    runtimeTag: SimulationTagRuntime,
    ticks: number,
    groupTickIndex: number,
    sharedRandom: number,
  ): boolean {
    if (policy.profile === "constant") {
      return Boolean(policy.initialValue);
    }
    if (policy.profile === "toggle") {
      if (!runtimeTag.toggleState) {
        runtimeTag.toggleState = {
          value: Boolean(policy.initialValue),
          elapsedInStateMs: 0,
        };
      }
      const state = runtimeTag.toggleState;
      state.elapsedInStateMs += ticks * policy.updateIntervalMs;
      const durations = state.value ? policy.toggle.trueMs : policy.toggle.falseMs;
      while (state.elapsedInStateMs >= durations) {
        state.elapsedInStateMs -= durations;
        state.value = !state.value;
      }
      return state.value;
    }
    if (policy.profile === "randomBool" || policy.profile === "random") {
      const baseSeed = runtimeTag.seed ^ (groupTickIndex * 0x45d9f3b);
      const value = policy.variationMode === "same" ? sharedRandom : seededRandom01(baseSeed);
      return value < policy.randomBool.trueProbability;
    }
    return Boolean(policy.initialValue);
  }

  private generateRandomNumeric(
    policy: NormalizedSimulationPolicy,
    runtimeTag: SimulationTagRuntime,
    groupTickIndex: number,
    sharedRandom: number,
  ): number {
    const baseSeed = runtimeTag.seed ^ (groupTickIndex * 0x7f4a7c15);
    const random01 = policy.variationMode === "same" ? sharedRandom : seededRandom01(baseSeed);
    return policy.random.min + random01 * (policy.random.max - policy.random.min);
  }

  private generateNoise(
    policy: NormalizedSimulationPolicy,
    runtimeTag: SimulationTagRuntime,
    groupTickIndex: number,
    sharedRandom: number,
  ): number {
    const amplitude = Math.max(0, policy.noise.amplitude);
    if (amplitude <= 0) {
      return 0;
    }
    const baseSeed = runtimeTag.seed ^ (groupTickIndex * 0x27d4eb2d);
    const u1 = policy.variationMode === "same" ? sharedRandom : seededRandom01(baseSeed);
    if (policy.noise.type === "normal") {
      const u2 = seededRandom01(baseSeed ^ 0x632be59b);
      const z0 = Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);
      return clamp(z0, -3, 3) * (amplitude / 3);
    }
    return (u1 * 2 - 1) * amplitude;
  }

  private nextRampNumericValue(policy: NormalizedSimulationPolicy, runtimeTag: SimulationTagRuntime, ticks: number): number {
    const min = Number.isFinite(policy.min) ? (policy.min as number) : policy.random.min;
    const max = Number.isFinite(policy.max) ? (policy.max as number) : policy.random.max;
    if (!runtimeTag.rampState) {
      const initialNumeric = typeof policy.initialValue === "number" ? policy.initialValue : min;
      runtimeTag.rampState = {
        value: clamp(initialNumeric, min, max),
        direction: policy.ramp.direction === "down" ? -1 : 1,
      };
    }
    const state = runtimeTag.rampState;
    for (let index = 0; index < ticks; index += 1) {
      const direction = policy.ramp.direction === "down"
        ? -1
        : policy.ramp.direction === "up"
          ? 1
          : state.direction;
      let next = state.value + direction * policy.ramp.step;
      if (policy.ramp.direction === "pingPong") {
        while (next > max || next < min) {
          if (next > max) {
            next = max - (next - max);
            state.direction = -1;
          } else if (next < min) {
            next = min + (min - next);
            state.direction = 1;
          }
        }
      } else if (next > max) {
        next = policy.ramp.resetOnLimit ? min : max;
      } else if (next < min) {
        next = policy.ramp.resetOnLimit ? max : min;
      }
      state.value = clamp(next, min, max);
    }
    return state.value;
  }

  private normalizePolicy(tag: TagDefinition): NormalizedSimulationPolicy {
    const simulation = tag.simulation ?? {};
    const address = (tag.address ?? {}) as Record<string, unknown>;

    const enabled = simulation.enabled !== false;
    const updateIntervalCandidate = this.pickNumber([
      simulation.updateIntervalMs,
      simulation.intervalMs,
      tag.scanRateMs,
      this.config.updateIntervalMs,
      DEFAULT_SIM_INTERVAL_MS,
    ]);
    const updateIntervalMs = Math.max(MIN_SIM_INTERVAL_MS, Math.round(updateIntervalCandidate));
    if (updateIntervalCandidate < MIN_SIM_INTERVAL_MS) {
      this.warnOnce(tag.name, "updateIntervalMs", `Simulation interval below ${MIN_SIM_INTERVAL_MS}ms for ${tag.name}; clamped`);
    }

    const minFromAny = this.pickNumber([
      simulation.min,
      simulation.random?.min,
      typeof address.min === "number" ? address.min : undefined,
      this.config.defaultMin,
      0,
    ]);
    const maxFromAny = this.pickNumber([
      simulation.max,
      simulation.random?.max,
      typeof address.max === "number" ? address.max : undefined,
      this.config.defaultMax,
      100,
    ]);
    const [min, max] = minFromAny <= maxFromAny ? [minFromAny, maxFromAny] : [maxFromAny, minFromAny];

    const profile = this.resolveProfile(tag.dataType, simulation, address, tag.name);
    const initialValue = this.resolveInitialValue(tag, simulation, address, min);

    const periodMs = Math.max(
      updateIntervalMs,
      this.pickNumber([
        simulation.sin?.periodMs,
        typeof address.periodMs === "number" ? address.periodMs : undefined,
        updateIntervalMs * 20,
      ]),
    );
    if ((simulation.sin?.periodMs ?? 1) <= 0) {
      this.warnOnce(tag.name, "periodMs", `Invalid sin period for ${tag.name}; using ${periodMs}ms`);
    }

    const rawVariation = simulation.variationMode ?? this.config.defaultVariationMode ?? "perTagSeed";
    const variationMode: VariationMode = rawVariation === "same"
      || rawVariation === "perTagSeed"
      || rawVariation === "perTagPhase"
      || rawVariation === "perTagOffset"
      || rawVariation === "perTagNoise"
      ? rawVariation
      : "perTagSeed";

    const rawNoiseAmplitude = this.pickNumber([simulation.noise?.amplitude, 0]);
    const noiseAmplitude = Math.max(0, rawNoiseAmplitude);
    if (rawNoiseAmplitude < 0) {
      this.warnOnce(tag.name, "noiseAmplitude", `Negative noise amplitude for ${tag.name}; clamped to 0`);
    }

    const randomMin = this.pickNumber([simulation.random?.min, min]);
    const randomMax = this.pickNumber([simulation.random?.max, max]);
    const [randomRangeMin, randomRangeMax] = randomMin <= randomMax ? [randomMin, randomMax] : [randomMax, randomMin];

    const boolProbability = clamp(this.pickNumber([simulation.randomBool?.trueProbability, 0.5]), 0, 1);
    const rampStep = Math.max(
      0.000001,
      this.pickNumber([
        simulation.ramp?.step,
        simulation.step,
        this.config.defaultStep,
        tag.dataType === "REAL" ? 0.1 : 1,
      ]),
    );

    const normalized: NormalizedSimulationPolicy = {
      enabled,
      profile,
      dataType: tag.dataType,
      updateIntervalMs,
      variationMode,
      initialValue,
      min: isNumericTagType(tag.dataType) ? min : undefined,
      max: isNumericTagType(tag.dataType) ? max : undefined,
      ramp: {
        step: rampStep,
        direction: simulation.ramp?.direction ?? "pingPong",
        resetOnLimit: Boolean(simulation.ramp?.resetOnLimit),
      },
      random: {
        min: randomRangeMin,
        max: randomRangeMax,
      },
      sin: {
        amplitude: this.pickNumber([simulation.sin?.amplitude, (max - min) / 2]),
        offset: this.pickNumber([simulation.sin?.offset, min + (max - min) / 2]),
        periodMs,
        phaseDeg: this.pickNumber([simulation.sin?.phaseDeg, 0]),
      },
      noise: {
        amplitude: noiseAmplitude,
        type: simulation.noise?.type === "normal" ? "normal" : "uniform",
      },
      toggle: {
        trueMs: Math.max(updateIntervalMs, this.pickNumber([simulation.toggle?.trueMs, updateIntervalMs])),
        falseMs: Math.max(updateIntervalMs, this.pickNumber([simulation.toggle?.falseMs, updateIntervalMs])),
      },
      randomBool: {
        trueProbability: boolProbability,
      },
    };

    return normalized;
  }

  private buildPolicyKey(policy: NormalizedSimulationPolicy): string {
    return stableStringify({
      profile: policy.profile,
      dataType: policy.dataType,
      updateIntervalMs: policy.updateIntervalMs,
      min: policy.min,
      max: policy.max,
      variationMode: policy.variationMode,
      initialValue: policy.initialValue,
      ramp: policy.ramp,
      random: policy.random,
      sin: policy.sin,
      noise: policy.noise,
      toggle: policy.toggle,
      randomBool: policy.randomBool,
    });
  }

  private resolveProfile(
    dataType: TagDefinition["dataType"],
    simulation: TagSimulationSettings,
    address: Record<string, unknown>,
    tagName: string,
  ): TagSimulationProfile {
    const profileFromLegacyMode = this.profileFromLegacyMode(simulation.mode);
    const profileFromLegacyPattern = this.profileFromLegacyPattern(address.pattern);
    const requested = simulation.profile ?? profileFromLegacyMode ?? profileFromLegacyPattern ?? "constant";
    if (isStringTagType(dataType)) {
      if (requested !== "constant") {
        this.warnOnce(tagName, "profile", `Profile ${requested} not supported for STRING ${tagName}; using constant`);
      }
      return "constant";
    }
    if (isBooleanTagType(dataType)) {
      if (requested === "constant" || requested === "toggle" || requested === "randomBool" || requested === "random") {
        return requested;
      }
      this.warnOnce(tagName, "profile", `Profile ${requested} not supported for BOOL ${tagName}; using toggle`);
      return "toggle";
    }
    if (requested === "toggle" || requested === "randomBool") {
      this.warnOnce(tagName, "profile", `Profile ${requested} not supported for numeric tag ${tagName}; using random`);
      return "random";
    }
    return requested;
  }

  private profileFromLegacyMode(mode: TagSimulationSettings["mode"]): TagSimulationProfile | undefined {
    if (mode === "manual") {
      return "constant";
    }
    if (mode === "range" || mode === "random") {
      return "random";
    }
    if (mode === "ramp") {
      return "ramp";
    }
    if (mode === "toggle") {
      return "toggle";
    }
    if (mode === "sine") {
      return "sin";
    }
    return undefined;
  }

  private profileFromLegacyPattern(pattern: unknown): TagSimulationProfile | undefined {
    const value = typeof pattern === "string" ? pattern : undefined;
    if (value === "static") {
      return "constant";
    }
    if (value === "random") {
      return "random";
    }
    if (value === "toggle") {
      return "toggle";
    }
    if (value === "sine") {
      return "sin";
    }
    return undefined;
  }

  private resolveInitialValue(
    tag: TagDefinition,
    simulation: TagSimulationSettings,
    address: Record<string, unknown>,
    minFallback: number,
  ): TagScalarValue {
    const candidate = simulation.initialValue ?? (address.value as TagScalarValue | undefined);
    if (isBooleanTagType(tag.dataType)) {
      return typeof candidate === "boolean" ? candidate : false;
    }
    if (isStringTagType(tag.dataType)) {
      return typeof candidate === "string" ? candidate : tag.name;
    }
    return typeof candidate === "number" ? candidate : minFallback;
  }

  private ensureInitialValue(tag: TagDefinition): TagScalarValue {
    const policy = this.normalizePolicy(tag);
    const value = this.coerceInitialValue(tag, policy);
    this.values.set(tag.name, value);
    return value;
  }

  private coerceInitialValue(tag: TagDefinition, policy: NormalizedSimulationPolicy): TagScalarValue {
    if (isBooleanTagType(tag.dataType)) {
      return Boolean(policy.initialValue);
    }
    if (isStringTagType(tag.dataType)) {
      return typeof policy.initialValue === "string" ? policy.initialValue : "";
    }
    const numeric = typeof policy.initialValue === "number" ? policy.initialValue : policy.random.min;
    const min = Number.isFinite(policy.min) ? (policy.min as number) : numeric;
    const max = Number.isFinite(policy.max) ? (policy.max as number) : numeric;
    return this.coerceNumericValue(clamp(numeric, min, max), tag.dataType as NumericTagDataType);
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

  private resolveSchedulerTickMs(): number {
    const configured = this.pickNumber([this.config.schedulerTickMs, DEFAULT_SCHEDULER_TICK_MS]);
    return Math.max(50, Math.round(configured));
  }

  private clearScheduler(): void {
    if (!this.scheduler) {
      return;
    }
    clearInterval(this.scheduler);
    this.scheduler = null;
  }

  private pickNumber(values: Array<number | undefined>): number {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return 0;
  }

  private updateStatusDiagnostics(): void {
    this.status = {
      ...this.status,
      updatedAt: Date.now(),
      simulationTagCount: [...this.definitionsByName.values()].filter((tag) => tag.sourceType === "simulated").length,
      simulationGroupCount: this.groups.size,
      simulationTagsPerGroup: [...this.groups.values()].map((group) => group.tags.length).sort((a, b) => b - a),
      simulationLastTickDurationMs: this.lastTickDurationMs,
      simulationLastBatchSize: this.lastBatchSize,
      simulationGeneratedUpdates: this.generatedUpdates,
      simulationDroppedUpdates: this.droppedUpdates,
      simulationLastError: this.lastError,
    };
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
