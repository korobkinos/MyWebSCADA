import {
  combineTagPrefix,
  getRuntimeValueSourceDependencies,
  resolveLibraryElementInstanceBindingsDetailed,
  resolveParameters,
  resolveTemplateString,
  resolveRuntimeAction,
  resolveTagName,
  type ElementLibrary,
  type HmiObject,
  type HmiScreen,
  type RenderContext,
  type RuntimeAction,
  type RuntimeDependency,
  type ScadaProject,
} from "@web-scada/shared";

type PopupSubscriptionContext = {
  screen: HmiScreen;
  tagPrefix?: string;
  args?: Record<string, unknown>;
};

type RuntimeTagSubscriptionInput = {
  project: ScadaProject;
  libraries: ElementLibrary[];
  screen: HmiScreen;
  popups: PopupSubscriptionContext[];
};

export function collectRuntimeTagSubscriptions(input: RuntimeTagSubscriptionInput): string[] {
  const tags = new Set<string>();
  const frameGuard = new Set<string>();

  collectScreenTags(input.project, input.libraries, input.screen, { screenId: input.screen.id }, tags, frameGuard);
  for (const popup of input.popups) {
    collectScreenTags(
      input.project,
      input.libraries,
      popup.screen,
      {
        screenId: popup.screen.id,
        tagPrefix: popup.tagPrefix,
        parameters: popup.args,
        args: popup.args,
      },
      tags,
      frameGuard,
    );
  }

  return [...tags];
}

function collectScreenTags(
  project: ScadaProject,
  libraries: ElementLibrary[],
  screen: HmiScreen,
  context: RenderContext,
  out: Set<string>,
  frameGuard: Set<string>,
): void {
  for (const object of screen.objects) {
    collectObjectTags(project, libraries, object, context, out, frameGuard);
  }
}

function collectObjectTags(
  project: ScadaProject,
  libraries: ElementLibrary[],
  object: HmiObject,
  context: RenderContext,
  out: Set<string>,
  frameGuard: Set<string>,
): void {
  const resolvedObject = resolveObjectParameters(object, context.parameters ?? {});

  if ("action" in resolvedObject && resolvedObject.action) {
    collectActionTags(resolvedObject.action, context, out);
  }

  switch (resolvedObject.type) {
    case "group":
      for (const child of resolvedObject.objects) {
        collectObjectTags(project, libraries, child, context, out, frameGuard);
      }
      return;
    case "value-display":
    case "value-input":
    case "state-indicator":
    case "switch":
    case "stateImage":
      addTag(out, resolvedObject.tag, context);
      return;
    case "image":
      addTag(out, resolvedObject.stateTag, context);
      return;
    case "valueSelect":
      if (resolvedObject.target.type === "tag") {
        addTag(out, resolvedObject.target.tag, context);
      } else if (resolvedObject.target.type === "lw") {
        out.add(toLwRuntimeTag(resolvedObject.target.address));
      } else {
        out.add(toInternalRuntimeTag(resolvedObject.target.name));
      }
      return;
    case "valve":
      addTag(out, resolvedObject.openTag, context);
      addTag(out, resolvedObject.closedTag, context);
      addTag(out, resolvedObject.errorTag, context);
      addTag(out, resolvedObject.commandOpenTag, context);
      addTag(out, resolvedObject.commandCloseTag, context);
      return;
    case "pump":
      addTag(out, resolvedObject.runTag, context);
      addTag(out, resolvedObject.faultTag, context);
      addTag(out, resolvedObject.commandStartTag, context);
      addTag(out, resolvedObject.commandStopTag, context);
      return;
    case "frame": {
      const childScreen = project.screens.find((item) => item.id === resolvedObject.screenId);
      if (!childScreen) {
        return;
      }

      const childContext: RenderContext = {
        ...context,
        screenId: childScreen.id,
        tagPrefix: combineTagPrefix(context.tagPrefix, resolvedObject.tagPrefix),
      };
      const guardKey = `${childScreen.id}::${childContext.tagPrefix ?? ""}`;
      if (frameGuard.has(guardKey)) {
        return;
      }
      frameGuard.add(guardKey);
      collectScreenTags(project, libraries, childScreen, childContext, out, frameGuard);
      return;
    }
    case "libraryElementInstance": {
      const library = libraries.find((item) => item.id === resolvedObject.libraryId);
      const element = library?.elements.find((item) => item.id === resolvedObject.elementId);
      if (!element) {
        return;
      }

      const defaults = Object.fromEntries((element.parameters ?? []).map((item) => [item.name, item.defaultValue]));
      const resolvedParams = {
        ...defaults,
        ...resolveObjectParameters((resolvedObject.parameterValues ?? {}) as Record<string, unknown>, context.parameters ?? {}),
      } as Record<string, unknown>;

      collectBindingAssignmentDependencies(resolvedObject.bindingAssignments, out);


      const resolvedBindings = resolveLibraryElementInstanceBindingsDetailed(
        element,
        resolvedObject,
      ).resolvedBindings;

      const childContext: RenderContext = {
        ...context,
        tagPrefix: combineTagPrefix(context.tagPrefix, resolvedObject.tagPrefix),
        parameters: resolvedParams,
        bindings: {
          ...(context.bindings ?? {}),
          ...resolvedBindings,
        },
      };

      for (const rule of element.stateRules ?? []) {
        if (rule.source.type === "tag") {
          addTag(out, resolveTemplateString(rule.source.value, childContext.parameters ?? {}), childContext);
        }
      }

      for (const child of element.objects) {
        collectObjectTags(project, libraries, child, childContext, out, frameGuard);
      }
      return;
    }
    default:
      return;
  }
}

