import type { ElementBindingAssignment } from "./asset-library-types";
import type { AccessRoleLevel, AppRole } from "./auth-types";
import type { IndexedTagAddress } from "./indexed-address";

export type HmiObjectTagIndexingByField = Record<string, IndexedTagAddress>;

export type ExpressionBinding = {
  mode: "tag" | "expr";
  source: string;
  fallback?: string | number | boolean;
};

export type HmiBindings = {
  visible?: ExpressionBinding;
  fill?: ExpressionBinding;
  text?: ExpressionBinding;
  enabled?: ExpressionBinding;
};

export type TextHorizontalAlign = "left" | "center" | "right";
export type TextVerticalAlign = "top" | "middle" | "bottom";

export type TextStyle = {
  fontFamily: string;
  fontSize: number;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  color: string;
  horizontalAlign: TextHorizontalAlign;
  verticalAlign: TextVerticalAlign;
  padding?: number;
};

export type TextLayout = {
  wrap?: "none" | "word" | "char";
  ellipsis?: boolean;
};

export type HmiObjectBase = {
  id: string;
  type:
    | "group"
    | "text"
    | "line"
    | "rectangle"
    | "value-display"
    | "value-input"
    | "state-indicator"
    | "button"
    | "switch"
    | "image"
    | "stateImage"
    | "valueSelect"
    | "libraryElementInstance"
    | "valve"
    | "pump"
    | "frame"
    | "checkbox"
    | "slider"
    | "progress-bar"
    | "select"
    | "radio-group"
    | "numeric-input";
  name?: string;

  x: number;
  y: number;
  width: number;
  height: number;

  rotation?: number;
  visible?: boolean;
  visibleForRoles?: AppRole[];
  requiredVisibleRole?: AccessRoleLevel;
  requiredActionRole?: AccessRoleLevel;
  locked?: boolean;
  opacity?: number;

  minWidth?: number;
  minHeight?: number;

  zIndex?: number;

  bindings?: HmiBindings;
  visibleTag?: string;
  visibleInvert?: boolean;
  disabledTag?: string;
  disabledInvert?: boolean;
  tagIndexingByField?: HmiObjectTagIndexingByField;
  tagIndexing?: IndexedTagAddress;
};

export type TextObject = HmiObjectBase & {
  type: "text";
  text: string;
  textStyle: TextStyle;
} & TextLayout;

export type LineObject = HmiObjectBase & {
  type: "line";
  points: number[];
  stroke: string;
  strokeWidth: number;
  closed?: boolean;
  fill?: string;
};

export type GroupObject = HmiObjectBase & {
  type: "group";
  objects: HmiObject[];
};

export type RectangleObject = HmiObjectBase & {
  type: "rectangle";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
};

export type ValueDisplayObject = HmiObjectBase & {
  type: "value-display";
  tag: string;
  format?: string;
  suffix?: string;
  badQualityText?: string;
  textStyle: TextStyle;
} & TextLayout;

export type ValueInputObject = HmiObjectBase & {
  type: "value-input";
  tag: string;
  format?: string;
  suffix?: string;
  min?: number;
  max?: number;
  confirm?: boolean;
  confirmText?: string;
  textStyle: TextStyle;
} & TextLayout;

export type StateIndicatorObject = HmiObjectBase & {
  type: "state-indicator";
  tag: string;
  trueText: string;
  falseText: string;
  trueColor: string;
  falseColor: string;
  badColor: string;
  textStyle: TextStyle;
} & TextLayout;

export type RuntimeAction = {
  requireAuth?: boolean;
  requiredRoles?: AppRole[];
  requiredRoleLevel?: AccessRoleLevel;
} & (
  | {
      type: "openScreen";
      screenId: string;
    }
  | {
      type: "openPopup";
      popupScreenId: string;
      title?: string;
      x?: number;
      y?: number;
      tagPrefix?: string;
      args?: Record<string, unknown>;
    }
  | {
      type: "closePopup";
      popupInstanceId?: string;
    }
  | {
      type: "write";
      tag: string;
      value: boolean | number | string | null;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "pulse";
      tag: string;
      value: boolean | number | string | null;
      durationMs: number;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "toggle";
      tag: string;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "writeConst";
      target: "tag" | "variable";
      name: string;
      value: boolean | number | string | null;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "writeNumberPrompt";
      target: "tag" | "variable";
      name: string;
      min?: number;
      max?: number;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "openUrl";
      url: string;
      newTab?: boolean;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "runMacro";
      macroId: string;
      args?: Record<string, unknown>;
      allowRepeat?: boolean;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "setLW";
      address: number;
      value: boolean | number | string | null;
      confirm?: boolean;
      confirmText?: string;
    }
  | {
      type: "setInternalVar";
      name: string;
      value: boolean | number | string | null;
      confirm?: boolean;
      confirmText?: string;
    }
);

export type ButtonObject = HmiObjectBase & {
  type: "button";
  text?: string;
  showText?: boolean;
  backgroundAssetId?: string;
  pressedBackgroundAssetId?: string;
  disabledBackgroundAssetId?: string;
  backgroundColor?: string;
  pressedBackgroundColor?: string;
  disabledBackgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  action: RuntimeAction;
  textStyle: TextStyle;
} & TextLayout;

export type SwitchObject = HmiObjectBase & {
  type: "switch";
  tag: string;
  onText?: string;
  offText?: string;
  onColor?: string;
  offColor?: string;
  borderColor?: string;
  borderWidth?: number;
  textStyle: TextStyle;
} & TextLayout;

