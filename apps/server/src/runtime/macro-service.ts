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

export class MacroService {
  private macros: MacroDefinition[] = [];

  public constructor(
    private readonly tagStore: TagStore,
    private readonly commandService: CommandService,
    private readonly internalVariableService: InternalVariableService,
  ) {}

  public configure(project: ScadaProject): void {
    this.macros = project.macros ?? [];
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
  ): Promise<{ status: "ok" | "skipped"; reason?: "disabled"; effects?: MacroUiEffect[] }> {
    const macro = this.macros.find((item) => item.id === macroId);
    if (!macro) {
      throw new Error(`Macro ${macroId} not found`);
    }
    if ((macro.enabled ?? true) === false && !options?.allowDisabledForTest) {
      console.warn(`[macro:${macro.id}] Macro is disabled and was not executed`);
      return { status: "skipped", reason: "disabled" };
    }

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

    const context = vm.createContext({
      console,
      Math,
      Date,
      setTimeout,
      clearTimeout,
    });

    const fn = script.runInContext(context) as (api: MacroApi, args: Record<string, unknown>) => Promise<void>;
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

    await fn(api, args ?? {});
    return { status: "ok", effects };
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