function collectActionTags(action: RuntimeAction, context: RenderContext, out: Set<string>): void {
  const resolved = resolveRuntimeAction(action, context);
  if (resolved.type === "write" || resolved.type === "pulse" || resolved.type === "toggle") {
    addTag(out, resolved.tag, context);
    return;
  }
  if ((resolved.type === "writeConst" || resolved.type === "writeNumberPrompt") && resolved.target === "tag") {
    addTag(out, resolved.name, context);
  }
}

function collectBindingAssignmentDependencies(
  assignments: HmiObject extends infer _T ? Record<string, unknown> | undefined : never,
  out: Set<string>,
): void {
  if (!assignments) {
    return;
  }

  for (const assignment of Object.values(assignments)) {
    if (!assignment || typeof assignment !== "object") {
      continue;
    }

    const item = assignment as {
      prefixSource?: Parameters<typeof getRuntimeValueSourceDependencies>[0];
      indexOffsetSource?: Parameters<typeof getRuntimeValueSourceDependencies>[0];
      overrideTagSource?: Parameters<typeof getRuntimeValueSourceDependencies>[0];
    };

    addRuntimeDependencies(out, getRuntimeValueSourceDependencies(item.prefixSource));
    addRuntimeDependencies(out, getRuntimeValueSourceDependencies(item.indexOffsetSource));
    addRuntimeDependencies(out, getRuntimeValueSourceDependencies(item.overrideTagSource));
  }
}

function addRuntimeDependencies(out: Set<string>, dependencies: RuntimeDependency[]): void {
  for (const dependency of dependencies) {
    if (dependency.type === "tag") {
      if (dependency.tag.trim()) {
        out.add(dependency.tag.trim());
      }
      continue;
    }

    if (dependency.type === "lw") {
      out.add(toLwRuntimeTag(dependency.address));
      continue;
    }

    const name = dependency.name.trim();
    if (name) {
      out.add(toInternalRuntimeTag(name));
    }
  }
}


function addTag(out: Set<string>, tag: string | undefined, context: RenderContext): void {
  const resolved = resolveTagName(tag, context);
  if (resolved?.trim()) {
    out.add(resolved.trim());
  }
}

function toInternalRuntimeTag(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.startsWith("LW.") ? trimmed : `LW.${trimmed}`;
}

function toLwRuntimeTag(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

function resolveObjectParameters<T>(value: T, parameters: Record<string, unknown>): T {
  if (!Object.keys(parameters).length) {
    return value;
  }
  return resolveParameters(value as object, parameters) as T;
}
