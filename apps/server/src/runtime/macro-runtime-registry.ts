import type { MacroDefinition, MacroTrigger } from "@web-scada/shared";
import { MacroService } from "./macro-service.js";

type MacroExecutionState = {
  running: boolean;
  lastStartedAt?: number;
  lastFinishedAt?: number;
  lastError?: string;
  runCount: number;
};

export class MacroRuntimeRegistry {
  private readonly intervalHandles = new Map<string, ReturnType<typeof setInterval>>();
  private readonly executionStates = new Map<string, MacroExecutionState>();

  public constructor(private readonly macroService: MacroService) {}

  /**
   * Register all interval triggers for all enabled macros.
   */
  public registerAll(macros: MacroDefinition[]): void {
    this.stopAll();
    for (const macro of macros) {
      if (!(macro.enabled ?? true) || macro.validation?.status === "error") {
        continue;
      }
      this.registerMacroTriggers(macro);
    }
    console.log(
      `[MacroRuntimeRegistry] Registered triggers for ${macros.filter((m) => (m.enabled ?? true) && m.validation?.status !== "error").length} enabled macros`,
    );
  }

  /**
   * Register triggers for a single macro.
   */
  public registerMacroTriggers(macro: MacroDefinition): void {
    if (!(macro.enabled ?? true)) {
      console.log(`[MacroRuntimeRegistry] Macro ${macro.id} (${macro.name}) is disabled, skipping trigger registration`);
      return;
    }
    if (macro.validation?.status === "error") {
      console.log(`[MacroRuntimeRegistry] Macro ${macro.id} (${macro.name}) is invalid, skipping trigger registration`);
      return;
    }

    const triggers = macro.triggers ?? [];
    for (const trigger of triggers) {
      if (trigger.type === "interval") {
        this.registerIntervalTrigger(macro, trigger);
      }
      // Other trigger types (onScreenOpen, onTagChange, etc.) can be added later
    }
  }

  /**
   * Unregister all triggers for a specific macro.
   */
  public unregisterMacroTriggers(macroId: string): void {
    for (const [key, handle] of this.intervalHandles.entries()) {
      if (key.startsWith(`${macroId}:`)) {
        clearInterval(handle);
        this.intervalHandles.delete(key);
        console.log(`[MacroRuntimeRegistry] Unregistered interval for macro ${macroId}`);
      }
    }
  }

  /**
   * Reload triggers for a single macro (unregister old, register new).
   */
  public reloadMacro(macro: MacroDefinition): void {
    this.unregisterMacroTriggers(macro.id);
    this.registerMacroTriggers(macro);
  }

  /**
   * Stop all interval triggers.
   */
  public stopAll(): void {
    for (const [key, handle] of this.intervalHandles.entries()) {
      clearInterval(handle);
      console.log(`[MacroRuntimeRegistry] Stopped interval: ${key}`);
    }
    this.intervalHandles.clear();
    this.executionStates.clear();
  }

  /**
   * Get execution state for a macro (for diagnostics).
   */
  public getExecutionState(macroId: string): MacroExecutionState | undefined {
    return this.executionStates.get(macroId);
  }

  /**
   * Get all registered interval keys (for diagnostics).
   */
  public getRegisteredIntervals(): string[] {
    return [...this.intervalHandles.keys()];
  }

  /**
   * Check if a macro has registered intervals.
   */
  public hasActiveIntervals(macroId: string): boolean {
    for (const key of this.intervalHandles.keys()) {
      if (key.startsWith(`${macroId}:`)) {
        return true;
      }
    }
    return false;
  }

  private registerIntervalTrigger(macro: MacroDefinition, trigger: MacroTrigger & { type: "interval" }): void {
    const intervalMs = Math.max(100, trigger.intervalMs || 1000);
    const key = `${macro.id}:interval:${intervalMs}`;

    // Unregister existing interval for this macro+trigger combination
    this.unregisterTrigger(key);

    const handle = setInterval(async () => {
      await this.executeMacroSafely(macro.id, "interval", intervalMs);
    }, intervalMs);

    this.intervalHandles.set(key, handle);
    console.log(`[MacroRuntimeRegistry] Registered interval for macro ${macro.id} (${macro.name}): every ${intervalMs}ms`);
  }

  private unregisterTrigger(key: string): void {
    const existing = this.intervalHandles.get(key);
    if (existing) {
      clearInterval(existing);
      this.intervalHandles.delete(key);
    }
  }

  private async executeMacroSafely(macroId: string, triggerType: string, intervalMs: number): Promise<void> {
    const state = this.executionStates.get(macroId) ?? { running: false, runCount: 0 };

    if (state.running) {
      console.warn(`[MacroRuntimeRegistry] Macro ${macroId} is still running, skipping interval tick (${intervalMs}ms)`);
      return;
    }

    state.running = true;
    state.lastStartedAt = Date.now();
    this.executionStates.set(macroId, state);

    try {
      const result = await this.macroService.run(macroId);
      state.runCount += 1;
      state.lastFinishedAt = Date.now();
      state.lastError = undefined;

      if (result.status === "skipped") {
        console.log(`[MacroRuntimeRegistry] Macro ${macroId} skipped (${result.reason ?? "unknown"})`);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      state.lastError = text;
      state.lastFinishedAt = Date.now();
      console.error(`[MacroRuntimeRegistry] Macro ${macroId} execution error: ${text}`);
    } finally {
      state.running = false;
      this.executionStates.set(macroId, state);
    }
  }
}
