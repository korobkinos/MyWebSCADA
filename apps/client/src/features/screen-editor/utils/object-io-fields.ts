import type {
  CheckboxWriteMode,
  HmiObject,
  RuntimeAction,
} from "@web-scada/shared";

export type ObjectIoFieldDirection = "read" | "write" | "status" | "action";
export type ObjectIoFieldDataType = "BOOL" | "REAL" | "INT" | "STRING" | "ANY";
export type ObjectIoFieldControl = "tag" | "select" | "number" | "boolean" | "text";
export type ObjectIoActionMode =
  | "none"
  | "write"
  | "pulse"
  | "toggle"
  | "writeConstTag"
  | "writeNumberPromptTag"
  | "unsupported";

export type ObjectIoFieldDefinition = {
  fieldPath: string;
  label: string;
  direction: ObjectIoFieldDirection;
  dataTypeHint?: ObjectIoFieldDataType;
  description?: string;
  control?: ObjectIoFieldControl;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
  visibleWhen?: {
    fieldPath: string;
    values: string[];
  };
};

const CHECKBOX_WRITE_MODE_OPTIONS: Array<{ label: string; value: CheckboxWriteMode }> = [
  { label: "Toggle State", value: "toggleState" },
  { label: "Write True", value: "writeTrue" },
  { label: "Write False", value: "writeFalse" },
  { label: "Pulse True", value: "pulseTrue" },
  { label: "Pulse False", value: "pulseFalse" },
];
const ROTATION_ANIMATION_IO_SUPPORTED_TYPES = new Set<HmiObject["type"]>([
  "group",
  "text",
  "line",
  "rectangle",
  "image",
  "stateImage",
  "numeric-image-indicator",
  "value-display",
  "state-indicator",
  "button",
]);

function rotationAnimationTagFields(object: HmiObject): ObjectIoFieldDefinition[] {
  if (!ROTATION_ANIMATION_IO_SUPPORTED_TYPES.has(object.type)) {
    return [];
  }
  return [
    {
      fieldPath: "rotationAnimation.triggerTag",
      label: "Rotation Trigger Tag",
      direction: "read",
      dataTypeHint: "BOOL",
      control: "tag",
    },
    {
      fieldPath: "rotationAnimation.speedTag",
      label: "Rotation Speed Tag",
      direction: "read",
      dataTypeHint: "REAL",
      control: "tag",
    },
  ];
}

function baseTagFields(): ObjectIoFieldDefinition[] {
  return [
    { fieldPath: "visibleTag", label: "Visible Tag", direction: "read", dataTypeHint: "BOOL", control: "tag" },
    { fieldPath: "disabledTag", label: "Disabled Tag", direction: "read", dataTypeHint: "BOOL", control: "tag" },
  ];
}

function actionIoFields(action: RuntimeAction | undefined): ObjectIoFieldDefinition[] {
  if (!action) {
    return [];
  }
  if (action.type === "write") {
    return [
      { fieldPath: "action.tag", label: "Action Tag", direction: "action", dataTypeHint: "ANY", control: "tag" },
      { fieldPath: "action.value", label: "Action Value", direction: "action", dataTypeHint: "ANY", control: "text" },
    ];
  }
  if (action.type === "pulse") {
    return [
      { fieldPath: "action.tag", label: "Action Tag", direction: "action", dataTypeHint: "ANY", control: "tag" },
      { fieldPath: "action.value", label: "Pulse Value", direction: "action", dataTypeHint: "ANY", control: "text" },
      { fieldPath: "action.durationMs", label: "Pulse Duration (ms)", direction: "action", dataTypeHint: "INT", control: "number", min: 1 },
    ];
  }
  if (action.type === "toggle") {
    return [
      { fieldPath: "action.tag", label: "Action Tag", direction: "action", dataTypeHint: "BOOL", control: "tag" },
    ];
  }
  if (action.type === "writeConst" && action.target === "tag") {
    return [
      { fieldPath: "action.name", label: "Action Tag", direction: "action", dataTypeHint: "ANY", control: "tag" },
      { fieldPath: "action.value", label: "Action Value", direction: "action", dataTypeHint: "ANY", control: "text" },
    ];
  }
  if (action.type === "writeNumberPrompt" && action.target === "tag") {
    return [
      { fieldPath: "action.name", label: "Action Tag", direction: "action", dataTypeHint: "REAL", control: "tag" },
      { fieldPath: "action.min", label: "Prompt Min", direction: "action", dataTypeHint: "REAL", control: "number" },
      { fieldPath: "action.max", label: "Prompt Max", direction: "action", dataTypeHint: "REAL", control: "number" },
    ];
  }
  return [];
}

export function supportsObjectIoAction(object: HmiObject): boolean {
  return object.type === "button" || object.type === "image" || object.type === "stateImage";
}

export function getObjectIoActionMode(action: RuntimeAction | undefined): ObjectIoActionMode {
  if (!action) {
    return "none";
  }
  if (action.type === "write" || action.type === "pulse" || action.type === "toggle") {
    return action.type;
  }
  if (action.type === "writeConst" && action.target === "tag") {
    return "writeConstTag";
  }
  if (action.type === "writeNumberPrompt" && action.target === "tag") {
    return "writeNumberPromptTag";
  }
  return "unsupported";
}

