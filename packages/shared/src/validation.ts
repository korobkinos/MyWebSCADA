import { z } from "zod";

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
  locked: z.boolean().optional(),
  minWidth: z.number().positive().optional(),
  minHeight: z.number().positive().optional(),
  bindings: hmiBindingsSchema,
});

type AnyObject = Record<string, unknown>;

const assetTypeSchema = z.enum(["png", "jpg", "jpeg", "svg"]);

export const assetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
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
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  }),
]);

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
  text: z.string(),
  textStyle: textStyleSchema,
  action: runtimeActionSchema,
});

const switchObjectSchema = hmiBaseSchema.merge(textLayoutSchema).extend({
  type: z.literal("switch"),
  tag: z.string().min(1),
  onText: z.string().optional(),
  offText: z.string().optional(),
  textStyle: textStyleSchema,
});

const imageObjectSchema = hmiBaseSchema.extend({
  type: z.literal("image"),
  assetId: z.string().optional(),
  src: z.string().optional(),
  fit: z.enum(["contain", "cover", "stretch", "none"]),
  preserveAspectRatio: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
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

const libraryElementInstanceSchema = hmiBaseSchema.extend({
  type: z.literal("libraryElementInstance"),
  libraryId: z.string().min(1),
  elementId: z.string().min(1),
  tagPrefix: z.string().optional(),
  parameterValues: z.record(z.unknown()).optional(),
  scaleMode: z.enum(["none", "fit", "stretch"]).optional(),
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

export const hmiObjectSchema: z.ZodType<AnyObject> = z.lazy(() =>
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
    libraryElementInstanceSchema,
    valveObjectSchema,
    pumpObjectSchema,
    frameObjectSchema,
  ]) as z.ZodType<AnyObject>,
);

const groupObjectSchema = hmiBaseSchema.extend({
  type: z.literal("group"),
  objects: z.array(hmiObjectSchema),
});

export const libraryParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "color", "tag"]),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
});

export const libraryElementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  previewAssetId: z.string().optional(),
  objects: z.array(hmiObjectSchema),
  parameters: z.array(libraryParameterSchema).optional(),
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
});

const tagDataTypeSchema = z.enum(["BOOL", "INT", "DINT", "REAL", "STRING"]);

const tagSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  dataType: tagDataTypeSchema,
  driverId: z.string().optional(),
  address: z.union([modbusAddressSchema, opcuaAddressSchema, simulatedAddressSchema, z.record(z.unknown())]).optional(),
  writable: z.boolean().optional(),
  scanRateMs: z.number().int().positive().optional(),
  scale: z.number().optional(),
  offset: z.number().optional(),
  unit: z.string().optional(),
});

const variableSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  dataType: tagDataTypeSchema,
  initialValue: z.union([z.boolean(), z.number(), z.string(), z.null()]).optional(),
  writable: z.boolean().optional(),
});

const macroSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  language: z.literal("ts"),
  code: z.string().min(1),
});

const simulatedDriverSchema = z.object({
  id: z.string().min(1),
  type: z.literal("simulated"),
  enabled: z.boolean(),
  name: z.string().optional(),
});

const modbusDriverSchema = z.object({
  id: z.string().min(1),
  type: z.literal("modbus-tcp"),
  enabled: z.boolean(),
  name: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  unitId: z.number().int().nonnegative(),
  timeoutMs: z.number().int().positive().optional(),
  reconnectMs: z.number().int().positive().optional(),
});

const opcuaDriverSchema = z.object({
  id: z.string().min(1),
  type: z.literal("opcua"),
  enabled: z.boolean(),
  name: z.string().optional(),
  endpointUrl: z.string().min(1),
  securityPolicy: z.enum(["None", "Basic256Sha256"]).optional(),
  securityMode: z.enum(["None", "Sign", "SignAndEncrypt"]).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
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
  objects: z.array(hmiObjectSchema),
  popupOptions: popupOptionsSchema.optional(),
});

export const projectSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  assets: z.array(assetSchema).optional(),
  libraries: z.array(projectLibraryRefSchema).optional(),
  drivers: z.array(z.discriminatedUnion("type", [simulatedDriverSchema, modbusDriverSchema, opcuaDriverSchema])),
  tags: z.array(tagSchema),
  variables: z.array(variableSchema).optional(),
  macros: z.array(macroSchema).optional(),
  screens: z.array(screenSchema).min(1),
  startScreenId: z.string().optional(),
});

export const writeTagMessageSchema = z.object({
  type: z.literal("write-tag"),
  payload: z.object({
    name: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
  }),
});

export type ProjectSchema = z.infer<typeof projectSchema>;
