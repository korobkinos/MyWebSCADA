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
  type RuntimeResolveContext,
  type ScadaProject,
  type TagValue,
} from "@web-scada/shared";
import { resolveObjectTagField } from "../tags/indexed-address";

type TagMap = Record<string, TagValue>;

type PopupSubscriptionContext = {
  screen: HmiScreen;
  tagPrefix?: string;
  args?: Record<string, unknown>;
};

type RuntimeTagSubscriptionInput = {
  project: ScadaProject;
  libraries: ElementLibrary[];
  screen: HmiScreen;
  tags?: TagMap;
  popups: PopupSubscriptionContext[];
};

export function collectRuntimeTagSubscriptions(input: RuntimeTagSubscriptionInput): string[] {
  const tags = new Set<string>();
  const frameGuard = new Set<string>();
  const runtimeResolveContext: RuntimeResolveContext = {
    tagValues: input.tags,
  };

  collectScreenTags(
    input.project,
    input.libraries,
    input.screen,
    { screenId: input.screen.id },
    runtimeResolveContext,
    tags,
    frameGuard,
  );

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
      runtimeResolveContext,
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
  runtimeResolveContext: RuntimeResolveContext,
  out: Set<string>,
  frameGuard: Set<string>,
): void {
  for (const object of screen.objects) {
    collectObjectTags(project, libraries, object, context, runtimeResolveContext, out, frameGuard);
  }
}

