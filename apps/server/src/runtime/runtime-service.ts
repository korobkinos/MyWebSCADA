import type { RuntimeState, ScadaProject, TagScalarValue } from "@web-scada/shared";
import type { TagDefinition } from "@web-scada/shared";
import { DriverManager } from "../drivers/driver-manager.js";
import { TagStore } from "../tags/tag-store.js";
import { buildInternalAndLwTagDefinitions, InternalVariableService } from "./internal-variable-service.js";
import { collectAlwaysActiveMacroTags } from "./macro-tag-resolver.js";
import { MacroService } from "./macro-service.js";
import { MacroRuntimeRegistry } from "./macro-runtime-registry.js";
import { logPerf } from "./perf-logger.js";

export class RuntimeService {
  private readonly rateTimers = new Map<number, NodeJS.Timeout>();
  private readonly pollGroups = new Map<number, TagDefinition[]>();
  private readonly activeTagNames = new Set<string>();
  private readonly persistentActiveTagNames = new Set<string>();
  private readonly inFlightRates = new Set<number>();
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
        this.configurePollGroups(project.tags);
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
      this.clearPollRuntimeState();
      const macroIntervalsCleared = this.macroRegistry.stopAll();

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
    this.activeTagNames.clear();
    for (const item of tagNames) {
      const trimmed = item.trim();
      if (!trimmed) {
        continue;
      }
      this.activeTagNames.add(trimmed);
    }
    this.hasExternalSubscriptions = true;
  }

  public clearActiveTags(): void {
    this.activeTagNames.clear();
    this.hasExternalSubscriptions = false;
  }

  private configurePersistentActiveTags(project: ScadaProject): void {
    this.persistentActiveTagNames.clear();
    for (const tag of collectAlwaysActiveMacroTags(project.macros)) {
      this.persistentActiveTagNames.add(tag);
    }
    for (const tag of project.runtimeSettings?.alwaysActiveTags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) {
        this.persistentActiveTagNames.add(trimmed);
      }
    }
  }

  private configurePollGroups(tags: TagDefinition[]): void {
    this.pollGroups.clear();
    for (const tag of tags) {
      if (!tag.driverId && tag.sourceType !== "simulated") {
        continue;
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

    this.inFlightRates.add(rate);
    const startedAt = Date.now();
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
    } finally {
      this.inFlightRates.delete(rate);
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
}
