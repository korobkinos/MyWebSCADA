import type { RuntimeState, ScadaProject, TagScalarValue } from "@web-scada/shared";
import { DriverManager } from "../drivers/driver-manager.js";
import { TagStore } from "../tags/tag-store.js";
import { InternalVariableService, variableToTagDefinition } from "./internal-variable-service.js";
import { MacroService } from "./macro-service.js";

export class RuntimeService {
  private readonly intervals = new Map<string, NodeJS.Timeout>();
  private state: RuntimeState = { running: false };

  public constructor(
    private readonly tagStore: TagStore,
    private readonly driverManager: DriverManager,
    private readonly internalVariableService: InternalVariableService,
    private readonly macroService: MacroService,
  ) {}

  public getState(): RuntimeState {
    return this.state;
  }

  public async start(project: ScadaProject): Promise<void> {
    if (this.state.running) {
      return;
    }

    this.driverManager.configure(project.drivers);
    await this.driverManager.startAll();

    const variableDefinitions = (project.variables ?? []).map(variableToTagDefinition);
    this.tagStore.setDefinitions([...project.tags, ...variableDefinitions]);
    this.internalVariableService.setup(project.variables ?? []);
    this.macroService.configure(project);

    for (const tag of project.tags) {
      const scanRateMs = tag.scanRateMs ?? 1000;
      const timer = setInterval(() => {
        void this.pollTag(tag.name);
      }, scanRateMs);
      this.intervals.set(tag.name, timer);
      void this.pollTag(tag.name);
    }

    this.state = {
      running: true,
      startedAt: Date.now(),
    };
  }

  public async stop(): Promise<void> {
    if (!this.state.running) {
      return;
    }

    for (const timer of this.intervals.values()) {
      clearInterval(timer);
    }
    this.intervals.clear();

    await this.driverManager.stopAll();
    this.state = { running: false };
  }

  public async pollTag(name: string): Promise<void> {
    const definition = this.tagStore.getDefinition(name);
    if (!definition) {
      return;
    }

    const value = await this.driverManager.readTag(definition);
    const scaledValue = this.applyScale(definition.scale, definition.offset, value.value);
    this.tagStore.upsertValue({
      ...value,
      value: scaledValue,
    });
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
