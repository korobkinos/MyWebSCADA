import { z } from "zod";
import type { HmiObject } from "./hmi-object-types";

const expressionBindingSchema = z.object({
  mode: z.enum(["tag", "expr"]),
  source: z.string().min(1),
  fallback: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const hmiBindingsSchema = z
  .object({
    visible: expressionBindingSchema.optional(),
    fill: expressionBindingSchema.optional(),
    text: expressionBindingSchema.optional(),
    enabled: expressionBindingSchema.optional(),
  })
  .optional();

const textStyleSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  fontStyle: z.enum(["normal", "bold", "italic", "bold italic"]).optional(),
  color: z.string().min(1),
  horizontalAlign: z.enum(["left", "center", "right"]),
  verticalAlign: z.enum(["top", "middle", "bottom"]),
  padding: z.number().nonnegative().optional(),
});

const textLayoutSchema = z.object({
  wrap: z.enum(["none", "word", "char"]).optional(),
  ellipsis: z.boolean().optional(),
});

const rotationAnimationSchema = z.object({
  enabled: z.boolean().optional(),
  triggerTag: z.string().optional(),
  triggerMode: z.enum(["truthy", "equals", "notEquals"]).optional(),
  triggerValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  triggerInvert: z.boolean().optional(),
  speedSource: z.enum(["fixed", "tag"]).optional(),
  fixedSpeedDegPerSec: z.number().optional(),
  speedTag: z.string().optional(),
  minSpeedDegPerSec: z.number().optional(),
  maxSpeedDegPerSec: z.number().optional(),
  direction: z.enum(["clockwise", "counterclockwise"]).optional(),
  pivot: z.enum(["center", "origin"]).optional(),
});

const flowAnimationSchema = z.object({
  enabled: z.boolean().optional(),
  triggerTag: z.string().optional(),
  triggerMode: z.enum(["truthy", "equals", "notEquals"]).optional(),
  triggerValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  triggerInvert: z.boolean().optional(),
  speedSource: z.enum(["fixed", "tag"]).optional(),
  fixedSpeedPxPerSec: z.number().optional(),
  speedTag: z.string().optional(),
  minSpeedPxPerSec: z.number().optional(),
  maxSpeedPxPerSec: z.number().optional(),
  direction: z.enum(["forward", "reverse"]).optional(),
  effectType: z.enum(["dash", "arrows", "dots", "gradientShift"]).optional(),
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  strokeWidth: z.number().optional(),
  useBaseStrokeWidth: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientMidColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientSpanPx: z.number().optional(),
  dashLength: z.number().optional(),
  gapLength: z.number().optional(),
});

const operatorActionLoggingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  messageTemplate: z.string().optional(),
});

const hmiBaseSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  operatorActionLogging: operatorActionLoggingConfigSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().optional(),
  rotationAnimation: rotationAnimationSchema.optional(),
  visible: z.boolean().optional(),
  visibleForRoles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])).optional(),
  requiredVisibleRole: z.number().int().min(0).max(4).optional(),
  requiredActionRole: z.number().int().min(0).max(4).optional(),
  onPressMacroId: z.string().optional(),
  onReleaseMacroId: z.string().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  shadowEnabled: z.boolean().optional(),
  shadowColor: z.string().optional(),
  shadowOpacity: z.number().min(0).max(1).optional(),
  shadowBlur: z.number().nonnegative().optional(),
  shadowDistance: z.number().nonnegative().optional(),
  shadowDirection: z.enum(["right", "left", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  minWidth: z.number().positive().optional(),
  minHeight: z.number().positive().optional(),
  bindings: hmiBindingsSchema,
  visibleTag: z.string().optional(),
  visibleInvert: z.boolean().optional(),
  disabledTag: z.string().optional(),
  disabledInvert: z.boolean().optional(),
  tagIndexingByField: z.record(
    z.object({
      enabled: z.boolean(),
      template: z.string(),
      bindings: z.array(
        z.object({
          key: z.string().min(1),
          slotIndex: z.number().int().nonnegative(),
          baseValue: z.number(),
          source: z.enum(["constant", "runtimeArg", "internalVariable", "tag", "macroVariable"]),
          sourceName: z.string().optional(),
          constantValue: z.number().optional(),
          offset: z.number().optional(),
        }),
      ),
    }),
  ).optional(),
  tagIndexing: z
    .object({
      enabled: z.boolean(),
      template: z.string(),
      bindings: z.array(
        z.object({
          key: z.string().min(1),
          slotIndex: z.number().int().nonnegative(),
          baseValue: z.number(),
          source: z.enum(["constant", "runtimeArg", "internalVariable", "tag", "macroVariable"]),
          sourceName: z.string().optional(),
          constantValue: z.number().optional(),
          offset: z.number().optional(),
        }),
      ),
    })
    .optional(),
});

const assetTypeSchema = z.enum(["png", "jpg", "jpeg", "svg"]);
const appRoleSchema = z.enum(["admin", "engineer", "operator", "viewer"]);
const runtimeActionAccessSchema = z.object({
  requireAuth: z.boolean().optional(),
  requiredRoles: z.array(appRoleSchema).optional(),
  requiredRoleLevel: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]).optional(),
});

export const assetSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().optional(),
  name: z.string().min(1),
  folderPath: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: assetTypeSchema,
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
  size: z.number().nonnegative(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  storagePath: z.string().min(1),
  previewUrl: z.string().min(1),
});

export const assetGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const projectLibraryRefSchema = z.object({
  libraryId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  path: z.string().optional(),
  enabled: z.boolean(),
});

const runtimeActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("openScreen"),
    screenId: z.string().min(1),
  }),
  z.object({
    type: z.literal("openPopup"),
    popupScreenId: z.string().min(1),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    tagPrefix: z.string().optional(),
    args: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("closePopup"),
    popupInstanceId: z.string().optional(),
  }),
  z.object({
    type: z.literal("write"),
    tag: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("pulse"),
    tag: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    durationMs: z.number().int().positive(),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("toggle"),
    tag: z.string().min(1),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("writeConst"),
    target: z.enum(["tag", "variable"]),
    name: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("writeNumberPrompt"),
    target: z.enum(["tag", "variable"]),
    name: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("openUrl"),
    url: z.string().min(1),
    newTab: z.boolean().optional(),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("runMacro"),
    macroId: z.string().min(1),
    args: z.record(z.unknown()).optional(),
    allowRepeat: z.boolean().optional(),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("setLW"),
    address: z.number().int().nonnegative(),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
  z.object({
    type: z.literal("setInternalVar"),
    name: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
]).and(runtimeActionAccessSchema);

const textObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("text"),
  text: z.string(),
  tag: z.string().optional(),
  textStyle: textStyleSchema,
});