function collectObjectTags(
  project: ScadaProject,
  libraries: ElementLibrary[],
  object: HmiObject,
  context: RenderContext,
  runtimeResolveContext: RuntimeResolveContext,
  out: Set<string>,
  frameGuard: Set<string>,
): void {
  const resolvedObject = resolveObjectParameters(object, context.parameters ?? {});

  const runtimeTagValues = runtimeResolveContext.tagValues as TagMap | undefined;
  addResolvedFieldTag(out, {
    project,
    object: resolvedObject,
    fieldName: "visibleTag",
    rawTagName: resolvedObject.visibleTag,
    context,
    runtimeTagValues,
  });
  addResolvedFieldTag(out, {
    project,
    object: resolvedObject,
    fieldName: "disabledTag",
    rawTagName: resolvedObject.disabledTag,
    context,
    runtimeTagValues,
  });
  addRotationAnimationFieldTags(out, {
    project,
    object: resolvedObject,
    context,
    runtimeTagValues,
  });

  if ("action" in resolvedObject && resolvedObject.action) {
    collectActionTags(resolvedObject.action, context, out);
  }

  switch (resolvedObject.type) {
    case "group":
      for (const child of resolvedObject.objects) {
        collectObjectTags(project, libraries, child, context, runtimeResolveContext, out, frameGuard);
      }
      return;
    case "line":
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "stateTag",
        rawTagName: resolvedObject.stateTag,
        context,
        runtimeTagValues,
      });
      return;
    case "value-display":
    case "value-input":
    case "state-indicator":
    case "switch":
    case "stateImage":
    case "numeric-image-indicator": {
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      return;
    }
    case "image":
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "stateTag",
        rawTagName: resolvedObject.stateTag,
        context,
        runtimeTagValues,
      });
      return;
    case "valueSelect":
      if (resolvedObject.target.type === "tag") {
        addResolvedFieldTag(out, {
          project,
          object: resolvedObject,
          fieldName: "target.tag",
          rawTagName: resolvedObject.target.tag,
          context,
          runtimeTagValues,
        });
      } else if (resolvedObject.target.type === "lw") {
        out.add(toLwRuntimeTag(resolvedObject.target.address));
      } else {
        out.add(toInternalRuntimeTag(resolvedObject.target.name));
      }
      return;
    case "valve":
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "openTag",
        rawTagName: resolvedObject.openTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "closedTag",
        rawTagName: resolvedObject.closedTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "errorTag",
        rawTagName: resolvedObject.errorTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "commandOpenTag",
        rawTagName: resolvedObject.commandOpenTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "commandCloseTag",
        rawTagName: resolvedObject.commandCloseTag,
        context,
        runtimeTagValues,
      });
      return;
    case "pump":
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "runTag",
        rawTagName: resolvedObject.runTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "faultTag",
        rawTagName: resolvedObject.faultTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "commandStartTag",
        rawTagName: resolvedObject.commandStartTag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "commandStopTag",
        rawTagName: resolvedObject.commandStopTag,
        context,
        runtimeTagValues,
      });
      return;
    case "checkbox": {
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "writeTag",
        rawTagName: resolvedObject.writeTag,
        context,
        runtimeTagValues,
      });
      return;
    }
    case "slider": {
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "writeTag",
        rawTagName: resolvedObject.writeTag,
        context,
        runtimeTagValues,
      });
      return;
    }
    case "progress-bar":
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      return;
    case "select": {
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "writeTag",
        rawTagName: resolvedObject.writeTag,
        context,
        runtimeTagValues,
      });
      return;
    }
    case "radio-group": {
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "writeTag",
        rawTagName: resolvedObject.writeTag,
        context,
        runtimeTagValues,
      });
      return;
    }
    case "numeric-input": {
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "tag",
        rawTagName: resolvedObject.tag,
        context,
        runtimeTagValues,
      });
      addResolvedFieldTag(out, {
        project,
        object: resolvedObject,
        fieldName: "writeTag",
        rawTagName: resolvedObject.writeTag,
        context,
        runtimeTagValues,
      });
      return;
    }
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
      collectScreenTags(project, libraries, childScreen, childContext, runtimeResolveContext, out, frameGuard);
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
        runtimeResolveContext,
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
          continue;
        }
        if (rule.source.type === "expression") {
          const dependencies = getRuntimeValueSourceDependencies({
            type: "expression",
            expression: rule.source.value,
          });
          for (const dependency of dependencies) {
            if (dependency.type === "tag") {
              addTag(out, resolveTemplateString(dependency.tag, childContext.parameters ?? {}), childContext);
              continue;
            }
            addRuntimeDependencies(out, [dependency]);
          }
        }
      }

      for (const child of element.objects) {
        collectObjectTags(project, libraries, child, childContext, runtimeResolveContext, out, frameGuard);
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


function addResolvedFieldTag(
  out: Set<string>,
  input: {
    project: ScadaProject;
    object: HmiObject;
    fieldName: string;
    rawTagName: string | undefined;
    context: RenderContext;
    runtimeTagValues?: TagMap;
  },
): void {
  const indexed = resolveObjectTagField({
    object: input.object,
    fieldName: input.fieldName,
    project: input.project,
    context: input.context,
    tagValues: input.runtimeTagValues,
    rawTagName: input.rawTagName,
  });
  if (indexed.resolvedTagName?.trim()) {
    out.add(indexed.resolvedTagName.trim());
  } else {
    addTag(out, input.rawTagName, input.context);
  }
  for (const dependency of indexed.dependencyTags) {
    if (dependency.trim()) {
      out.add(dependency.trim());
    }
  }
}

function addRotationAnimationFieldTags(
  out: Set<string>,
  input: {
    project: ScadaProject;
    object: HmiObject;
    context: RenderContext;
    runtimeTagValues?: TagMap;
  },
): void {
  const rotationAnimation = input.object.rotationAnimation;
  const hasTriggerTag = Boolean(rotationAnimation?.triggerTag?.trim());
  const hasSpeedTag = Boolean(rotationAnimation?.speedTag?.trim());
  if (!(rotationAnimation?.enabled === true || hasTriggerTag || hasSpeedTag)) {
    return;
  }
  addResolvedFieldTag(out, {
    project: input.project,
    object: input.object,
    fieldName: "rotationAnimation.triggerTag",
    rawTagName: rotationAnimation?.triggerTag,
    context: input.context,
    runtimeTagValues: input.runtimeTagValues,
  });
  addResolvedFieldTag(out, {
    project: input.project,
    object: input.object,
    fieldName: "rotationAnimation.speedTag",
    rawTagName: rotationAnimation?.speedTag,
    context: input.context,
    runtimeTagValues: input.runtimeTagValues,
  });
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
