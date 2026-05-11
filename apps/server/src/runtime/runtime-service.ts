import type { RuntimeState, ScadaProject, TagScalarValue } from "@web-scada/shared";
import type { TagDefinition } from "@web-scada/shared";
import { DriverManager } from "../drivers/driver-manager.js";
import { TagStore } from "../tags/tag-store.js";
import { buildInternalAndLwTagDefinitions, InternalVariableService } from "./internal-variable-service.js";
import { collectAlwaysActiveMacroTags } from "./macro-tag-resolver.js";
import { MacroService } from "./macro-service.js";
import { MacroRuntimeRegistry } from "./macro-runtime-registry.js";

export class RuntimeService {
  private readonly rateTimers = new Map<number, NodeJS.Timeout>();
  private readonly pollGroups = new Map<number, TagDefinition[]>();
  private readonly activeTagNames = new Set<string>();
  private readonly persistentActiveTagNames = new Set<string>();
  private readonly inFlightRates = new Set<number>();
  private hasExternalSubscriptions = false;
  private state: RuntimeState = { running: false };
  public readonly macroRegistry: MacroRuntimeRegistry;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly driverManager: DriverManager,
    private readonly internalVariableService: InternalVariableService,
    private readonly macroService: MacroService,
  ) {
    this.macroRegistry = new MacroRuntimeRegistry(macroService);
  }

  public getState(): RuntimeState {
    return this.state;
  }

  public async start(project: ScadaProject): Promise<void> {
    if (this.state.running) {
      return;
    }

    this.driverManager.configure(project.drivers);
    await this.driverManager.startAll();

    const variableDefinitions = buildInternalAndLwTagDefinitions(project.variables ?? [], project.lwStore);
    this.tagStore.setDefinitions([...project.tags, ...variableDefinitions]);
    this.internalVariableService.setup(project.variables ?? [], project.lwStore);
    this.macroService.configure(project);

    // Register macro interval triggers
    this.macroRegistry.registerAll(project.macros ?? []);

    this.state = {
      running: true,
      startedAt: Date.now(),
    };

    this.configurePersistentActiveTags(project);
    this.configurePollGroups(project.tags);
    this.startPollTimers();
    for (const rate of this.pollGroups.keys()) {
      void this.pollRate(rate);
    }
  }

  public async stop(): Promise<void> {
    if (!this.state.running) {
      return;
    }

    for (const timer of this.rateTimers.values()) {
      clearInterval(timer);
    }
    this.rateTimers.clear();
    this.pollGroups.clear();
    this.inFlightRates.clear();
    this.activeTagNames.clear();
    this.persistentActiveTagNames.clear();
    this.hasExternalSubscriptions = false;

    // Stop all macro interval triggers
    this.macroRegistry.stopAll();

    await this.driverManager.stopAll();
    this.state = { running: false };
  }

  public async pollTag(name: string): Promise<void> {
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
    try {
      const values = await this.driverManager.readTags(targets);
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
    } finally {
      this.inFlightRates.delete(rate);
    }
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