const lineObjectSchema = hmiBaseSchema.extend({
  type: z.literal("line"),
  points: z.array(z.number()).min(4),
  stroke: z.string(),
  strokeWidth: z.number().positive(),
  lineCap: z.enum(["butt", "round", "square"]).optional(),
  lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
  cornerRadius: z.number().optional(),
  closed: z.boolean().optional(),
  fill: z.string().optional(),
  stateTag: z.string().optional(),
  activeValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  inactiveStroke: z.string().optional(),
  activeStroke: z.string().optional(),
  gradientEnabled: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "center-outward", "outside-inward"]).optional(),
  flowAnimation: flowAnimationSchema.optional(),
});

const compoundShapeObjectSchema = hmiBaseSchema.extend({
  type: z.literal("compoundShape"),
  parts: z.array(
    z.object({
      points: z.array(z.number()).min(6),
      closed: z.boolean().optional(),
    }),
  ).min(1),
  fill: z.string().optional(),
  fillPatternStyle: z.enum(["solid", "beveledHatch", "beveledHatchDense", "beveledHatchWide", "beveledCrosshatch", "beveledZigzag"]).optional(),
  fillPatternColor: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  strokePatternStyle: z.enum(["solid", "beveledHatch", "beveledHatchDense", "beveledHatchWide", "beveledCrosshatch", "beveledZigzag"]).optional(),
  strokePatternColor: z.string().optional(),
  lineCap: z.enum(["butt", "round", "square"]).optional(),
  lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
  fillRule: z.enum(["nonzero", "evenodd"]).optional(),
});

const rectangleObjectSchema = hmiBaseSchema.extend({
  type: z.literal("rectangle"),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  gradientEnabled: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "center-outward", "outside-inward"]).optional(),
});

const valueDisplayObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("value-display"),
  tag: z.string().min(1),
  format: z.string().optional(),
  suffix: z.string().optional(),
  badQualityText: z.string().optional(),
  textStyle: textStyleSchema,
});

const valueInputObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("value-input"),
  tag: z.string().min(1),
  format: z.string().optional(),
  suffix: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  confirm: z.boolean().optional(),
  confirmText: z.string().optional(),
  textStyle: textStyleSchema,
});

const stateIndicatorObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("state-indicator"),
  tag: z.string().min(1),
  trueText: z.string(),
  falseText: z.string(),
  trueColor: z.string(),
  falseColor: z.string(),
  badColor: z.string(),
  gradientEnabled: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "center-outward", "outside-inward"]).optional(),
  textStyle: textStyleSchema,
});

const buttonObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("button"),
  text: z.string().optional(),
  showText: z.boolean().optional(),
  backgroundAssetId: z.string().optional(),
  pressedBackgroundAssetId: z.string().optional(),
  disabledBackgroundAssetId: z.string().optional(),
  backgroundColor: z.string().optional(),
  pressedBackgroundColor: z.string().optional(),
  disabledBackgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().nonnegative().optional(),
  gradientEnabled: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "center-outward", "outside-inward"]).optional(),
  textStyle: textStyleSchema,
  action: runtimeActionSchema,
});

const switchObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("switch"),
  tag: z.string().min(1),
  onText: z.string().optional(),
  offText: z.string().optional(),
  onColor: z.string().optional(),
  offColor: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().nonnegative().optional(),
  gradientEnabled: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "center-outward", "outside-inward"]).optional(),
  textStyle: textStyleSchema,
});

const imageObjectSchema = hmiBaseSchema.extend({
  type: z.literal("image"),
  assetId: z.string().optional(),
  src: z.string().optional(),
  action: runtimeActionSchema.optional(),
  fit: z.enum(["contain", "cover", "stretch", "none"]),
  preserveAspectRatio: z.boolean().optional(),
  stateTag: z.string().optional(),
  stateImages: z
    .array(
      z.object({
        state: z.union([z.string(), z.number(), z.boolean()]),
        assetId: z.string().optional(),
        src: z.string().optional(),
      }),
    )
    .optional(),
  bindings: z
    .object({
      visible: expressionBindingSchema.optional(),
      fill: expressionBindingSchema.optional(),
      text: expressionBindingSchema.optional(),
      enabled: expressionBindingSchema.optional(),
      opacity: expressionBindingSchema.optional(),
      assetId: expressionBindingSchema.optional(),
    })
    .optional(),
});

const stateImageConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("equals"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ type: z.literal("notEquals"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ type: z.literal("true") }),
  z.object({ type: z.literal("false") }),
]);

const stateImageObjectSchema = hmiBaseSchema.extend({
  type: z.literal("stateImage"),
  tag: z.string().min(1),
  states: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      condition: stateImageConditionSchema,
      assetId: z.string().min(1),
    }),
  ),
  defaultAssetId: z.string().optional(),
  badQualityAssetId: z.string().optional(),
  fit: z.enum(["contain", "cover", "stretch", "none"]),
  preserveAspectRatio: z.boolean().optional(),
  action: runtimeActionSchema.optional(),
});

const prefixApplyModeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("segment"),
    segmentIndex: z.number().int().nonnegative(),
    position: z.enum(["append", "prepend"]),
  }),
  z.object({
    type: z.literal("segmentByName"),
    segmentName: z.string().min(1),
    position: z.enum(["append", "prepend"]),
  }),
  z.object({
    type: z.literal("lastSegment"),
    position: z.enum(["append", "prepend"]),
  }),
]);

const indexApplyModeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("arrayIndex"),
    occurrence: z.number().int().nonnegative(),
    operation: z.literal("add"),
    valueFrom: z.literal("indexOffset"),
  }),
  z.object({
    type: z.literal("arrayIndexBySegment"),
    segmentName: z.string().min(1),
    operation: z.literal("add"),
    valueFrom: z.literal("indexOffset"),
  }),
]);

function normalizeFrameTagIndexRules(
  value: unknown,
): Array<{
  id: string;
  enabled: boolean;
  name?: string;
  indexOffset: number;
  indexMode: z.infer<typeof indexApplyModeSchema>;
  conflictMode: "skipLocal";
}> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: Array<{
    id: string;
    enabled: boolean;
    name?: string;
    indexOffset: number;
    indexMode: z.infer<typeof indexApplyModeSchema>;
    conflictMode: "skipLocal";
  }> = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const indexModeParsed = indexApplyModeSchema.safeParse(candidate.indexMode);
    const indexOffset = Number(candidate.indexOffset);
    const normalizedRule = {
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `frame-index-rule-${index + 1}`,
      enabled: candidate.enabled !== false,
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : undefined,
      indexOffset: Number.isFinite(indexOffset) ? indexOffset : 0,
      indexMode: indexModeParsed.success ? indexModeParsed.data : { type: "none" as const },
      conflictMode: "skipLocal" as const,
    };
    normalized.push(normalizedRule);
  }

  return normalized;
}

const runtimeValueSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("static"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
  z.object({
    type: z.literal("tag"),
    tag: z.string().min(1),
  }),
  z.object({
    type: z.literal("lw"),
    address: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("internal"),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("expression"),
    expression: z.string().min(1),
  }),
]);

const elementBindingAssignmentSchema = z.object({
  baseTag: z.string(),
  prefixSource: runtimeValueSourceSchema.optional(),
  prefix: z.string().optional(),
  prefixMode: prefixApplyModeSchema.optional(),
  indexOffsetSource: runtimeValueSourceSchema.optional(),
  indexOffset: z.number().int().optional(),
  indexMode: indexApplyModeSchema.optional(),
  overrideTagSource: runtimeValueSourceSchema.optional(),
  overrideTag: z.string().optional(),
});

const valueSelectObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("valueSelect"),
  options: z.array(
    z.object({
      label: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ),
  target: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("internal"),
      name: z.string().min(1),
    }),
    z.object({
      type: z.literal("lw"),
      address: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("tag"),
      tag: z.string().min(1),
    }),
  ]),
  valueType: z.enum(["string", "number", "boolean"]),
  textStyle: textStyleSchema,
});

const libraryElementInstanceSchema = hmiBaseSchema.extend({
  type: z.literal("libraryElementInstance"),
  libraryId: z.string().min(1),
  elementId: z.string().min(1),
  tagPrefix: z.string().optional(),
  parameterValues: z.record(z.unknown()).optional(),
  bindingAssignments: z.record(elementBindingAssignmentSchema).optional(),
  scaleMode: z.enum(["none", "fit", "stretch"]).optional(),
  action: runtimeActionSchema.optional(),
});

const valveObjectSchema = hmiBaseSchema.extend({
  type: z.literal("valve"),
  openTag: z.string().optional(),
  closedTag: z.string().optional(),
  errorTag: z.string().optional(),
  commandOpenTag: z.string().optional(),
  commandCloseTag: z.string().optional(),
  label: z.string().optional(),
  textStyle: textStyleSchema,
  popupScreenId: z.string().optional(),
});

const pumpObjectSchema = hmiBaseSchema.extend({
  type: z.literal("pump"),
  runTag: z.string().optional(),
  faultTag: z.string().optional(),
  commandStartTag: z.string().optional(),
  commandStopTag: z.string().optional(),
  label: z.string().optional(),
  textStyle: textStyleSchema,
  popupScreenId: z.string().optional(),
});

const frameObjectSchema = hmiBaseSchema.extend({
  type: z.literal("frame"),
  screenId: z.string().min(1),
  tagPrefix: z.string().optional(),
  tagIndexRules: z
    .array(z.unknown())
    .optional()
    .transform((value) => normalizeFrameTagIndexRules(value)),
  showTemplateBackground: z.boolean().optional(),
  clipContent: z.boolean().optional(),
  showBorder: z.boolean().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().positive().optional(),
  scaleMode: z.enum(["none", "fit", "stretch"]).optional(),
});

const checkboxObjectSchema = hmiBaseSchema.extend({
  type: z.literal("checkbox"),
  label: z.string().optional(),
  tag: z.string().optional(),
  writeTag: z.string().optional(),
  writeMode: z.enum(["toggleState", "writeTrue", "writeFalse", "pulseTrue", "pulseFalse"]).optional(),
  pulseDurationMs: z.number().int().positive().optional(),
  checkedText: z.string().optional(),
  uncheckedText: z.string().optional(),
  checkedColor: z.string().optional(),
  uncheckedColor: z.string().optional(),
});

const sliderObjectSchema = hmiBaseSchema.extend({
  type: z.literal("slider"),
  tag: z.string().optional(),
  writeTag: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  unit: z.string().optional(),
  showValue: z.boolean().optional(),
  fillColor: z.string().optional(),
  trackColor: z.string().optional(),
  thumbColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  trackThickness: z.number().optional(),
  thumbRadius: z.number().optional(),
  thumbBorderColor: z.string().optional(),
  textColor: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  decimals: z.number().optional(),
  valuePosition: z.enum(["top", "bottom", "left", "right", "center", "hidden"]).optional(),
  showMinMax: z.boolean().optional(),
  minMaxFontSize: z.number().optional(),
  minLabelOffset: z.number().optional(),
  maxLabelOffset: z.number().optional(),
  writeOnRelease: z.boolean().optional(),
  dragWriteIntervalMs: z.number().optional(),
  releaseSyncHoldMs: z.number().optional(),
  badColor: z.string().optional(),
  badTextColor: z.string().optional(),
  disabledColor: z.string().optional(),
  disabledTextColor: z.string().optional(),
  transparentBackground: z.boolean().optional(),
});

const progressBarObjectSchema = hmiBaseSchema.extend({
  type: z.literal("progress-bar"),
  tag: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  unit: z.string().optional(),
  showValue: z.boolean().optional(),
  fillColor: z.string().optional(),
  trackColor: z.string().optional(),
  alarmColor: z.string().optional(),
});

const selectObjectSchema = hmiBaseSchema.extend({
  type: z.literal("select"),
  tag: z.string().optional(),
  writeTag: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    )
    .optional(),
  placeholder: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  textColor: z.string().optional(),
  placeholderColor: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  padding: z.number().optional(),
  arrowColor: z.string().optional(),
  dropdownBackgroundColor: z.string().optional(),
  dropdownBorderColor: z.string().optional(),
  optionTextColor: z.string().optional(),
  optionHoverColor: z.string().optional(),
  optionSelectedColor: z.string().optional(),
  optionSelectedTextColor: z.string().optional(),
  dropdownMaxHeight: z.number().optional(),
  dropdownOffsetY: z.number().optional(),
  optionHeight: z.number().optional(),
  arrowAreaWidth: z.number().optional(),
  badTextColor: z.string().optional(),
  badBackgroundColor: z.string().optional(),
  badBorderColor: z.string().optional(),
  disabledBackgroundColor: z.string().optional(),
  disabledTextColor: z.string().optional(),
});

