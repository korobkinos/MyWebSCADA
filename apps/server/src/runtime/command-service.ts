import type { TagScalarValue } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";
import { DriverManager } from "../drivers/driver-manager.js";
import { InternalVariableService } from "./internal-variable-service.js";

export class CommandService {
  public constructor(
    private readonly tagStore: TagStore,
    private readonly driverManager: DriverManager,
    private readonly internalVariableService: InternalVariableService,
  ) {}

  public async writeTag(name: string, value: TagScalarValue): Promise<void> {
    const tag = this.tagStore.getDefinition(name);
    if (!tag) {
      throw new Error(`Tag ${name} is not found`);
    }

    if (!tag.driverId) {
      this.internalVariableService.write(name, value);
      return;
    }

    await this.driverManager.writeTag(tag, value);
    this.tagStore.upsertValue({
      name,
      value,
      quality: "Good",
      timestamp: Date.now(),
      source: "command",
    });
  }

  public async writeVariable(name: string, value: TagScalarValue): Promise<void> {
    this.internalVariableService.write(name, value);
  }

  public async pulseTag(name: string, value: TagScalarValue, durationMs: number): Promise<void> {
    await this.writeTag(name, value);
    setTimeout(() => {
      void this.writeTag(name, false).catch(() => undefined);
    }, durationMs);
  }

  public async toggleTag(name: string): Promise<void> {
    const current = this.tagStore.getValue(name);
    const next = !(Boolean(current?.value));
    await this.writeTag(name, next);
  }
}
