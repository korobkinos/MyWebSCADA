import type {
  ElementStateAction,
  ElementStateCase,
  ElementStateRule,
  HmiObject,
  RenderContext,
  TagValue,
} from "@web-scada/shared";
import { resolveRuntimeValueSync, resolveTagName } from "@web-scada/shared";

type TagMap = Record<string, TagValue>;

export function applyElementStateRules(
  objects: HmiObject[],
  rules: ElementStateRule[] | undefined,
  context: {
    tags: TagMap;
    renderContext: RenderContext;
    parameters: Record<string, unknown>;
  },
): HmiObject[] {
  if (!rules?.length) {
    return objects;
  }

  let nextObjects = objects.map((item) => structuredClone(item));

  for (const rule of rules) {
    const sourceValue = resolveElementStateRuleSource(rule, context);
    const matchedCase = rule.cases.find((item) => evaluateElementStateCondition(sourceValue, item.condition));
    if (!matchedCase) {
      continue;
    }

    for (const action of matchedCase.actions) {
      nextObjects = applyElementStateAction(nextObjects, action);
    }
  }

  return nextObjects;
}

export function resolveElementStateRuleSource(
  rule: ElementStateRule,
  context: {
    tags: TagMap;
    renderContext: RenderContext;
    parameters: Record<string, unknown>;
  },
): unknown {
  if (rule.source.type === "parameter") {
    return context.parameters[rule.source.value];
  }

  if (rule.source.type === "tag") {
    const resolvedTag = resolveTagName(rule.source.value, context.renderContext);
    return resolvedTag ? context.tags[resolvedTag]?.value : undefined;
  }

  if (rule.source.type === "expression") {
    return resolveRuntimeValueSync(
      {
        type: "expression",
        expression: rule.source.value,
      },
      {
        tagValues: context.tags,
      },
    );
  }

  return undefined;
}

export function evaluateElementStateCondition(value: unknown, condition: ElementStateCase["condition"]): boolean {
  if (condition.type === "true") {
    return Boolean(value) === true;
  }
  if (condition.type === "false") {
    return Boolean(value) === false;
  }
  if (condition.type === "equals") {
    return String(value) === String(condition.value);
  }
  if (condition.type === "notEquals") {
    return String(value) !== String(condition.value);
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return false;
  }

  if (condition.type === "greaterThan") {
    return numericValue > condition.value;
  }
  if (condition.type === "lessThan") {
    return numericValue < condition.value;
  }
  if (condition.type === "between") {
    return numericValue >= condition.min && numericValue <= condition.max;
  }

  return false;
}

function applyElementStateAction(objects: HmiObject[], action: ElementStateAction): HmiObject[] {
  return objects.map((object) => patchObjectByStateAction(object, action));
}

function patchObjectByStateAction(object: HmiObject, action: ElementStateAction): HmiObject {
  if (object.type === "group") {
    return {
      ...object,
      objects: object.objects.map((child) => patchObjectByStateAction(child, action)),
    };
  }

  if (object.id !== action.objectId) {
    return object;
  }

  if (action.type === "setVisible") {
    return { ...object, visible: action.visible };
  }

  if (action.type === "setAsset") {
    if (object.type === "image" || object.type === "stateImage") {
      return { ...object, assetId: action.assetId } as HmiObject;
    }
    return object;
  }

  if (action.type === "setText") {
    if (object.type === "text") {
      return { ...object, text: action.text };
    }
    return object;
  }

  if (action.type === "setFill") {
    if (object.type === "rectangle") {
      return { ...object, fill: action.color };
    }
    return object;
  }

  if (action.type === "setStroke") {
    if (object.type === "rectangle" || object.type === "line") {
      return { ...object, stroke: action.color } as HmiObject;
    }
    return object;
  }

  return object;
}