const radioGroupObjectSchema = hmiBaseSchema.extend({
  type: z.literal("radio-group"),
  tag: z.string().optional(),
  writeTag: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    )
    .optional(),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  backgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  itemGap: z.number().optional(),
  itemPadding: z.number().optional(),
  radioSize: z.number().optional(),
  radioStrokeWidth: z.number().optional(),
  indicatorGap: z.number().optional(),
  itemInset: z.number().optional(),
  selectedColor: z.string().optional(),
  unselectedColor: z.string().optional(),
  labelColor: z.string().optional(),
  selectedLabelColor: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  gradientEnabled: z.boolean().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "center-outward", "outside-inward"]).optional(),
  styleMode: z.enum(["radio", "segmented", "card"]).optional(),
  badTextColor: z.string().optional(),
  badBackgroundColor: z.string().optional(),
  disabledColor: z.string().optional(),
  disabledTextColor: z.string().optional(),
  transparentBackground: z.boolean().optional(),
});

const numericInputObjectSchema = hmiBaseSchema.extend({
  type: z.literal("numeric-input"),
  tag: z.string().optional(),
  writeTag: z.string().optional(),
  errorTag: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  decimals: z.number().optional(),
  formatMode: z.enum(["decimals", "pattern"]).optional(),
  formatPattern: z.string().optional(),
  unit: z.string().optional(),
  showUnit: z.boolean().optional(),
  placeholder: z.string().optional(),
  textColor: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  showMeta: z.boolean().optional(),
  stepButtonUseTextColor: z.boolean().optional(),
  stepButtonTextColor: z.string().optional(),
  stepButtonBackgroundColor: z.string().optional(),
  badTextColor: z.string().optional(),
  badBackgroundColor: z.string().optional(),
  badBorderColor: z.string().optional(),
  dialogTitle: z.string().optional(),
  dialogWidth: z.number().optional(),
  dialogHeight: z.number().optional(),
  dialogPlacement: z.enum(["custom", "top", "right", "bottom", "left"]).optional(),
  dialogOffset: z.number().optional(),
  dialogX: z.number().optional(),
  dialogY: z.number().optional(),
  dialogBackgroundColor: z.string().optional(),
  dialogTextColor: z.string().optional(),
  dialogBorderColor: z.string().optional(),
  dialogCloseButtonTextColor: z.string().optional(),
  dialogCloseButtonBackgroundColor: z.string().optional(),
  dialogSetButtonTextColor: z.string().optional(),
  dialogSetButtonBackgroundColor: z.string().optional(),
  dialogSetButtonBorderColor: z.string().optional(),
});

const numericImageIndicatorObjectSchema = hmiBaseSchema.extend({
  type: z.literal("numeric-image-indicator"),
  tag: z.string().optional(),
  states: z
    .array(
      z.object({
        index: z.number().int().min(0),
        assetId: z.string().optional(),
      }),
    )
    .max(100),
  defaultAssetId: z.string().optional(),
  badQualityAssetId: z.string().optional(),
  fit: z.enum(["contain", "cover", "stretch", "none"]),
  preserveAspectRatio: z.boolean().optional(),
  outOfRangeMode: z.enum(["default", "clamp"]).optional(),
});

const trendChartSeriesSchema = z.object({
  tag: z.string().min(1),
  color: z.string().optional(),
  displayName: z.string().optional(),
  unit: z.string().optional(),
  visible: z.boolean().optional(),
  lineWidth: z.number().optional(),
  lineType: z.enum(["solid", "dashed", "dotted"]).optional(),
  mode: z.enum(["line", "step", "points"]).optional(),
  step: z.boolean().optional(),
  axisMode: z.enum(["auto", "manual"]).optional(),
  axisId: z.string().optional(),
});

const trendChartAxisSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  unit: z.string().optional(),
  position: z.enum(["left", "right"]),
  offset: z.number().optional(),
  min: z.union([z.number(), z.literal("auto")]).optional(),
  max: z.union([z.number(), z.literal("auto")]).optional(),
  color: z.string().optional(),
  axisPointerLabelBackgroundColor: z.string().optional(),
  verticalLabelOffsetX: z.number().optional(),
  axisTitleMode: z.preprocess(
    (value) => (value === "topBadge" || value === "tooltipOnly" ? "hidden" : value),
    z.enum(["hidden", "compactLabel", "verticalLabel"]).optional(),
  ),
});

const trendChartSettingsSchema = z.object({
  renderer: z.enum(["echarts", "uplot"]).optional(),
  theme: z.enum(["workbench-dark", "echarts-dark", "custom"]).optional(),
  background: z.string().optional(),
  gridLines: z.boolean().optional(),
  axisLabels: z.boolean().optional(),
  legend: z.boolean().optional(),
  tooltip: z.boolean().optional(),
  dataZoomSlider: z.boolean().optional(),
  defaultLineWidth: z.number().optional(),
  showSymbols: z.boolean().optional(),
  showUnitsInTooltip: z.boolean().optional(),
  showBadQualityGaps: z.boolean().optional(),
  maxVisiblePointsPerSeries: z.number().optional(),
  maxLivePointsPerTag: z.number().optional(),
  maxCachedRanges: z.number().optional(),
  maxPointsPerSeries: z.number().optional(),
  aggregation: z.enum(["auto", "raw", "minmax", "avg", "lttb"]).optional(),
  zoomDebounceMs: z.number().optional(),
  refreshIntervalMs: z.number().optional(),
  progressive: z.boolean().optional(),
  disableAnimationsLargeData: z.boolean().optional(),
  cacheEnabled: z.boolean().optional(),
  cacheSize: z.number().optional(),
  liveBufferLimit: z.number().optional(),
  liveDataSource: z.enum(["archivePolling", "realtimeAppend"]).optional(),
  liveResyncEnabled: z.boolean().optional(),
  liveResyncIntervalSec: z.number().optional(),
  realtimeAppendSnapshotAggregation: z.enum(["auto", "raw", "minmax"]).optional(),
  realtimeAppendSnapshotMaxPoints: z.number().optional(),
  realtimeAppendFlushMs: z.number().optional(),
  autoScale: z.boolean().optional(),
  defaultAxisMin: z.union([z.number(), z.literal("auto")]).optional(),
  defaultAxisMax: z.union([z.number(), z.literal("auto")]).optional(),
  groupByUnit: z.boolean().optional(),
  separateAxisPerTag: z.boolean().optional(),
  axisPlacement: z.enum(["left", "right", "split"]).optional(),
  axisOffsetStep: z.number().optional(),
  axisScaleGap: z.number().optional(),
  showSeriesTable: z.boolean().optional(),
  seriesTableRows: z.number().optional(),
  table: z.object({
    background: z.string().optional(),
    headerBackground: z.string().optional(),
    textColor: z.string().optional(),
    mutedTextColor: z.string().optional(),
    borderColor: z.string().optional(),
    hoverBackground: z.string().optional(),
    valueTextColor: z.string().optional(),
    rowHeight: z.number().optional(),
    headerHeight: z.number().optional(),
    fontSize: z.number().optional(),
    cellPaddingX: z.number().optional(),
    cellPaddingY: z.number().optional(),
  }).optional(),
  showToolbarScaleButton: z.boolean().optional(),
});

