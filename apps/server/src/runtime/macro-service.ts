import * as vm from "node:vm";
import ts from "typescript";
import type {
  MacroDefinition,
  MacroRuntimeContext,
  MacroUiEffect,
  ScadaProject,
  TagScalarValue,
} from "@web-scada/shared";
import { CommandService } from "./command-service.js";
import { InternalVariableService } from "./internal-variable-service.js";
import { TagStore } from "../tags/tag-store.js";

type MacroRunReason = "disabled" | "already_running";

type MacroRunStatus = {
  status: "ok" | "skipped";
  reason?: MacroRunReason;
  effects?: MacroUiEffect[];
};

type MacroExecutionDiagnostics = {
  lookupMs: number;
  compileMs: number;
  executionMs: number;
  totalMs: number;
  cacheStatus: "hit" | "miss";
};

type MacroRunInternalResult = MacroRunStatus & {
  diagnostics: MacroExecutionDiagnostics;
};

type CompiledMacro = {
  macroId: string;
  macroName: string;
  code: string;
  compiledAt: number;
  script: vm.Script;
};

export class MacroService {
  private macros: MacroDefinition[] = [];
  private readonly compiledMacros = new Map<string, CompiledMacro>();
  private readonly manualInFlight = new Set<string>();
  private readonly slowExecutionWarnMs = 250;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly commandService: CommandService,
    private readonly internalVariableService: InternalVariableService,
  ) {}

  public configure(project: ScadaProject): void {
    const nextMacros = project.macros ?? [];
    const nextMacroIds = new Set(nextMacros.map((macro) => macro.id));

    for (const macroId of this.compiledMacros.keys()) {
      if (!nextMacroIds.has(macroId)) {
        this.compiledMacros.delete(macroId);
      }
    }

    for (const macro of nextMacros) {
      const cached = this.compiledMacros.get(macro.id);
      if (cached && cached.code !== macro.code) {
        this.compiledMacros.delete(macro.id);
      }
    }

    this.macros = nextMacros;
    console.log(`[MacroService] Configured with ${this.macros.length} macros`);
  }

  public list(): MacroDefinition[] {
    return this.macros;
  }

  public getById(macroId: string): MacroDefinition | undefined {
    return this.macros.find((item) => item.id === macroId);
  }

  public async run(
    macroId: string,
    args?: Record<string, unknown>,
    options?: { allowDisabledForTest?: boolean; context?: Record<string, unknown> },
  ): Promise<MacroRunStatus> {
    const result = await this.runInternal(macroId, args, options);
    return {
      status: result.status,
      reason: result.reason,
      effects: result.effects,
    };
  }

  public async runManual(
    macroId: string,
    args?: Record<string, unknown>,
    options?: { allowDisabledForTest?: boolean; context?: Record<string, unknown> },
  ): Promise<MacroRunInternalResult> {
    if (this.manualInFlight.has(macroId)) {
      return {
        status: "skipped",
        reason: "already_running",
        diagnostics: {
          lookupMs: 0,
          compileMs: 0,
          executionMs: 0,
          totalMs: 0,
          cacheStatus: "hit",
        },
      };
    }

    this.manualInFlight.add(macroId);
    try {
      return await this.runInternal(macroId, args, options);
    } finally {
      this.manualInFlight.delete(macroId);
    }
  }

  private async runInternal(
    macroId: string,
    args?: Record<string, unknown>,
    options?: { allowDisabledForTest?: boolean; context?: Record<string, unknown> },
  ): Promise<MacroRunInternalResult> {
    const startedAt = Date.now();
    const lookupStartedAt = Date.now();
    const macro = this.macros.find((item) => item.id === macroId);
    const lookupMs = Date.now() - lookupStartedAt;
    if (!macro) {
      throw new Error(`Macro ${macroId} not found`);
    }
    if ((macro.enabled ?? true) === false && !options?.allowDisabledForTest) {
      console.warn(`[macro:${macro.id}] Macro is disabled and was not executed`);
      return {
        status: "skipped",
        reason: "disabled",
        diagnostics: {
          lookupMs,
          compileMs: 0,
          executionMs: 0,
          totalMs: Date.now() - startedAt,
          cacheStatus: "hit",
        },
      };
    }

    const compileStartedAt = Date.now();
    const { compiled, cacheStatus } = this.getCompiledMacro(macro);
    const compileMs = Date.now() - compileStartedAt;

    const context = vm.createContext({
      console,
      Math,
      Date,
      setTimeout,
      clearTimeout,
    });

    const fn = compiled.script.runInContext(context) as (api: MacroApi, args: Record<string, unknown>) => Promise<void>;
    const commandService = this.commandService;
    const internalVariableService = this.internalVariableService;
    const tagStore = this.tagStore;
    const runtimeContext = toMacroRuntimeContext(options?.context);
    const effects: MacroUiEffect[] = [];

    const api: MacroApi = {
      readTag: (name) => tagStore.getValue(name)?.value ?? null,
      writeTag: async (name, value) => {
        await commandService.writeTag(name, value);
      },
      pulseTag: async (name, value, durationMs, resetValue) => {
        await commandService.writeTag(name, value);
        const rollback = resetValue === undefined ? false : resetValue;
        const delay = Math.max(1, Math.floor(durationMs));
        setTimeout(() => {
          void commandService.writeTag(name, rollback).catch(() => undefined);
        }, delay);
      },
      toggleTag: async (name) => {
        await commandService.toggleTag(name);
      },
      getTagQuality: (name) => tagStore.getValue(name)?.quality ?? (tagStore.getDefinition(name) ? "Uncertain" : "Bad"),
      tagExists: (name) => Boolean(tagStore.getDefinition(name)),
      getLW: (address) => internalVariableService.get(`LW${Math.max(0, Math.floor(address))}`)?.value ?? null,
      setLW: (address, value) => {
        internalVariableService.write(`LW${Math.max(0, Math.floor(address))}`, value);
      },
      getVar: (name) => internalVariableService.get(name)?.value ?? null,
      setVar: (name, value) => {
        internalVariableService.write(name, value);
      },
      readVariable: (name) => internalVariableService.get(name)?.value ?? null,
      writeVariable: (name, value) => {
        internalVariableService.write(name, value);
      },
      openPopup: (popupScreenId, popupOptions) => {
        effects.push({
          type: "openPopup",
          popupScreenId,
          title: popupOptions?.title,
          x: popupOptions?.x,
          y: popupOptions?.y,
          tagPrefix: popupOptions?.tagPrefix,
          args: popupOptions?.args,
        });
      },
      closePopup: (popupInstanceId) => {
        effects.push({
          type: "closePopup",
          popupInstanceId,
        });
      },
      openScreen: (screenId) => {
        effects.push({
          type: "openScreen",
          screenId,
        });
      },
      getCurrentTagPrefix: () => runtimeContext.tagPrefix,
      getContext: () => runtimeContext,
      resolveTag: (relativeOrAbsoluteTag, providedPrefix) => {
        if (!relativeOrAbsoluteTag.startsWith(".")) {
          return relativeOrAbsoluteTag;
        }
        const effectivePrefix = (providedPrefix ?? runtimeContext.tagPrefix ?? "").trim();
        if (!effectivePrefix) {
          return relativeOrAbsoluteTag.slice(1);
        }
        return `${effectivePrefix}${relativeOrAbsoluteTag}`;
      },
      log: (...items) => console.log(`[macro:${macro.id}]`, ...items),
      warn: (...items) => console.warn(`[macro:${macro.id}]`, ...items),
      error: (...items) => console.error(`[macro:${macro.id}]`, ...items),
    };

    const executionStartedAt = Date.now();
    await fn(api, args ?? {});
    const executionMs = Date.now() - executionStartedAt;
    const totalMs = Date.now() - startedAt;

    if (executionMs > this.slowExecutionWarnMs) {
      console.warn(
        `[MacroService] Slow macro execution macroId=${macro.id} macroName=${macro.name} executionMs=${executionMs} totalMs=${totalMs}`,
      );
    }

    return {
      status: "ok",
      effects,
      diagnostics: {
        lookupMs,
        compileMs,
        executionMs,
        totalMs,
        cacheStatus,
      },
    };
  }

  private getCompiledMacro(macro: MacroDefinition): { compiled: CompiledMacro; cacheStatus: "hit" | "miss" } {
    const cached = this.compiledMacros.get(macro.id);
    if (cached && cached.code === macro.code) {
      return { compiled: cached, cacheStatus: "hit" };
    }
    const compiled = this.compileMacro(macro);
    this.compiledMacros.set(macro.id, compiled);
    return { compiled, cacheStatus: "miss" };
  }

  private compileMacro(macro: MacroDefinition): CompiledMacro {
    try {
      const jsCode = ts.transpileModule(macro.code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText;

      const wrapped =
        `\n(async (api, args) => {\n` +
        `const {\n` +
        `  readTag,\n` +
        `  writeTag,\n` +
        `  pulseTag,\n` +
        `  toggleTag,\n` +
        `  getTagQuality,\n` +
        `  tagExists,\n` +
        `  getLW,\n` +
        `  setLW,\n` +
        `  getVar,\n` +
        `  setVar,\n` +
        `  readVariable,\n` +
        `  writeVariable,\n` +
        `  openPopup,\n` +
        `  closePopup,\n` +
        `  openScreen,\n` +
        `  getCurrentTagPrefix,\n` +
        `  getContext,\n` +
        `  resolveTag,\n` +
        `  log,\n` +
        `  warn,\n` +
        `  error,\n` +
        `} = api;\n` +
        `${jsCode}\n` +
        `})`;
      const script = new vm.Script(wrapped, { filename: `macro-${macro.id}.ts` });
      const compiledAt = Date.now();

      console.log(`[MacroService] Compiled macro macroId=${macro.id} macroName=${macro.name}`);

      return {
        macroId: macro.id,
        macroName: macro.name,
        code: macro.code,
        compiledAt,
        script,
      };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to compile macro ${macro.id} (${macro.name}): ${text}`);
    }
  }
}

type MacroApi = {
  readTag: (name: string) => TagScalarValue;
  writeTag: (name: string, value: TagScalarValue) => Promise<void>;
  pulseTag: (name: string, value: TagScalarValue, durationMs: number, resetValue?: TagScalarValue) => Promise<void>;
  toggleTag: (name: string) => Promise<void>;
  getTagQuality: (name: string) => "Good" | "Bad" | "Uncertain";
  tagExists: (name: string) => boolean;
  getLW: (address: number) => TagScalarValue;
  setLW: (address: number, value: TagScalarValue) => void;
  getVar: (name: string) => TagScalarValue;
  setVar: (name: string, value: TagScalarValue) => void;
  readVariable: (name: string) => TagScalarValue;
  writeVariable: (name: string, value: TagScalarValue) => void;
  openPopup: (popupScreenId: string, options?: {
    title?: string;
    x?: number;
    y?: number;
    tagPrefix?: string;
    args?: Record<string, unknown>;
  }) => void;
  closePopup: (popupInstanceId?: string) => void;
  openScreen: (screenId: string) => void;
  getCurrentTagPrefix: () => string | undefined;
  getContext: () => MacroRuntimeContext;
  resolveTag: (relativeOrAbsoluteTag: string, tagPrefix?: string) => string;
  log: (...items: unknown[]) => void;
  warn: (...items: unknown[]) => void;
  error: (...items: unknown[]) => void;
};

function toMacroRuntimeContext(input: Record<string, unknown> | undefined): MacroRuntimeContext {
  if (!input) {
    return {};
  }

  const out: MacroRuntimeContext = {};
  if (typeof input.tagPrefix === "string") {
    out.tagPrefix = input.tagPrefix;
  }
  if (typeof input.popupInstanceId === "string") {
    out.popupInstanceId = input.popupInstanceId;
  }
  if (typeof input.screenId === "string") {
    out.screenId = input.screenId;
  }
  if (input.parameters && typeof input.parameters === "object") {
    out.parameters = input.parameters as Record<string, unknown>;
  }
  return out;
}
