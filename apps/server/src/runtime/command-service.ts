import { COMMAND_TIMEOUT_MS, type ManualCommandMeta, type TagScalarValue } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";
import { DriverManager } from "../drivers/driver-manager.js";
import type { DriverStatus } from "../drivers/driver.js";
import { InternalVariableService } from "./internal-variable-service.js";
import { logPerf } from "./perf-logger.js";
import { ManualCommandError } from "./manual-command-error.js";

type CommandExecutionOptions = {
  manual?: boolean;
  commandMeta?: ManualCommandMeta;
};

export class CommandService {
  private readonly driverWriteTimeoutMs = COMMAND_TIMEOUT_MS;
  private readonly slowWriteWarnMs = 250;
  private readonly manualInFlight = new Map<string, number>();
  private readonly staleManualInFlightMs = COMMAND_TIMEOUT_MS * 4;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly driverManager: DriverManager,
    private readonly internalVariableService: InternalVariableService,
  ) {}

  public async writeTag(name: string, value: TagScalarValue, options?: CommandExecutionOptions): Promise<void> {
    if (options?.manual) {
      this.ensureFreshManualMeta(options.commandMeta);
      const commandKey = this.getCommandKey(options.commandMeta, `tag:${name}`);
      await this.withManualInFlight(commandKey, async () => {
        await this.writeTagInternal(name, value, commandKey, true);
      });
      return;
    }
    await this.writeTagInternal(name, value);
  }

  public async writeVariable(name: string, value: TagScalarValue, options?: CommandExecutionOptions): Promise<void> {
    if (options?.manual) {
      this.ensureFreshManualMeta(options.commandMeta);
      const commandKey = this.getCommandKey(options.commandMeta, `variable:${name}`);
      await this.withManualInFlight(commandKey, async () => {
        await this.writeVariableInternal(name, value);
      });
      return;
    }
    await this.writeVariableInternal(name, value);
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

  public isTagDriverAvailable(name: string): boolean {
    const tag = this.tagStore.getDefinition(name);
    if (!tag) {
      return false;
    }
    if (!tag.driverId && tag.sourceType !== "simulated") {
      return true;
    }
    return this.driverManager.isTagDriverAvailable(tag);
  }

  public getTagDriverStatus(name: string): DriverStatus | undefined {
    const tag = this.tagStore.getDefinition(name);
    if (!tag) {
      return undefined;
    }
    return this.driverManager.getTagDriverStatus(tag);
  }

  public getDriverStatuses(): DriverStatus[] {
    return this.driverManager.getStatuses();
  }

  private async writeTagInternal(name: string, value: TagScalarValue, commandKey?: string, manual = false): Promise<void> {
    const startedAt = Date.now();
    const tag = this.tagStore.getDefinition(name);
    if (!tag) {
      throw new Error(`Tag ${name} is not found`);
    }

    if (!tag.driverId && tag.sourceType !== "simulated") {
      this.internalVariableService.write(name, value);
      logPerf({
        component: "command",
        action: "write-tag",
        target: name,
        targetType: tag.sourceType ?? "internal",
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
      return;
    }

    if (manual && !this.isTagDriverAvailable(name)) {
      const status = this.driverManager.getTagDriverStatus(tag);
      throw new ManualCommandError(
        "driver_offline",
        `Command rejected: tag ${name} driver unavailable (${status?.health ?? "unknown"})`,
      );
    }

    await this.withTimeout(
      this.driverManager.writeTag(tag, value),
      this.driverWriteTimeoutMs,
      commandKey
        ? `Command timeout: ${commandKey} after ${this.driverWriteTimeoutMs} ms`
        : `Write timeout for tag ${name} after ${this.driverWriteTimeoutMs} ms`,
    );
    this.tagStore.upsertValue({
      name,
      value,
      quality: "Good",
      timestamp: Date.now(),
      source: "command",
    });

    const durationMs = Date.now() - startedAt;
    logPerf({
      component: "command",
      action: "write-tag",
      target: name,
      targetType: tag.sourceType ?? "driver",
      durationMs,
      status: "ok",
    });
    if (durationMs > this.slowWriteWarnMs) {
      console.warn(`[CommandService] Slow writeTag name=${name} durationMs=${durationMs}`);
    }
  }

  private async writeVariableInternal(name: string, value: TagScalarValue): Promise<void> {
    const startedAt = Date.now();
    this.internalVariableService.write(name, value);
    logPerf({
      component: "command",
      action: "write-variable",
      target: name,
      durationMs: Date.now() - startedAt,
      status: "ok",
    });
  }

  private getCommandKey(meta: ManualCommandMeta | undefined, fallback: string): string {
    const fromMeta = meta?.commandKey?.trim();
    return fromMeta || fallback;
  }

  private ensureFreshManualMeta(meta: ManualCommandMeta | undefined): void {
    // Client/server clock skew must not block command execution.
    // Request lifetime is already bounded by server-side timeout/in-flight guards.
    void meta;
  }

  private async withManualInFlight<T>(commandKey: string, run: () => Promise<T>): Promise<T> {
    this.cleanupStaleManualInFlight();
    if (this.manualInFlight.has(commandKey)) {
      throw new ManualCommandError("busy", "Command target is busy");
    }
    this.manualInFlight.set(commandKey, Date.now());
    try {
      return await run();
    } catch (error) {
      if (error instanceof Error && /timeout/i.test(error.message)) {
        throw new ManualCommandError("timeout", error.message);
      }
      throw error;
    } finally {
      this.manualInFlight.delete(commandKey);
    }
  }

  private cleanupStaleManualInFlight(): void {
    const now = Date.now();
    for (const [key, startedAt] of this.manualInFlight.entries()) {
      if (now - startedAt > this.staleManualInFlightMs) {
        this.manualInFlight.delete(key);
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