const trendChartObjectSchema = hmiBaseSchema.extend({
  type: z.literal("trendChart"),
  selectedTags: z.array(trendChartSeriesSchema),
  axes: z.array(trendChartAxisSchema).optional(),
  settings: trendChartSettingsSchema.optional(),
  rangePreset: z.enum(["5m", "15m", "1h", "8h", "24h", "custom"]).optional(),
  customFrom: z.number().optional(),
  customTo: z.number().optional(),
  liveMode: z.boolean().optional(),
  showToolbar: z.boolean().optional(),
  showStatusBar: z.boolean().optional(),
});

const eventTableObjectSchema = hmiBaseSchema.extend({
  type: z.literal("eventTable"),
  title: z.string().optional(),
  showTitle: z.boolean().optional(),
  titlePosition: z.enum(["top", "bottom", "hidden"]).optional(),
  titleAlign: z.enum(["left", "center", "right"]).optional(),
  titleFontSize: z.number().optional(),
  titleHeight: z.number().optional(),
  titleTextColor: z.string().optional(),
  titleBackgroundColor: z.string().optional(),
  mode: z.enum(["online", "history"]).optional(),
  enableHistoryMode: z.boolean().optional(),
  historyPeriodPreset: z.enum(["lastHour", "shift", "day", "week", "custom"]).optional(),
  historyFrom: z.number().optional(),
  historyTo: z.number().optional(),
  enableCsvExport: z.boolean().optional(),
  showHistoryToolbar: z.boolean().optional(),
  pageSize: z.number().int().positive().optional(),
  serverSidePagination: z.boolean().optional(),
  showHeader: z.boolean().optional(),
  showToolbar: z.boolean().optional(),
  toolbarPosition: z.enum(["top", "bottom", "hidden"]).optional(),
  showSearch: z.boolean().optional(),
  showActiveOnlyToggle: z.boolean().optional(),
  showUnackedOnlyToggle: z.boolean().optional(),
  showOperatorActions: z.boolean().optional(),
  showOperatorActionsToggle: z.boolean().optional(),
  showAckVisibleButton: z.boolean().optional(),
  showSilenceButton: z.boolean().optional(),
  showSoundMuteButton: z.boolean().optional(),
  showEnableSoundsButton: z.boolean().optional(),
  showSettingsButton: z.boolean().optional(),
  settingsRequiredRole: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  showCsvExportButton: z.boolean().optional(),
  showStatusBar: z.boolean().optional(),
  statusPosition: z.enum(["top", "bottom", "hidden"]).optional(),
  statusStyle: z.enum(["archiveLike", "compact", "hidden"]).optional(),
  statusSingleLine: z.boolean().optional(),
  showLastUpdate: z.boolean().optional(),
  showRecordCount: z.boolean().optional(),
  showDatabaseStatus: z.boolean().optional(),
  showModeIndicator: z.boolean().optional(),
  showActiveOnly: z.boolean().optional(),
  showUnacknowledgedOnly: z.boolean().optional(),
  showCleared: z.boolean().optional(),
  maxRows: z.number().int().positive().optional(),
  categoryFilter: z.array(z.string()).optional(),
  priorityFilter: z.array(z.number()).optional(),
  sourceTagFilter: z.string().optional(),
  searchText: z.string().optional(),
  sortBy: z.enum(["time", "priority", "category", "message", "sourceTagName"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  columns: z.array(z.string()).optional(),
  columnLabels: z.record(z.string()).optional(),
  columnWidths: z.record(z.number()).optional(),
  columnAlignments: z.record(z.enum(["left", "center", "right"])).optional(),
  fontSize: z.number().optional(),
  rowHeight: z.number().optional(),
  headerHeight: z.number().optional(),
  cellPadding: z.number().optional(),
  cellTextAlign: z.enum(["left", "center", "right"]).optional(),
  borderRadius: z.number().optional(),
  borderWidth: z.number().optional(),
  textColor: z.string().optional(),
  mutedTextColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  transparentBackground: z.boolean().optional(),
  headerBackgroundColor: z.string().optional(),
  headerTextColor: z.string().optional(),
  borderColor: z.string().optional(),
  gridLineColor: z.string().optional(),
  selectedRowColor: z.string().optional(),
  activeAlarmColor: z.string().optional(),
  warningColor: z.string().optional(),
  criticalColor: z.string().optional(),
  acknowledgedColor: z.string().optional(),
  clearedColor: z.string().optional(),
  showGridLines: z.boolean().optional(),
  zebraRows: z.boolean().optional(),
  compactMode: z.boolean().optional(),
  soundPlaybackMode: z.enum(["once", "loopUntilAcknowledged"]).optional(),
  soundMuteMode: z.enum(["silenceCurrent", "disableUntilEnabled"]).optional(),
  soundRepeatIntervalMs: z.number().int().positive().optional(),
  stopSoundOnAck: z.boolean().optional(),
  stopSoundOnSilence: z.boolean().optional(),
  enableSoundFallbackByPriority: z.boolean().optional(),
  fallbackNotificationSoundId: z.string().optional(),
  fallbackWarningSoundId: z.string().optional(),
  fallbackAlarmSoundId: z.string().optional(),
  enableAckButton: z.boolean().optional(),
  enableAckSelectedButton: z.boolean().optional(),
  enableSilenceButton: z.boolean().optional(),
  enableSoundsButton: z.boolean().optional(),
  enableSearchInToolbar: z.boolean().optional(),
  enableActiveOnlyToggle: z.boolean().optional(),
  enableUnackedOnlyToggle: z.boolean().optional(),
  enableCsvExportButton: z.boolean().optional(),
});

export const hmiObjectSchema: z.ZodType<HmiObject> = z.lazy(() =>
  z.discriminatedUnion("type", [
    groupObjectSchema,
    textObjectSchema,
    lineObjectSchema,
    compoundShapeObjectSchema,
    rectangleObjectSchema,
    valueDisplayObjectSchema,
    valueInputObjectSchema,
    stateIndicatorObjectSchema,
    buttonObjectSchema,
    switchObjectSchema,
    imageObjectSchema,
    stateImageObjectSchema,
    valueSelectObjectSchema,
    libraryElementInstanceSchema,
    valveObjectSchema,
    pumpObjectSchema,
    frameObjectSchema,
    checkboxObjectSchema,
    sliderObjectSchema,
    progressBarObjectSchema,
    selectObjectSchema,
    radioGroupObjectSchema,
    numericInputObjectSchema,
    numericImageIndicatorObjectSchema,
    trendChartObjectSchema,
    eventTableObjectSchema,
  ]) as z.ZodType<HmiObject>,
);

const groupObjectSchema = hmiBaseSchema.extend({
  type: z.literal("group"),
  objects: z.array(hmiObjectSchema),
});

export const libraryParameterSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  type: z.enum(["string", "number", "boolean", "color", "tag", "tagPrefix", "index"]),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

const elementStateActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setVisible"),
    objectId: z.string().min(1),
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal("setAsset"),
    objectId: z.string().min(1),
    assetId: z.string().min(1),
  }),
  z.object({
    type: z.literal("setText"),
    objectId: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    type: z.literal("setFill"),
    objectId: z.string().min(1),
    color: z.string().min(1),
  }),
  z.object({
    type: z.literal("setStroke"),
    objectId: z.string().min(1),
    color: z.string().min(1),
  }),
  z.object({
    type: z.literal("setProperty"),
    objectId: z.string().min(1),
    property: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
]);

const elementStateCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  condition: z.discriminatedUnion("type", [
    z.object({ type: z.literal("equals"), value: z.unknown() }),
    z.object({ type: z.literal("notEquals"), value: z.unknown() }),
    z.object({ type: z.literal("greaterThan"), value: z.number() }),
    z.object({ type: z.literal("lessThan"), value: z.number() }),
    z.object({ type: z.literal("between"), min: z.number(), max: z.number() }),
    z.object({ type: z.literal("true") }),
    z.object({ type: z.literal("false") }),
  ]),
  actions: z.array(elementStateActionSchema),
});

const elementStateRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("tag"), value: z.string().min(1) }),
    z.object({ type: z.literal("parameter"), value: z.string().min(1) }),
    z.object({ type: z.literal("expression"), value: z.string().min(1) }),
  ]),
  cases: z.array(elementStateCaseSchema),
});

const elementBindingDefinitionSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(["tag", "writeTag", "state", "command", "custom"]),
  dataType: z.enum(["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"]).optional(),
  required: z.boolean().optional(),
  defaultBaseTag: z.string().optional(),
  overridable: z.boolean().optional(),
});

export const libraryElementSchema = z.object({
  id: z.string().min(1),
  libraryId: z.string().min(1).optional(),
  elementKey: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  previewAssetId: z.string().optional(),
  objects: z.array(hmiObjectSchema),
  bindings: z.array(elementBindingDefinitionSchema).optional(),
  parameters: z.array(libraryParameterSchema).optional(),
  stateRules: z.array(elementStateRuleSchema).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const elementLibrarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  assets: z.array(assetSchema),
  elements: z.array(libraryElementSchema),
  macros: z.array(z.lazy(() => macroSchema)).optional(),
});

export const libraryArchiveManifestSchema = z.object({
  format: z.literal("mywebscada-library"),
  formatVersion: z.number().int().positive(),
  exportedAt: z.string().min(1),
  appName: z.string().optional(),
  appVersion: z.string().optional(),
  libraryId: z.string().min(1),
  libraryName: z.string().min(1),
  libraryVersion: z.string().min(1),
  counts: z.object({
    elements: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    macros: z.number().int().nonnegative(),
  }),
  files: z.array(
    z.object({
      path: z.string().min(1),
      type: z.enum(["library", "asset", "preview", "macro", "metadata"]),
      size: z.number().int().nonnegative(),
      sha256: z.string().min(1).optional(),
    }),
  ),
});

export const libraryImportIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().min(1).optional(),
});

export const libraryImportValidationResultSchema = z.object({
  valid: z.boolean(),
  summary: z
    .object({
      libraryId: z.string().min(1),
      name: z.string().min(1),
      version: z.string().min(1),
      elements: z.number().int().nonnegative(),
      assets: z.number().int().nonnegative(),
      macros: z.number().int().nonnegative(),
    })
    .optional(),
  conflicts: z.object({
    libraryExists: z.boolean(),
    elementConflicts: z.array(z.string().min(1)),
    assetConflicts: z.array(z.string().min(1)),
    projectMacroConflicts: z.array(z.string().min(1)),
  }),
  warnings: z.array(libraryImportIssueSchema),
  errors: z.array(libraryImportIssueSchema),
});

const modbusAddressSchema = z.object({
  registerType: z.enum(["coil", "discrete-input", "holding-register", "input-register"]),
  address: z.number().int().nonnegative(),
  dataType: z.enum(["BOOL", "INT16", "UINT16", "INT32", "UINT32", "FLOAT32"]),
  byteOrder: z.enum(["ABCD", "BADC", "CDAB", "DCBA"]).optional(),
});

const opcuaAddressSchema = z.object({
  nodeId: z.string().min(1),
});

const simulatedAddressSchema = z.object({
  pattern: z.enum(["toggle", "sine", "random", "static"]).optional(),
  amplitude: z.number().optional(),
  periodMs: z.number().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  value: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
});

const tagSimulationSchema = z.object({
  enabled: z.boolean().optional(),
  profile: z.enum(["constant", "ramp", "random", "sin", "rampNoise", "sinNoise", "toggle", "randomBool"]).optional(),
  updateIntervalMs: z.number().positive().optional(),
  initialValue: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  ramp: z.object({
    step: z.number().positive().optional(),
    direction: z.enum(["up", "down", "pingPong"]).optional(),
    resetOnLimit: z.boolean().optional(),
  }).optional(),
  random: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
  sin: z.object({
    amplitude: z.number().optional(),
    offset: z.number().optional(),
    periodMs: z.number().positive().optional(),
    phaseDeg: z.number().optional(),
  }).optional(),
  noise: z.object({
    amplitude: z.number().nonnegative().optional(),
    type: z.enum(["uniform", "normal"]).optional(),
  }).optional(),
  toggle: z.object({
    trueMs: z.number().positive().optional(),
    falseMs: z.number().positive().optional(),
  }).optional(),
  randomBool: z.object({
    trueProbability: z.number().min(0).max(1).optional(),
  }).optional(),
  variationMode: z.enum(["same", "perTagSeed", "perTagPhase", "perTagOffset", "perTagNoise"]).optional(),
  // Legacy fields kept for backward compatibility with older project files.
  mode: z.enum(["manual", "random", "range", "ramp", "toggle", "sine"]).optional(),
  intervalMs: z.number().positive().optional(),
  step: z.number().nonnegative().optional(),
});

