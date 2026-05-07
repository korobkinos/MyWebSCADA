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
    | "libraryElementInstance"
    | "valve"
    | "pump"
    | "frame";
  name?: string;

  x: number;
  y: number;
  width: number;
  height: number;

  rotation?: number;
  visible?: boolean;
  locked?: boolean;

  minWidth?: number;
  minHeight?: number;

  bindings?: HmiBindings;
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

export type RuntimeAction =
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
      confirm?: boolean;
      confirmText?: string;
    };

export type ButtonObject = HmiObjectBase & {
  type: "button";
  text?: string;
  showText?: boolean;
  backgroundAssetId?: string;
  pressedBackgroundAssetId?: string;
  disabledBackgroundAssetId?: string;
  backgroundColor?: string;
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
  opacity?: number;
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

export type LibraryElementInstanceObject = HmiObjectBase & {
  type: "libraryElementInstance";
  libraryId: string;
  elementId: string;
  tagPrefix?: string;
  parameterValues?: Record<string, unknown>;
  scaleMode?: "none" | "fit" | "stretch";
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
  | LibraryElementInstanceObject
  | ValveObject
  | PumpObject
  | FrameObject;