export type ImageState = {
  state: string | number | boolean;
  assetId?: string;
  src?: string;
};

export type ImageObject = HmiObjectBase & {
  type: "image";
  assetId?: string;
  src?: string;
  action?: RuntimeAction;
  fit: "contain" | "cover" | "stretch" | "none";
  preserveAspectRatio?: boolean;
  stateTag?: string;
  stateImages?: ImageState[];
  bindings?: HmiBindings & {
    opacity?: ExpressionBinding;
    assetId?: ExpressionBinding;
  };
};

export type StateImageCondition =
  | { type: "equals"; value: string | number | boolean }
  | { type: "notEquals"; value: string | number | boolean }
  | { type: "true" }
  | { type: "false" };

export type StateImageObject = HmiObjectBase & {
  type: "stateImage";
  tag: string;
  states: Array<{
    id: string;
    name: string;
    condition: StateImageCondition;
    assetId: string;
  }>;
  defaultAssetId?: string;
  badQualityAssetId?: string;
  fit: "contain" | "cover" | "stretch" | "none";
  preserveAspectRatio?: boolean;
  action?: RuntimeAction;
};

export type ValueSelectObject = HmiObjectBase & {
  type: "valueSelect";
  options: Array<{
    label: string;
    value: string | number | boolean;
  }>;
  target:
    | {
        type: "internal";
        name: string;
      }
    | {
        type: "lw";
        address: number;
      }
    | {
        type: "tag";
        tag: string;
      };
  valueType: "string" | "number" | "boolean";
  textStyle: TextStyle;
} & TextLayout;

export type LibraryElementInstanceObject = HmiObjectBase & {
  type: "libraryElementInstance";
  libraryId: string;
  elementId: string;
  tagPrefix?: string;
  parameterValues?: Record<string, unknown>;
  bindingAssignments?: Record<string, ElementBindingAssignment>;
  scaleMode?: "none" | "fit" | "stretch";
  action?: RuntimeAction;
};

/** @deprecated Use image + libraryElementInstance/template instead. */
export type ValveObject = HmiObjectBase & {
  type: "valve";
  openTag?: string;
  closedTag?: string;
  errorTag?: string;
  commandOpenTag?: string;
  commandCloseTag?: string;
  label?: string;
  textStyle: TextStyle;
  popupScreenId?: string;
};

/** @deprecated Use image + libraryElementInstance/template instead. */
export type PumpObject = HmiObjectBase & {
  type: "pump";
  runTag?: string;
  faultTag?: string;
  commandStartTag?: string;
  commandStopTag?: string;
  label?: string;
  textStyle: TextStyle;
  popupScreenId?: string;
};

export type FrameObject = HmiObjectBase & {
  type: "frame";
  screenId: string;
  tagPrefix?: string;
  clipContent?: boolean;
  showBorder?: boolean;
  borderColor?: string;
  borderWidth?: number;
  scaleMode?: "none" | "fit" | "stretch";
};

export type CheckboxObject = HmiObjectBase & {
  type: "checkbox";
  label?: string;
  tag?: string;
  writeTag?: string;
  checkedText?: string;
  uncheckedText?: string;
  checkedColor?: string;
  uncheckedColor?: string;
};

export type SliderObject = HmiObjectBase & {
  type: "slider";
  tag?: string;
  writeTag?: string;
  min?: number;
  max?: number;
  step?: number;
  orientation?: "horizontal" | "vertical";
  unit?: string;
  showValue?: boolean;
  fillColor?: string;
  trackColor?: string;
  thumbColor?: string;
};

export type ProgressBarObject = HmiObjectBase & {
  type: "progress-bar";
  tag?: string;
  min?: number;
  max?: number;
  orientation?: "horizontal" | "vertical";
  unit?: string;
  showValue?: boolean;
  fillColor?: string;
  trackColor?: string;
  alarmColor?: string;
};

export type SelectObject = HmiObjectBase & {
  type: "select";
  tag?: string;
  writeTag?: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
  placeholder?: string;
};

export type RadioGroupObject = HmiObjectBase & {
  type: "radio-group";
  tag?: string;
  writeTag?: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
  orientation?: "horizontal" | "vertical";
};

export type NumericInputObject = HmiObjectBase & {
  type: "numeric-input";
  tag?: string;
  writeTag?: string;
  errorTag?: string;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  formatMode?: "decimals" | "pattern";
  formatPattern?: string;
  unit?: string;
  showUnit?: boolean;
  placeholder?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  textAlign?: "left" | "center" | "right";
  showMeta?: boolean;
  stepButtonUseTextColor?: boolean;
  stepButtonTextColor?: string;
  stepButtonBackgroundColor?: string;
  badTextColor?: string;
  badBackgroundColor?: string;
  badBorderColor?: string;
  dialogTitle?: string;
  dialogWidth?: number;
  dialogHeight?: number;
  dialogX?: number;
  dialogY?: number;
  dialogBackgroundColor?: string;
  dialogTextColor?: string;
  dialogBorderColor?: string;
};

export type HmiObject =
  | GroupObject
  | TextObject
  | LineObject
  | RectangleObject
  | ValueDisplayObject
  | ValueInputObject
  | StateIndicatorObject
  | ButtonObject
  | SwitchObject
  | ImageObject
  | StateImageObject
  | ValueSelectObject
  | LibraryElementInstanceObject
  | ValveObject
  | PumpObject
  | FrameObject
  | CheckboxObject
  | SliderObject
  | ProgressBarObject
  | SelectObject
  | RadioGroupObject
  | NumericInputObject;
