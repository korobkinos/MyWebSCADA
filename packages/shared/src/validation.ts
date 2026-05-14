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

const hmiBaseSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().optional(),
  visible: z.boolean().optional(),
  visibleForRoles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])).optional(),
  requiredVisibleRole: z.number().int().min(0).max(4).optional(),
  requiredActionRole: z.number().int().min(0).max(4).optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
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
  requiredRoleLevel: z.number().int().min(0).max(4).optional(),
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
  textStyle: textStyleSchema,
});

const lineObjectSchema = hmiBaseSchema.extend({
  type: z.literal("line"),
  points: z.array(z.number()).min(4),
  stroke: z.string(),
  strokeWidth: z.number().positive(),
  closed: z.boolean().optional(),
  fill: z.string().optional(),
});

const rectangleObjectSchema = hmiBaseSchema.extend({
  type: z.literal("rectangle"),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
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
});

const numericInputObjectSchema = hmiBaseSchema.extend({
  type: z.literal("numeric-input"),
  tag: z.string().optional(),
  writeTag: z.string().optional(),
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
});

export const hmiObjectSchema: z.ZodType<HmiObject> = z.lazy(() =>
  z.discriminatedUnion("type", [
    groupObjectSchema,
    textObjectSchema,
    lineObjectSchema,
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
  mode: z.enum(["manual", "random", "range", "ramp", "toggle", "sine"]).optional(),
  intervalMs: z.number().positive().optional(),
  initialValue: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().nonnegative().optional(),
});

const tagDataTypeSchema = z.enum(["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"]);

const tagSchema = z.object({
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

const variableSchema = z.object({
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

const macroSchema = z.object({
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

const screenSchema = z.object({
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
  screens: z.array(screenSchema).min(1),
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