const tagDataTypeSchema = z.enum(["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"]);

export const tagSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  sourceType: z.enum(["opcua", "modbus", "lw", "internal", "computed", "simulated"]).optional(),
  dataType: tagDataTypeSchema,
  driverId: z.string().optional(),
  nodeId: z.string().optional(),
  area: z.enum(["coil", "discreteInput", "holdingRegister", "inputRegister"]).optional(),
  functionCode: z.string().optional(),
  unitId: z.number().int().nonnegative().optional(),
  bit: z.number().int().nonnegative().optional(),
  wordOrder: z.enum(["ABCD", "CDAB", "BADC", "DCBA"]).optional(),
  byteOrder: z.enum(["AB", "BA"]).optional(),
  lwAddress: z.number().int().nonnegative().optional(),
  internalVariableName: z.string().optional(),
  address: z.union([modbusAddressSchema, opcuaAddressSchema, simulatedAddressSchema, z.record(z.unknown())]).optional(),
  writable: z.boolean().optional(),
  persistent: z.boolean().optional(),
  scanRateMs: z.number().int().positive().optional(),
  scale: z.number().optional(),
  offset: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  simulation: tagSimulationSchema.optional(),
  group: z.string().optional(),
  unit: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const variableSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  dataType: z.enum(["BOOL", "INT", "DINT", "REAL", "STRING"]),
  initialValue: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
  currentValue: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
  persistent: z.boolean().optional(),
  lwAddress: z.number().int().nonnegative().optional(),
  writable: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const eventDefinitionSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
  message: z.string().optional(),
  priority: z.number().optional(),
  sourceTagName: z.string().optional(),
  conditionMode: z.enum(["bit", "word"]).optional(),
  bitTrigger: z.enum(["ON", "OFF", "OFF_TO_ON", "ON_TO_OFF"]).optional(),
  wordOperator: z.enum(["<", ">", "=", "<>", ">=", "<="]).optional(),
  wordValue: z.number().optional(),
  startupDelayMs: z.number().int().nonnegative().optional(),
  requireAck: z.boolean().optional(),
  ackValue: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
  ackTagName: z.string().optional(),
  notificationTagName: z.string().optional(),
  elapsedTimeTagName: z.string().optional(),
  soundEnabled: z.boolean().optional(),
  soundId: z.string().optional(),
  textColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  backgroundBlinkEnabled: z.boolean().optional(),
  backgroundBlinkDurationMs: z.number().int().positive().optional(),
  backgroundBlinkOpacity: z.number().min(0).max(1).optional(),
  securityEnabled: z.boolean().optional(),
  securityTagName: z.string().optional(),
  securityBitValue: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  onActiveActions: z.array(runtimeActionSchema).optional(),
  onClearedActions: z.array(runtimeActionSchema).optional(),
  onAckActions: z.array(runtimeActionSchema).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const eventCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const eventSoundSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["notification", "warning", "alarm", "custom"]).optional(),
  fileName: z.string().optional(),
  assetId: z.string().optional(),
  url: z.string().optional(),
  filePath: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
  volume: z.number().optional(),
  loop: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const eventArchiveSettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int().positive(),
  maxDatabaseSizeMb: z.number().int().positive(),
  cleanupMode: z.enum(["byAge", "bySize", "byAgeAndSize"]),
  cleanupIntervalMinutes: z.number().int().positive(),
  optimizeAfterCleanup: z.boolean(),
  deleteBatchSize: z.number().int().positive().optional(),
  maintenanceIntervalMs: z.number().int().positive().optional(),
  maxMaintenanceTickMs: z.number().int().positive().optional(),
  maxDeleteTransactionMs: z.number().int().positive().optional(),
  updatedAt: z.string().optional(),
});

const operatorActionArchiveSettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int().positive(),
  maxDatabaseSizeMb: z.number().int().positive(),
  cleanupMode: z.enum(["byAge", "bySize", "byAgeAndSize"]),
  cleanupIntervalMinutes: z.number().int().positive(),
  optimizeAfterCleanup: z.boolean(),
  deleteBatchSize: z.number().int().positive().optional(),
  maintenanceIntervalMs: z.number().int().positive().optional(),
  maxMaintenanceTickMs: z.number().int().positive().optional(),
  maxDeleteTransactionMs: z.number().int().positive().optional(),
  updatedAt: z.string().optional(),
});

const projectOperatorActionSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultValueChangeTemplate: z.string().optional(),
  defaultButtonTemplate: z.string().optional(),
  defaultCheckboxTemplate: z.string().optional(),
  defaultSliderTemplate: z.string().optional(),
  defaultNumericInputTemplate: z.string().optional(),
  archiveSettings: operatorActionArchiveSettingsSchema.optional(),
});

export const macroSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  language: z.literal("javascript-lite"),
  code: z.string().min(1),
  enabled: z.boolean().optional(),
  validation: z.object({
    status: z.enum(["ok", "error"]),
    errors: z.array(z.string().min(1)).optional(),
    updatedAt: z.string().optional(),
  }).optional(),
  triggers: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("onScreenOpen"), screenKey: z.string().min(1) }),
        z.object({ type: z.literal("onScreenClose"), screenKey: z.string().min(1) }),
        z.object({
          type: z.literal("onButtonClick"),
          objectId: z.string().min(1),
          screenKey: z.string().optional(),
        }),
        z.object({ type: z.literal("onTagChange"), tag: z.string().min(1) }),
        z.object({ type: z.literal("onCondition"), condition: z.string().min(1) }),
        z.object({ type: z.literal("interval"), intervalMs: z.number().int().positive() }),
      ]),
    )
    .optional(),
});

const simulatedDriverSchema = z.object({
  id: z.string().min(1),
  type: z.literal("simulated"),
  enabled: z.boolean(),
  name: z.string().optional(),
  updateIntervalMs: z.number().int().positive().optional(),
  schedulerTickMs: z.number().int().positive().optional(),
  globalSeed: z.number().int().optional(),
  defaultVariationMode: z.enum(["same", "perTagSeed", "perTagPhase", "perTagOffset", "perTagNoise"]).optional(),
  // Legacy fields kept for backward compatibility with older project files.
  defaultMode: z.enum(["manual", "random", "ramp"]).optional(),
  defaultMin: z.number().optional(),
  defaultMax: z.number().optional(),
  defaultStep: z.number().optional(),
});

