import {
  OpcUaDriver,
  type OpcUaDriverConfig,
} from "../drivers/opcua-driver.js";
import { TagStore } from "../tags/tag-store.js";
import { DriverManager } from "../drivers/driver-manager.js";
import { InternalVariableService } from "./internal-variable-service.js";
import { MacroService } from "./macro-service.js";
import { CommandService } from "./command-service.js";
import { MacroRegistry } from "../macros/macro-registry.js";
import { logPerf } from "./perf-logger.js";
import { buildInternalAndLwTagDefinitions } from "../tags/internal-tag-builder.js";
import { collectAlwaysActiveMacroTags } from "../macros/always-active-tags.js";
import { collectAlwaysActiveEventTags } from "../events/always-active-event-tags.js";
import {
  type TagScalarValue,
  type TagDefinition,
  type DriverConfig,
  type TagValue,
  type OpcUaDriverConfig as SharedOpcUaDriverConfig,
} from "@web-scada/shared";
import type { ScadaProject } from "@web-scada/shared";

type RuntimeState = {
  running: boolean;
  state: "stopped" | "starting" | "running" | "error";
  startedAt?: number;
  stoppedAt?: number;
  lastError?: string;
};

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
  };

  constructor(
    private readonly tagStore: TagStore,
    private readonly driverManager: DriverManager,
    private readonly internalVariableService: InternalVariableService,
    private readonly macroService: MacroService,
    private readonly commandService: CommandService,
    private readonly macroRegistry: MacroRegistry,
    private readonly eventStore?: {
      getOccurrencesForScreen: (screenId: string) => { occurrences: unknown[] };
    },
  ) {}

  public getState(): RuntimeState {
    return { ...this.state };
  }

  private get isRunning(): boolean {
    return this.state.running;
  }

  public async start(project: ScadaProject): Promise<void> {
    if (this.state.running) {
      return;
    }

    this.state = {
      running: false,
      state: "starting",
    };

    try {
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
  }

  public async stop(): Promise<void> {
    if (!this.state.running) {
      return;
    }

    this.clearPollTimers();
    try {
      await this.macroRegistry.stopAll();
    } catch (error) {
      console.error("[RuntimeService] macroRegistry.stopAll failed:", error);
    }
    try {
      await this.macroService.stopAll();
    } catch (error) {
      console.error("[RuntimeService] macroService.stopAll failed:", error);
    }
    await this.driverManager.stopAll();
    this.clearPollRuntimeState();
    this.state = {
      running: false,
      state: "stopped",
      startedAt: undefined,
      stoppedAt: Date.now(),
      lastError: undefined,
    };
    console.log("[RuntimeService] Runtime stopped");
  }

  private applyScale(scale: string | number | boolean | undefined, offset: string | number | undefined, value: unknown): number | null {
    if (typeof value !== "number") {
      return null;
    }
    const scaleNum = Number(scale);
    const offsetNum = Number(offset);
    if (Number.isNaN(scaleNum) && Number.isNaN(offsetNum)) {
      return null;
    }
    let result = value;
    if (Number.isFinite(scaleNum) && scaleNum !== 0) {
      result = result * scaleNum;
    }
    if (Number.isFinite(offsetNum)) {
      result = result + offsetNum;
    }
    return Number.isFinite(result) ? result : null;
  }

  private onTagValueReceived(name: string, unscaledValue: unknown): void {
    const definition = this.tagStore.getDefinition(name);
    if (!definition) {
      return;
    }
    const scaledValue = this.applyScale(definition.scale, definition.offset, unscaledValue);
    this.tagStore.upsertValue({
      name,
      value: scaledValue,
      quality: "Good",
      timestamp: Date.now(),
      source: definition.driverId ?? definition.sourceType ?? "runtime",
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
    }
    // Add newly activated tags to poll groups for future poll cycles
    for (const name of newlyActivated) {
      this.activateTagForPolling(name);
    }
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

    const targets = group;
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
        console.error(`[RuntimeService] poll group error rateMs=${rate} durationMs=${Date.now() - startedAt} error=${message}`);
      }
    } finally {
      this.inFlightRates.delete(rate);
    }
  }

  private async pollTagsNow(tagNames: string[]): Promise<void> {
    if (tagNames.length === 0) {
      return;
    }
    const definitions: TagDefinition[] = [];
    for (const name of tagNames) {
      const definition = this.tagStore.getDefinition(name);
      if (!definition || (!definition.driverId && definition.sourceType !== "simulated")) {
        continue;
      }
      definitions.push(definition);
    }
    if (definitions.length === 0) {
      return;
    }
    try {
      await this.driverManager.readTags(definitions);
      // Values flow through the driver manager -> tag store -> websocket pipeline
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.warn(`[RuntimeService] pollTagsNow failed error=${text}`);
    }
  }

  /**
   * Adds a single tag to the appropriate poll group by looking up its definition.
   */
  private activateTagForPolling(tagName: string): void {
    const definition = this.tagDefinitionsByName.get(tagName);
    if (!definition) {
      return;
    }
    if (!definition.driverId && definition.sourceType !== "simulated") {
      return;
    }
    // Skip subscription-mode tags (they don't use poll groups)
    if (definition.sourceType === "opcua" && definition.driverId) {
      // Already handled by subscriptionGroups
      return;
    }
    const scanRateMs = Math.max(100, definition.scanRateMs ?? 1000);
    const group = this.pollGroups.get(scanRateMs);
    if (group) {
      if (!group.some((g) => g.name === tagName)) {
        group.push(definition);
      }
    } else {
      this.pollGroups.set(scanRateMs, [definition]);
      // Start a timer for the new rate if it doesn't exist yet
      if (!this.rateTimers.has(scanRateMs)) {
        const timer = setInterval(() => {
          void this.pollRate(scanRateMs);
        }, scanRateMs);
        this.rateTimers.set(scanRateMs, timer);
      }
    }
  }

  private clearPollTimers(): void {
    for (const timer of this.rateTimers.values()) {
      clearInterval(timer);
    }
    this.rateTimers.clear();
  }

  private clearPollRuntimeState(): void {
    this.pollGroups.clear();
    this.subscriptionGroups.clear();
    this.activeTagNames.clear();
    this.persistentActiveTagNames.clear();
    this.hasExternalSubscriptions = false;
    this.inFlightRates.clear();
  }

  private async startDriverSubscriptions(): Promise<void> {
    for (const [driverId, tags] of this.subscriptionGroups.entries()) {
      try {
        await this.driverManager.subscribeTags(driverId, tags, (values) => {
          for (const value of values) {
            this.onTagValueReceived(value.name, value.value);
          }
        });
        console.log(`[RuntimeService] Driver subscription started driverId=${driverId} tagCount=${tags.length}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        console.warn(`[RuntimeService] subscribeTags failed driverId=${driverId} error=${text}`);
      }
    }
  }

  public async writeTag(
    tagName: string,
    value: TagScalarValue,
    options?: {
      commandMeta?: unknown;
      operatorActionContext?: unknown;
    },
  ): Promise<void> {
    await this.commandService.writeTag(tagName, value, options);
  }

  public async writeVariable(
    name: string,
    value: TagScalarValue,
  ): Promise<void> {
    await this.commandService.writeVariable(name, value);
  }
}