export function createObjectIoAction(mode: ObjectIoActionMode, previousAction?: RuntimeAction): RuntimeAction | undefined {
  if (mode === "none" || mode === "unsupported") {
    return undefined;
  }
  if (mode === "write") {
    if (previousAction?.type === "write") {
      return previousAction;
    }
    return { type: "write", tag: "", value: true };
  }
  if (mode === "pulse") {
    if (previousAction?.type === "pulse") {
      return previousAction;
    }
    return { type: "pulse", tag: "", value: true, durationMs: 300 };
  }
  if (mode === "toggle") {
    if (previousAction?.type === "toggle") {
      return previousAction;
    }
    return { type: "toggle", tag: "" };
  }
  if (mode === "writeConstTag") {
    if (previousAction?.type === "writeConst" && previousAction.target === "tag") {
      return previousAction;
    }
    return { type: "writeConst", target: "tag", name: "", value: true };
  }
  if (mode === "writeNumberPromptTag") {
    if (previousAction?.type === "writeNumberPrompt" && previousAction.target === "tag") {
      return previousAction;
    }
    return { type: "writeNumberPrompt", target: "tag", name: "" };
  }
  return undefined;
}

export function getObjectIoFields(object: HmiObject): ObjectIoFieldDefinition[] {
  const fields: ObjectIoFieldDefinition[] = [...baseTagFields(), ...rotationAnimationTagFields(object)];

  if (object.type === "checkbox") {
    fields.push(
      { fieldPath: "tag", label: "Read Tag", direction: "read", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "writeTag", label: "Write Tag", direction: "write", dataTypeHint: "BOOL", control: "tag" },
      {
        fieldPath: "writeMode",
        label: "Write Mode",
        direction: "write",
        dataTypeHint: "ANY",
        control: "select",
        options: CHECKBOX_WRITE_MODE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
      {
        fieldPath: "pulseDurationMs",
        label: "Pulse Duration (ms)",
        direction: "write",
        dataTypeHint: "INT",
        control: "number",
        min: 1,
        visibleWhen: { fieldPath: "writeMode", values: ["pulseTrue", "pulseFalse"] },
      },
    );
    return fields;
  }

  if (object.type === "slider") {
    fields.push(
      { fieldPath: "tag", label: "Read Tag", direction: "read", dataTypeHint: "REAL", control: "tag" },
      { fieldPath: "writeTag", label: "Write Tag", direction: "write", dataTypeHint: "REAL", control: "tag" },
      { fieldPath: "writeOnRelease", label: "Write On Release", direction: "write", dataTypeHint: "BOOL", control: "boolean" },
      { fieldPath: "dragWriteIntervalMs", label: "Drag Write Interval (ms)", direction: "write", dataTypeHint: "INT", control: "number", min: 0 },
      { fieldPath: "releaseSyncHoldMs", label: "Release Sync Hold (ms)", direction: "write", dataTypeHint: "INT", control: "number", min: 0 },
    );
    return fields;
  }

  if (object.type === "numeric-input") {
    fields.push(
      { fieldPath: "tag", label: "Read Tag", direction: "read", dataTypeHint: "REAL", control: "tag" },
      { fieldPath: "writeTag", label: "Write Tag", direction: "write", dataTypeHint: "REAL", control: "tag" },
      { fieldPath: "errorTag", label: "Error Tag", direction: "status", dataTypeHint: "BOOL", control: "tag" },
    );
    return fields;
  }

  if (object.type === "select" || object.type === "radio-group") {
    fields.push(
      { fieldPath: "tag", label: "Read Tag", direction: "read", dataTypeHint: "ANY", control: "tag" },
      { fieldPath: "writeTag", label: "Write Tag", direction: "write", dataTypeHint: "ANY", control: "tag" },
    );
    return fields;
  }

  if (object.type === "progress-bar" || object.type === "value-display" || object.type === "value-input" || object.type === "state-indicator" || object.type === "switch") {
    fields.push(
      { fieldPath: "tag", label: "Read Tag", direction: "read", dataTypeHint: "ANY", control: "tag" },
    );
    return fields;
  }

  if (object.type === "numeric-image-indicator") {
    fields.push(
      { fieldPath: "tag", label: "Read Tag", direction: "read", dataTypeHint: "REAL", control: "tag" },
    );
    return fields;
  }

  if (object.type === "stateImage") {
    fields.push(
      { fieldPath: "tag", label: "State Tag", direction: "read", dataTypeHint: "ANY", control: "tag" },
      ...actionIoFields(object.action),
    );
    return fields;
  }

  if (object.type === "image") {
    fields.push(
      { fieldPath: "stateTag", label: "State Tag", direction: "read", dataTypeHint: "ANY", control: "tag" },
      ...actionIoFields(object.action),
    );
    return fields;
  }

  if (object.type === "button") {
    fields.push(...actionIoFields(object.action));
    return fields;
  }

  if (object.type === "line") {
    fields.push({ fieldPath: "stateTag", label: "State Tag", direction: "read", dataTypeHint: "ANY", control: "tag" });
    return fields;
  }

  if (object.type === "valve") {
    fields.push(
      { fieldPath: "openTag", label: "Open Tag", direction: "read", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "closedTag", label: "Closed Tag", direction: "read", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "errorTag", label: "Error Tag", direction: "status", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "commandOpenTag", label: "Command Open Tag", direction: "write", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "commandCloseTag", label: "Command Close Tag", direction: "write", dataTypeHint: "BOOL", control: "tag" },
    );
    return fields;
  }

  if (object.type === "pump") {
    fields.push(
      { fieldPath: "runTag", label: "Run Tag", direction: "read", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "faultTag", label: "Fault Tag", direction: "status", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "commandStartTag", label: "Command Start Tag", direction: "write", dataTypeHint: "BOOL", control: "tag" },
      { fieldPath: "commandStopTag", label: "Command Stop Tag", direction: "write", dataTypeHint: "BOOL", control: "tag" },
    );
    return fields;
  }

  return fields;
}
