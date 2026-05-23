import { resolveRuntimeAction, type RuntimeAction } from "@web-scada/shared";
import type { CommandService } from "../runtime/command-service.js";

export type EventActionTrigger = "active" | "cleared" | "ack";

type EventActionLogger = {
  warn(message: string): void;
};

type ExecuteEventActionsInput = {
  trigger: EventActionTrigger;
  eventDefinitionId: string;
  occurrenceId: string;
  actions: RuntimeAction[] | undefined;
  commandService?: CommandService;
  logger: EventActionLogger;
};

type EventActionSplit = {
  serverExecutable: RuntimeAction[];
  clientExecutable: RuntimeAction[];
};

const SERVER_EXECUTABLE_TYPES: ReadonlySet<RuntimeAction["type"]> = new Set([
  "write",
  "pulse",
  "toggle",
  "writeConst",
  "setLW",
  "setInternalVar",
]);

export function splitEventActions(actions: RuntimeAction[] | undefined): EventActionSplit {
  const serverExecutable: RuntimeAction[] = [];
  const clientExecutable: RuntimeAction[] = [];

  for (const action of actions ?? []) {
    if (SERVER_EXECUTABLE_TYPES.has(action.type)) {
      serverExecutable.push(action);
      continue;
    }
    clientExecutable.push(action);
  }

  return {
    serverExecutable,
    clientExecutable,
  };
}

export async function executeEventActions(input: ExecuteEventActionsInput): Promise<RuntimeAction[]> {
  const split = splitEventActions(input.actions);
  if (split.serverExecutable.length === 0) {
    return split.clientExecutable;
  }

  if (!input.commandService) {
    input.logger.warn(
      `[EventEngine] action command service unavailable event=${input.eventDefinitionId} occurrence=${input.occurrenceId} trigger=${input.trigger} skipped=${split.serverExecutable.length}`,
    );
    return split.clientExecutable;
  }

  for (const rawAction of split.serverExecutable) {
    const action = resolveRuntimeAction(rawAction, {});
    try {
      await executeServerAction(input.commandService, action);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      input.logger.warn(
        `[EventEngine] action failed event=${input.eventDefinitionId} occurrence=${input.occurrenceId} trigger=${input.trigger} type=${action.type} error=${text}`,
      );
    }
  }

  return split.clientExecutable;
}

async function executeServerAction(commandService: CommandService, action: RuntimeAction): Promise<void> {
  if (action.type === "write") {
    await commandService.writeTag(action.tag, action.value);
    return;
  }

  if (action.type === "pulse") {
    await commandService.pulseTag(action.tag, action.value, action.durationMs);
    return;
  }

  if (action.type === "toggle") {
    await commandService.toggleTag(action.tag);
    return;
  }

  if (action.type === "writeConst") {
    if (action.target === "tag") {
      await commandService.writeTag(action.name, action.value);
      return;
    }
    await commandService.writeVariable(action.name, action.value);
    return;
  }

  if (action.type === "setLW") {
    const lwName = `LW${Math.max(0, Math.floor(action.address))}`;
    await commandService.writeVariable(lwName, action.value);
    return;
  }

  if (action.type === "setInternalVar") {
    await commandService.writeVariable(action.name, action.value);
  }
}
