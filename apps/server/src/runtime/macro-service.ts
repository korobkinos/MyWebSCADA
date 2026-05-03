import * as vm from "node:vm";
import ts from "typescript";
import type { MacroDefinition, ScadaProject, TagScalarValue } from "@web-scada/shared";
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
  }

  public list(): MacroDefinition[] {
    return this.macros;
  }

  public async run(macroId: string, args?: Record<string, unknown>): Promise<void> {
    const macro = this.macros.find((item) => item.id === macroId);
    if (!macro) {
      throw new Error(`Macro ${macroId} not found`);
    }

    const jsCode = ts.transpileModule(macro.code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;

    const wrapped = `\n(async (api, args) => {\n${jsCode}\n})`;
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

    const api: MacroApi = {
      readTag: (name) => tagStore.getValue(name)?.value ?? null,
      writeTag: async (name, value) => {
        await commandService.writeTag(name, value);
      },
      readVariable: (name) => internalVariableService.get(name)?.value ?? null,
      writeVariable: (name, value) => {
        internalVariableService.write(name, value);
      },
      log: (...items) => console.log(`[macro:${macro.id}]`, ...items),
    };

    await fn(api, args ?? {});
  }
}

type MacroApi = {
  readTag: (name: string) => TagScalarValue;
  writeTag: (name: string, value: TagScalarValue) => Promise<void>;
  readVariable: (name: string) => TagScalarValue;
  writeVariable: (name: string, value: TagScalarValue) => void;
  log: (...items: unknown[]) => void;
};