const opcuaDriverSchema = z.object({
  id: z.string().min(1),
  type: z.literal("opcua"),
  enabled: z.boolean(),
  name: z.string().optional(),
  endpointUrl: z.string().min(1),
  securityPolicy: z.enum(["None", "Basic256Sha256"]).optional(),
  securityMode: z.enum(["None", "Sign", "SignAndEncrypt"]).optional(),
  readMode: z.enum(["polling", "subscription"]).optional(),
  publishingIntervalMs: z.number().int().positive().optional(),
  samplingIntervalMs: z.number().int().positive().optional(),
  queueSize: z.number().int().positive().optional(),
  discardOldest: z.boolean().optional(),
  subscriptionBatchSize: z.number().int().positive().optional(),
  connectTimeoutMs: z.number().int().positive().optional(),
  operationTimeoutMs: z.number().int().positive().optional(),
  sessionTimeoutMs: z.number().int().positive().optional(),
  keepAliveIntervalMs: z.number().int().positive().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  reconnectMs: z.number().int().positive().optional(),
});

const popupOptionsSchema = z.object({
  title: z.string().optional(),
  defaultX: z.number().optional(),
  defaultY: z.number().optional(),
  modal: z.boolean().optional(),
  draggable: z.boolean().optional(),
  closable: z.boolean().optional(),
  resizable: z.boolean().optional(),
  titleTextStyle: textStyleSchema.optional(),
});

export const hmiScreenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["screen", "popup", "template"]),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string().optional(),
  backgroundFillMode: z.enum(["screen", "viewport"]).optional(),
  objects: z.array(hmiObjectSchema),
  popupOptions: popupOptionsSchema.optional(),
});

const projectInfoSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  customer: z.string().optional(),
  site: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

const projectUiSettingsSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  hideMainMenu: z.boolean().optional(),
  editorWheelZoomEnabled: z.boolean().optional(),
  windowTitle: z.string().optional(),
});

const projectRuntimeSettingsSchema = z.object({
  alwaysActiveTags: z.array(z.string().min(1)).max(10000).optional(),
  allowGuestRuntimeActions: z.boolean().optional(),
});

export const projectSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  projectInfo: projectInfoSchema.optional(),
  uiSettings: projectUiSettingsSchema.optional(),
  runtimeSettings: projectRuntimeSettingsSchema.optional(),
  assets: z.array(assetSchema).optional(),
  assetGroups: z.array(assetGroupSchema).optional(),
  libraries: z.array(projectLibraryRefSchema).optional(),
  drivers: z.array(z.discriminatedUnion("type", [simulatedDriverSchema, opcuaDriverSchema])),
  tags: z.array(tagSchema),
  events: z.array(eventDefinitionSchema).optional(),
  eventCategories: z.array(eventCategorySchema).optional(),
  eventSounds: z.array(eventSoundSchema).optional(),
  eventArchiveSettings: eventArchiveSettingsSchema.optional(),
  operatorActionSettings: projectOperatorActionSettingsSchema.optional(),
  variables: z.array(variableSchema).optional(),
  lwStore: z
    .object({
      mode: z.enum(["volatile", "persistent"]).optional(),
      values: z.record(z.coerce.number()).optional(),
    })
    .optional(),
  macros: z.array(macroSchema).optional(),
  editorSettings: z
    .object({
      layout: z
        .object({
          leftPanel: z.object({
            visible: z.boolean(),
            collapsed: z.boolean(),
            width: z.number().positive(),
            minWidth: z.number().positive(),
            maxWidth: z.number().positive(),
            collapsedWidth: z.number().positive(),
          }),
          rightPanel: z.object({
            visible: z.boolean(),
            collapsed: z.boolean(),
            width: z.number().positive(),
            minWidth: z.number().positive(),
            maxWidth: z.number().positive(),
            collapsedWidth: z.number().positive(),
          }),
          topArea: z.object({
            collapsed: z.boolean(),
            compact: z.boolean(),
            height: z.number().positive().optional(),
          }),
          canvasToolbar: z.object({
            collapsed: z.boolean(),
            compact: z.boolean(),
          }),
          panels: z.object({
            screensCollapsed: z.boolean(),
            currentScreenCollapsed: z.boolean(),
            toolboxCollapsed: z.boolean(),
            propertiesCollapsed: z.boolean(),
            objectTreeCollapsed: z.boolean(),
          }),
        })
        .optional(),
      dockLayout: z
        .object({
          panels: z.record(
            z.object({
              id: z.string().min(1),
              side: z.enum(["left", "right", "top", "bottom"]),
              hidden: z.boolean(),
              size: z.number().nonnegative(),
              lastVisibleSize: z.number().nonnegative(),
              detached: z.boolean().optional(),
              x: z.number().optional(),
              y: z.number().optional(),
              width: z.number().positive().optional(),
              height: z.number().positive().optional(),
            }),
          ),
        })
        .optional(),
      leftPanelWidth: z.number().positive().optional(),
      rightPanelWidth: z.number().positive().optional(),
      showObjectFrames: z.boolean().optional(),
      keyboardNudgeStepPx: z.number().positive().optional(),
      showEditorGrid: z.boolean().optional(),
      editorGridColor: z.string().optional(),
      editorGridOpacity: z.number().min(0).max(1).optional(),
      editorGridLineWidth: z.number().positive().optional(),
      editorGridLineStyle: z.enum(["solid", "dashed", "dotted", "dashDot"]).optional(),
      panels: z
        .array(
          z.object({
            id: z.enum([
              "screens",
              "assets",
              "libraries",
              "toolbox",
              "properties",
              "tags",
              "macros",
              "drivers",
              "objectTree",
              "layers",
              "projectSettings",
            ]),
            title: z.string().min(1),
            visible: z.boolean(),
            collapsed: z.boolean(),
            dock: z.enum(["left", "right", "bottom", "floating"]),
            x: z.number().optional(),
            y: z.number().optional(),
            width: z.number().positive(),
            height: z.number().positive(),
            minWidth: z.number().positive().optional(),
            minHeight: z.number().positive().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  screens: z.array(hmiScreenSchema).min(1),
  startScreenId: z.string().optional(),
});

export const writeTagMessageSchema = z.object({
  type: z.literal("write-tag"),
  payload: z.object({
    name: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
    commandMeta: z
      .object({
        commandId: z.string().min(1),
        commandKey: z.string().min(1),
        createdAt: z.number().int(),
        ttlMs: z.number().int().positive(),
      })
      .optional(),
  }),
});

export const subscribeTagsMessageSchema = z.object({
  type: z.literal("subscribe-tags"),
  payload: z.object({
    tags: z.array(z.string().min(1)).max(10000),
  }),
});

export const runtimeWsClientMessageSchema = z.union([writeTagMessageSchema, subscribeTagsMessageSchema]);

export type ProjectSchema = z.infer<typeof projectSchema>;
