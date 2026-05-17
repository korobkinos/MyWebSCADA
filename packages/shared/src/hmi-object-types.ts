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

export type RotationAnimationMode = "truthy" | "equals" | "notEquals";
export type RotationAnimationDirection = "clockwise" | "counterclockwise";
export type RotationAnimationPivot = "center" | "origin";
export type FlowAnimationMode = "truthy" | "equals" | "notEquals";
export type FlowAnimationDirection = "forward" | "reverse";
export type FlowAnimationSpeedSource = "fixed" | "tag";
export type FlowAnimationEffectType = "dash" | "arrows" | "dots" | "gradientShift";

export type RotationAnimationConfig = {
  enabled?: boolean;
  triggerTag?: string;
  triggerMode?: RotationAnimationMode;
  triggerValue?: string | number | boolean;
  triggerInvert?: boolean;
  speedSource?: "fixed" | "tag";
  fixedSpeedDegPerSec?: number;
  speedTag?: string;
  minSpeedDegPerSec?: number;
  maxSpeedDegPerSec?: number;
  direction?: RotationAnimationDirection;
  pivot?: RotationAnimationPivot;
};

export type FlowAnimationConfig = {
  enabled?: boolean;

  triggerTag?: string;
  triggerMode?: FlowAnimationMode;
  triggerValue?: string | number | boolean;
  triggerInvert?: boolean;

  speedSource?: FlowAnimationSpeedSource;
  fixedSpeedPxPerSec?: number;
  speedTag?: string;
  minSpeedPxPerSec?: number;
  maxSpeedPxPerSec?: number;

  direction?: FlowAnimationDirection;

  effectType?: FlowAnimationEffectType;
  color?: string;
  opacity?: number;
  strokeWidth?: number;
  useBaseStrokeWidth?: boolean;
  gradientStartColor?: string;
  gradientMidColor?: string;
  gradientEndColor?: string;
  gradientSpanPx?: number;

  dashLength?: number;
  gapLength?: number;
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
    | "numeric-input"
    | "numeric-image-indicator";
  name?: string;

  x: number;
  y: number;
  width: number;
  height: number;

  rotation?: number;
  rotationAnimation?: RotationAnimationConfig;
  visible?: boolean;
  visibleForRoles?: AppRole[];
  requiredVisibleRole?: AccessRoleLevel;
  requiredActionRole?: AccessRoleLevel;
  onPressMacroId?: string;
  onReleaseMacroId?: string;
  locked?: boolean;
  opacity?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowBlur?: number;
  shadowDistance?: number;
  shadowDirection?: "right" | "left" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

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
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  cornerRadius?: number;
  closed?: boolean;
  fill?: string;
  stateTag?: string;
  activeValue?: string | number | boolean;
  inactiveStroke?: string;
  activeStroke?: string;
  gradientEnabled?: boolean;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
  flowAnimation?: FlowAnimationConfig;
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
  gradientEnabled?: boolean;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
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
  gradientEnabled?: boolean;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
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
  gradientEnabled?: boolean;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
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
  gradientEnabled?: boolean;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
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
  writeMode?: CheckboxWriteMode;
  pulseDurationMs?: number;
  checkedText?: string;
  uncheckedText?: string;
  checkedColor?: string;
  uncheckedColor?: string;
};

export type CheckboxWriteMode =
  | "toggleState"
  | "writeTrue"
  | "writeFalse"
  | "pulseTrue"
  | "pulseFalse";

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
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  trackThickness?: number;
  thumbRadius?: number;
  thumbBorderColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  decimals?: number;
  valuePosition?: "top" | "bottom" | "left" | "right" | "center" | "hidden";
  showMinMax?: boolean;
  minMaxFontSize?: number;
  minLabelOffset?: number;
  maxLabelOffset?: number;
  writeOnRelease?: boolean;
  dragWriteIntervalMs?: number;
  releaseSyncHoldMs?: number;
  badColor?: string;
  badTextColor?: string;
  disabledColor?: string;
  disabledTextColor?: string;
  transparentBackground?: boolean;
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
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  padding?: number;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  decimals?: number;
  showPercent?: boolean;
  showUnit?: boolean;
  fillDirection?: "left-to-right" | "right-to-left" | "bottom-to-top" | "top-to-bottom";
  warningMin?: number;
  warningMax?: number;
  warningColor?: string;
  badTextColor?: string;
  badBackgroundColor?: string;
  badBorderColor?: string;
  disabledBackgroundColor?: string;
  disabledTextColor?: string;
};

export type SelectObject = HmiObjectBase & {
  type: "select";
  tag?: string;
  writeTag?: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
  placeholder?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  textColor?: string;
  placeholderColor?: string;
  fontFamily?: string;
  fontSize?: number;
  padding?: number;
  arrowColor?: string;
  dropdownBackgroundColor?: string;
  dropdownBorderColor?: string;
  optionTextColor?: string;
  optionHoverColor?: string;
  optionSelectedColor?: string;
  optionSelectedTextColor?: string;
  dropdownMaxHeight?: number;
  dropdownOffsetY?: number;
  optionHeight?: number;
  arrowAreaWidth?: number;
  badTextColor?: string;
  badBackgroundColor?: string;
  badBorderColor?: string;
  disabledBackgroundColor?: string;
  disabledTextColor?: string;
};

export type RadioGroupObject = HmiObjectBase & {
  type: "radio-group";
  tag?: string;
  writeTag?: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
  orientation?: "horizontal" | "vertical";
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  itemGap?: number;
  itemPadding?: number;
  radioSize?: number;
  radioStrokeWidth?: number;
  indicatorGap?: number;
  itemInset?: number;
  selectedColor?: string;
  unselectedColor?: string;
  labelColor?: string;
  selectedLabelColor?: string;
  fontFamily?: string;
  fontSize?: number;
  gradientEnabled?: boolean;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "center-outward" | "outside-inward";
  styleMode?: "radio" | "segmented" | "card";
  badTextColor?: string;
  badBackgroundColor?: string;
  disabledColor?: string;
  disabledTextColor?: string;
  transparentBackground?: boolean;
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
  dialogPlacement?: "custom" | "top" | "right" | "bottom" | "left";
  dialogOffset?: number;
  dialogX?: number;
  dialogY?: number;
  dialogBackgroundColor?: string;
  dialogTextColor?: string;
  dialogBorderColor?: string;
  dialogCloseButtonTextColor?: string;
  dialogCloseButtonBackgroundColor?: string;
  dialogSetButtonTextColor?: string;
  dialogSetButtonBackgroundColor?: string;
  dialogSetButtonBorderColor?: string;
};

export type NumericImageIndicatorState = {
  index: number;
  assetId?: string;
};

export type NumericImageIndicatorObject = HmiObjectBase & {
  type: "numeric-image-indicator";
  tag?: string;
  states: NumericImageIndicatorState[];
  defaultAssetId?: string;
  badQualityAssetId?: string;
  fit: "contain" | "cover" | "stretch" | "none";
  preserveAspectRatio?: boolean;
  outOfRangeMode?: "default" | "clamp";
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
  | NumericInputObject
  | NumericImageIndicatorObject;
