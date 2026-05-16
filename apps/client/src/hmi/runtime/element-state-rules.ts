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
        tagStore: {
          readTag: (tag: string) => {
            const resolvedTag = resolveTagName(tag, context.renderContext);
            if (resolvedTag) {
              return context.tags[resolvedTag]?.value;
            }
            return context.tags[tag]?.value;
          },
        },
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

  if (action.type === "setProperty") {
    return setObjectPropertyValue(object, action.property, action.value);
  }

  return object;
}

function setObjectPropertyValue(object: HmiObject, propertyPath: string, nextValue: string | number | boolean | null): HmiObject {
  const segments = propertyPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (!isSafePropertyPath(segments)) {
    return object;
  }
  if (segments.length === 0) {
    return object;
  }
  const [first] = segments;
  if (!first || first === "id" || first === "type" || first === "objects") {
    return object;
  }

  const clone = structuredClone(object) as Record<string, unknown>;
  let current: Record<string, unknown> = clone;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!key) {
      return object;
    }
    const value = current[key];
    if (value === null || value === undefined) {
      current[key] = {};
      current = current[key] as Record<string, unknown>;
      continue;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return object;
    }
    current = value as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1];
  if (!leaf) {
    return object;
  }
  current[leaf] = nextValue;
  return clone as HmiObject;
}

function isSafePropertyPath(segments: string[]): boolean {
  if (segments.length === 0) {
    return false;
  }
  return segments.every((segment) => (
    /^[a-zA-Z0-9_]+$/.test(segment)
    && segment !== "__proto__"
    && segment !== "prototype"
    && segment !== "constructor"
  ));
}
