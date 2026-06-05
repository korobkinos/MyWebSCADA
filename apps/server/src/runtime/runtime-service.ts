import type { DriverConfig, OpcUaDriverConfig, RuntimeState, ScadaProject, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import { DriverManager } from "../drivers/driver-manager.js";
import { TagStore } from "../tags/tag-store.js";
import { buildInternalAndLwTagDefinitions, InternalVariableService } from "./internal-variable-service.js";
import { collectAlwaysActiveMacroTags } from "./macro-tag-resolver.js";
import { MacroService } from "./macro-service.js";
import { MacroRuntimeRegistry } from "./macro-runtime-registry.js";
import { logPerf } from "./perf-logger.js";

export function collectAlwaysActiveEventTags(project: Pick<ScadaProject, "events">): string[] {
  const refs = new Set<string>();
  for (const event of project.events ?? []) {
    if (event.enabled === false) {
      continue;
    }
    const sourceTag = event.sourceTagName?.trim();
    if (sourceTag) {
      refs.add(sourceTag);
    }
    if (event.securityEnabled === true) {
      const securityTag = event.securityTagName?.trim();
      if (securityTag) {
        refs.add(securityTag);
      }
    }
  }
  return [...refs];
}

export class RuntimeService {
  private readonly rateTimers = new Map<number, NodeJS.Timeout>();
  private readonly pollGroups = new Map<number, TagDefinition[]>();
  private readonly subscriptionGroups = new Map<string, TagDefinition[]>();
  private readonly activeTagNames = new Set<string>();
  private readonly persistentActiveTagNames = new Set<string>();
  private readonly inFlightRates = new Set<number>();
  private readonly runtimeDebug = process.env.DEBUG_RUNTIME_COMMANDS === "1";
  private tagDefinitionsByName: Map<string, TagDefinition> = new Map();
  private hasExternalSubscriptions = false;
  private state: RuntimeState = {
    running: false,
    state: "stopped",
    stoppedAt: Date.now(),
  };
  private lifecycle = Promise.resolve();
  public readonly macroRegistry: MacroRuntimeRegistry;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly driverManager: DriverManager,
    private readonly internalVariableService: InternalVariableService,
    private readonly macroService: MacroService,
  ) {
    this.macroRegistry = new MacroRuntimeRegistry(macroService, () => this.state.running);
  }

  public getState(): RuntimeState {
    return {
      ...this.state,
      pollGroups: [...this.pollGroups.entries()].map(([rateMs, tags]) => ({
        rateMs,
        tagCount: tags.length,
      })),
      macroIntervals: this.macroRegistry.getRegisteredIntervals(),
    };
  }

  public getStatus(): RuntimeState {
    return this.getState();
  }

  public async start(project: ScadaProject): Promise<void> {
    await this.runLifecycle(async () => {
      if (this.state.running || this.state.state === "starting") {
        return;
      }

      this.state = {
        ...this.state,
        running: false,
        state: "starting",
        lastError: undefined,
      };

      try {
        this.clearPollTimers();
        this.clearPollRuntimeState();
        this.macroRegistry.stopAll();

        this.driverManager.configure(project.drivers);
        await this.driverManager.startAll();

        const variableDefinitions = buildInternalAndLwTagDefinitions(project.variables ?? [], project.lwStore);
        this.tagStore.setDefinitions([...project.tags, ...variableDefinitions]);
        this.internalVariableService.setup(project.variables ?? [], project.lwStore);
        this.macroService.configure(project);

        this.macroRegistry.registerAll(project.macros ?? []);
        this.configurePersistentActiveTags(project);
        this.configurePollGroups(project.tags, project.drivers);
        this.startPollTimers();
        for (const rate of this.pollGroups.keys()) {
          void this.pollRate(rate);
        }

        const startedAt = Date.now();
        this.state = {
          running: true,
          state: "running",
          startedAt,
          stoppedAt: undefined,
          lastError: undefined,
        };
        void this.startDriverSubscriptions();
        console.log("[RuntimeService] Runtime started");
      } catch (error) {
        await this.driverManager.stopAll().catch(() => undefined);
        this.clearPollTimers();
        this.clearPollRuntimeState();
        this.macroRegistry.stopAll();
        const text = error instanceof Error ? error.message : String(error);
        this.state = {
          ...this.state,
          running: false,
          state: "error",
          stoppedAt: Date.now(),
          lastError: text,
        };
        console.error(`[RuntimeService] Runtime start failed: ${text}`);
        throw error;
      }
    });
  }

  public async stop(): Promise<void> {
    await this.runLifecycle(async () => {
      if (!this.state.running && this.state.state !== "starting") {
        if (this.state.state !== "stopped") {
          this.state = {
            ...this.state,
            running: false,
            state: "stopped",
            stoppedAt: this.state.stoppedAt ?? Date.now(),
          };
        }
        return;
      }

      this.state = {
        ...this.state,
        running: false,
        state: "stopping",
      };

      const timersCleared = this.clearPollTimers();
      const macroIntervalsCleared = this.macroRegistry.stopAll();

      await this.stopDriverSubscriptions();
      this.clearPollRuntimeState();
      await this.driverManager.stopAll();
      this.state = {
        ...this.state,
        running: false,
        state: "stopped",
        stoppedAt: Date.now(),
      };
      console.log(`[RuntimeService] Runtime poll timers cleared: ${timersCleared}`);
      console.log(`[RuntimeService] Macro intervals cleared: ${macroIntervalsCleared}`);
      console.log("[RuntimeService] Runtime stopped");
    });
  }

  public async pollTag(name: string): Promise<void> {
    if (!this.state.running) {
      return;
    }
    const definition = this.tagStore.getDefinition(name);
    if (!definition || (!definition.driverId && definition.sourceType !== "simulated")) {
      return;
    }

    const value = await this.driverManager.readTag(definition);
    const scaledValue = this.applyScale(definition.scale, definition.offset, value.value);
    this.tagStore.upsertValue({
      ...value,
      value: scaledValue,
    });
  }

  public setActiveTags(tagNames: Iterable<string>): void {
    const previousActive = new Set(this.activeTagNames);
    this.activeTagNames.clear();
    for (const item of tagNames) {
      const trimmed = item.trim();
      if (!trimmed) {
        continue;
      }
      this.activeTagNames.add(trimmed);
    }
    this.hasExternalSubscriptions = true;

    if (!this.state.running) {
      return;
    }

    const newlyActivated = [...this.activeTagNames].filter((name) => !previousActive.has(name));
    if (newlyActivated.length > 0) {
      void this.pollTagsNow(newlyActivated);
      for (const name of newlyActivated) {
        this.activateTagForPolling(name);
      }
    }
  }

  public clearActiveTags(): void {
    this.activeTagNames.clear();
    this.hasExternalSubscriptions = false;
  }

  /**
   * Lazy-add a single tag to its poll group by rate.
   * Only called when a client subscribes to the tag at runtime.
   */
  private activateTagForPolling(tagName: string): void {
    const definition = this.tagDefinitionsByName.get(tagName);
    if (!definition) return;
    if (!definition.driverId && definition.sourceType !== "simulated") return;

    // Skip subscription-mode OPC UA tags (handled separately)
    if (definition.sourceType === "opcua" && definition.driverId) return;

    const scanRateMs = Math.max(100, definition.scanRateMs ?? 1000);
    const group = this.pollGroups.get(scanRateMs);
    if (group) {
      if (!group.some((g) => g.name === tagName)) {
        group.push(definition);
      }
    } else {
      this.pollGroups.set(scanRateMs, [definition]);
      // Start timer for previously-unseen rate
      if (!this.rateTimers.has(scanRateMs)) {
        const timer = setInterval(() => { void this.pollRate(scanRateMs); }, scanRateMs);
        this.rateTimers.set(scanRateMs, timer);
      }
    }
  }

  private configurePersistentActiveTags(project: ScadaProject): void {
    this.persistentActiveTagNames.clear();
    for (const tag of collectAlwaysActiveMacroTags(project.macros)) {
      this.persistentActiveTagNames.add(tag);
    }
    for (const tag of collectAlwaysActiveEventTags(project)) {
      this.persistentActiveTagNames.add(tag);
    }
    for (const tag of project.runtimeSettings?.alwaysActiveTags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) {
        this.persistentActiveTagNames.add(trimmed);
      }
    }
  }

  private configurePollGroups(tags: TagDefinition[], drivers: DriverConfig[]): void {
    this.pollGroups.clear();
    this.subscriptionGroups.clear();
    this.tagDefinitionsByName = new Map(tags.map((t) => [t.name, t]));
    const opcById = new Map(
      drivers
        .filter((driver): driver is OpcUaDriverConfig => driver.type === "opcua")
        .map((driver) => [driver.id, driver] as const),
    );
    for (const tag of tags) {
      // Only add persistent-active tags at startup.
      // Runtime screen tags are added lazily via activateTagForPolling().
      if (!this.persistentActiveTagNames.has(tag.name)) {
        continue;
      }

      if (!tag.driverId && tag.sourceType !== "simulated") {
        continue;
      }
      if (tag.sourceType === "opcua" && tag.driverId) {
        const driver = opcById.get(tag.driverId);
        const readMode = driver?.readMode ?? "subscription";
        if (readMode === "subscription") {
          const group = this.subscriptionGroups.get(tag.driverId);
          if (group) {
            group.push(tag);
          } else {
            this.subscriptionGroups.set(tag.driverId, [tag]);
          }
          continue;
        }
      }
      const scanRateMs = Math.max(100, tag.scanRateMs ?? 1000);
      const group = this.pollGroups.get(scanRateMs);
      if (group) {
        group.push(tag);
      } else {
        this.pollGroups.set(scanRateMs, [tag]);
      }
    }
  }

  private startPollTimers(): void {
    this.clearPollTimers();
    for (const [rate] of this.pollGroups.entries()) {
      const timer = setInterval(() => {
        void this.pollRate(rate);
      }, rate);
      this.rateTimers.set(rate, timer);
    }
  }

  private shouldPollTag(name: string): boolean {
    if (this.persistentActiveTagNames.has(name)) {
      return true;
    }
    if (!this.hasExternalSubscriptions) {
      return true;
    }
    if (this.activeTagNames.size === 0) {
      return false;
    }
    return this.activeTagNames.has(name);
  }


  private async pollRate(rate: number): Promise<void> {
    if (!this.state.running) {
      return;
    }
    if (this.inFlightRates.has(rate)) {
      if (this.runtimeDebug) {
        console.log(`[RuntimeService] poll group skipped: previous cycle still running rateMs=${rate}`);
      }
      return;
    }

    const group = this.pollGroups.get(rate);
    if (!group || group.length === 0) {
      return;
    }

    const targets = group.filter((tag) => this.shouldPollTag(tag.name));
    if (targets.length === 0) {
      return;
    }

    const perDriver = new Map<string, number>();
    for (const tag of targets) {
      const key = tag.driverId ?? tag.sourceType ?? "unknown";
      perDriver.set(key, (perDriver.get(key) ?? 0) + 1);
    }

    this.inFlightRates.add(rate);
    const startedAt = Date.now();
    if (this.runtimeDebug) {
      const details = [...perDriver.entries()].map(([driverId, count]) => `${driverId}:${count}`).join(", ");
      console.log(`[RuntimeService] poll group start rateMs=${rate} totalTags=${targets.length}${details ? ` perDriver=[${details}]` : ""}`);
    }
    try {
      const values = await this.driverManager.readTags(targets);
      if (!this.state.running) {
        return;
      }
      const definitionsByName = new Map(targets.map((tag) => [tag.name, tag]));

      for (const value of values) {
        if (!this.state.running) {
          break;
        }
        const definition = definitionsByName.get(value.name);
        if (!definition) {
          continue;
        }

        const scaledValue = this.applyScale(definition.scale, definition.offset, value.value);
        this.tagStore.upsertValue({
          ...value,
          value: scaledValue,
        });
      }
      logPerf({
        component: "runtime",
        action: "poll-rate",
        rateMs: rate,
        targetCount: targets.length,
        valueCount: values.length,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
      if (this.runtimeDebug) {
        console.log(`[RuntimeService] poll group end rateMs=${rate} totalTags=${targets.length} durationMs=${Date.now() - startedAt}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPerf({
        component: "runtime",
        action: "poll-rate",
        rateMs: rate,
        targetCount: targets.length,
        durationMs: Date.now() - startedAt,
        status: "error",
        message,
      });
      if (this.runtimeDebug) {
        console.warn(`[RuntimeService] poll group error rateMs=${rate} totalTags=${targets.length} durationMs=${Date.now() - startedAt} error=${message}`);
      }
    } finally {
      this.inFlightRates.delete(rate);
    }
  }

  private async pollTagsNow(tagNames: string[]): Promise<void> {
    if (!this.state.running || tagNames.length === 0) {
      return;
    }

    const targets: TagDefinition[] = [];
    for (const name of tagNames) {
      const definition = this.tagStore.getDefinition(name);
      if (!definition || (!definition.driverId && definition.sourceType !== "simulated")) {
        continue;
      }
      targets.push(definition);
    }
    if (targets.length === 0) {
      return;
    }

    try {
      const values = await this.driverManager.readTags(targets);
      if (!this.state.running) {
        return;
      }

      const definitionsByName = new Map(targets.map((tag) => [tag.name, tag]));
      for (const value of values) {
        const definition = definitionsByName.get(value.name);
        if (!definition) {
          continue;
        }
        const scaledValue = this.applyScale(definition.scale, definition.offset, value.value);
        this.tagStore.upsertValue({
          ...value,
          value: scaledValue,
        });
      }
    } catch (error) {
      if (this.runtimeDebug) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RuntimeService] immediate poll failed tagCount=${targets.length} error=${message}`);
      }
    }
  }

  private clearPollTimers(): number {
    const count = this.rateTimers.size;
    for (const timer of this.rateTimers.values()) {
      clearInterval(timer);
    }
    this.rateTimers.clear();
    return count;
  }

  private clearPollRuntimeState(): void {
    this.pollGroups.clear();
    this.subscriptionGroups.clear();
    this.inFlightRates.clear();
    this.activeTagNames.clear();
    this.persistentActiveTagNames.clear();
    this.hasExternalSubscriptions = false;
  }

  private async runLifecycle(task: () => Promise<void>): Promise<void> {
    const run = this.lifecycle.then(task);
    this.lifecycle = run.catch(() => undefined);
    return run;
  }


  private applyScale(scale: number | undefined, offset: number | undefined, value: TagScalarValue): TagScalarValue {
    if (typeof value !== "number") {
      return value;
    }

    const scaleValue = scale ?? 1;
    const offsetValue = offset ?? 0;
    return value * scaleValue + offsetValue;
  }

  private async startDriverSubscriptions(): Promise<void> {
    if (!this.state.running || this.subscriptionGroups.size === 0) {
      return;
    }
    const tasks = [...this.subscriptionGroups.entries()].map(async ([driverId, tags]) => {
      try {
        await this.driverManager.subscribeTags(driverId, tags, (values) => {
          this.handleSubscriptionValues(values);
        });
      } catch (error) {
        if (this.runtimeDebug) {
          const text = error instanceof Error ? error.message : String(error);
          console.warn(`[RuntimeService] subscribeTags failed driverId=${driverId} error=${text}`);
        }
      }
    });
    await Promise.all(tasks);
  }

  private async stopDriverSubscriptions(): Promise<void> {
    if (this.subscriptionGroups.size === 0) {
      return;
    }
    await Promise.all(
      [...this.subscriptionGroups.keys()].map((driverId) => this.driverManager.unsubscribeDriver(driverId).catch(() => undefined)),
    );
  }

  private handleSubscriptionValues(values: TagValue[]): void {
    if (!this.state.running || values.length === 0) {
      return;
    }
    for (const value of values) {
      if (!this.state.running) {
        return;
      }
      const definition = this.tagStore.getDefinition(value.name);
      if (!definition) {
        continue;
      }
      const scaledValue = this.applyScale(definition.scale, definition.offset, value.value);
      this.tagStore.upsertValue({
        ...value,
        value: scaledValue,
      });
    }
  }
}
