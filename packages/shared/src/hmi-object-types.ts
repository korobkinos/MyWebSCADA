import type { ElementBindingAssignment } from "./asset-library-types";
import type { AccessRoleLevel, AppRole } from "./auth-types";
import type { IndexedTagAddress } from "./indexed-address";
import type { OperatorActionLoggingConfig } from "./operator-action-types";

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
    | "compoundShape"
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
    | "numeric-image-indicator"
    | "trendChart"
    | "eventTable";
  name?: string;
  description?: string;
  operatorActionLogging?: OperatorActionLoggingConfig;

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

export type CompoundShapePart = {
  points: number[];
  closed?: boolean;
};

export type CompoundShapeObject = HmiObjectBase & {
  type: "compoundShape";
  parts: CompoundShapePart[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  fillRule?: "nonzero" | "evenodd";
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
  showTemplateBackground?: boolean;
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

export type TrendChartAggregationMode = "auto" | "raw" | "minmax" | "avg" | "lttb";
export type TrendChartRangePreset = "5m" | "15m" | "1h" | "8h" | "24h" | "custom";
export type TrendChartLineType = "solid" | "dashed" | "dotted";
export type TrendChartRenderMode = "line" | "step" | "points";
export type TrendChartAxisTitleMode = "hidden" | "compactLabel" | "verticalLabel";

export type TrendChartAxisConfig = {
  id: string;
  name?: string;
  unit?: string;
  position: "left" | "right";
  offset?: number;
  min?: number | "auto";
  max?: number | "auto";
  color?: string;
  axisPointerLabelBackgroundColor?: string;
  verticalLabelOffsetX?: number;
  axisTitleMode?: TrendChartAxisTitleMode;
};

export type TrendChartSeriesConfig = {
  tag: string;
  color?: string;
  displayName?: string;
  unit?: string;
  visible?: boolean;
  lineWidth?: number;
  lineType?: TrendChartLineType;
  mode?: TrendChartRenderMode;
  step?: boolean;
  axisMode?: "auto" | "manual";
  axisId?: string;
};

export type TrendChartSettings = {
  renderer?: "echarts" | "uplot";
  theme?: "workbench-dark" | "echarts-dark" | "custom";
  background?: string;
  gridLines?: boolean;
  axisLabels?: boolean;
  legend?: boolean;
  tooltip?: boolean;
  dataZoomSlider?: boolean;
  defaultLineWidth?: number;
  showSymbols?: boolean;
  showUnitsInTooltip?: boolean;
  showBadQualityGaps?: boolean;
  maxVisiblePointsPerSeries?: number;
  maxLivePointsPerTag?: number;
  maxCachedRanges?: number;
  maxPointsPerSeries?: number;
  aggregation?: TrendChartAggregationMode;
  zoomDebounceMs?: number;
  refreshIntervalMs?: number;
  progressive?: boolean;
  disableAnimationsLargeData?: boolean;
  cacheEnabled?: boolean;
  cacheSize?: number;
  liveBufferLimit?: number;
  liveDataSource?: "archivePolling" | "realtimeAppend";
  liveResyncEnabled?: boolean;
  liveResyncIntervalSec?: number;
  realtimeAppendSnapshotAggregation?: "auto" | "raw" | "minmax";
  realtimeAppendSnapshotMaxPoints?: number;
  realtimeAppendFlushMs?: number;
  autoScale?: boolean;
  defaultAxisMin?: number | "auto";
  defaultAxisMax?: number | "auto";
  groupByUnit?: boolean;
  separateAxisPerTag?: boolean;
  axisPlacement?: "left" | "right" | "split";
  axisOffsetStep?: number;
  axisScaleGap?: number;
  showSeriesTable?: boolean;
  seriesTableRows?: number;
  table?: {
    background?: string;
    headerBackground?: string;
    textColor?: string;
    mutedTextColor?: string;
    borderColor?: string;
    hoverBackground?: string;
    valueTextColor?: string;
    rowHeight?: number;
    headerHeight?: number;
    fontSize?: number;
    cellPaddingX?: number;
    cellPaddingY?: number;
  };
  showToolbarMenuButton?: boolean;
  showToolbarTagsButton?: boolean;
  showToolbarLiveButton?: boolean;
  showToolbarTimeRangeButton?: boolean;
  showToolbarQuickRangeButtons?: boolean;
  showToolbarPanButtons?: boolean;
  showToolbarZoomButtons?: boolean;
  showToolbarRefreshButton?: boolean;
  showToolbarScaleButton?: boolean;
  showToolbarSettingsButton?: boolean;
};

export type TrendChartObject = HmiObjectBase & {
  type: "trendChart";
  selectedTags: TrendChartSeriesConfig[];
  axes?: TrendChartAxisConfig[];
  settings?: TrendChartSettings;
  rangePreset?: TrendChartRangePreset;
  customFrom?: number;
  customTo?: number;
  liveMode?: boolean;
  showToolbar?: boolean;
  showStatusBar?: boolean;
  showRuntimeSettingsButton?: boolean;
  allowRuntimeSettings?: boolean;
  runtimeSettingsRequiredRole?: AccessRoleLevel;
};

export type EventTableObject = HmiObjectBase & {
  type: "eventTable";
  title?: string;
  showTitle?: boolean;
  titlePosition?: "top" | "bottom" | "hidden";
  titleAlign?: "left" | "center" | "right";
  titleFontSize?: number;
  titleHeight?: number;
  titleTextColor?: string;
  titleBackgroundColor?: string;
  mode?: "online" | "history";
  enableHistoryMode?: boolean;
  historyPeriodPreset?: "lastHour" | "shift" | "day" | "week" | "custom";
  historyFrom?: number;
  historyTo?: number;
  enableCsvExport?: boolean;
  showHistoryToolbar?: boolean;
  pageSize?: number;
  serverSidePagination?: boolean;
  showHeader?: boolean;
  showToolbar?: boolean;
  toolbarPosition?: "top" | "bottom" | "hidden";
  showSearch?: boolean;
  showActiveOnlyToggle?: boolean;
  showUnackedOnlyToggle?: boolean;
  showOperatorActions?: boolean;
  showOperatorActionsToggle?: boolean;
  showAckVisibleButton?: boolean;
  showSilenceButton?: boolean;
  showSoundMuteButton?: boolean;
  showEnableSoundsButton?: boolean;
  showSettingsButton?: boolean;
  settingsRequiredRole?: AccessRoleLevel;
  // TODO(eventTable): add dedicated soundMuteRequiresRole when sound button role-gating scope is approved.
  showCsvExportButton?: boolean;
  showStatusBar?: boolean;
  statusPosition?: "top" | "bottom" | "hidden";
  statusStyle?: "archiveLike" | "compact" | "hidden";
  statusSingleLine?: boolean;
  showLastUpdate?: boolean;
  showRecordCount?: boolean;
  showDatabaseStatus?: boolean;
  showModeIndicator?: boolean;
  showActiveOnly?: boolean;
  showUnacknowledgedOnly?: boolean;
  showCleared?: boolean;
  maxRows?: number;
  categoryFilter?: string[];
  priorityFilter?: number[];
  sourceTagFilter?: string;
  searchText?: string;
  sortBy?: "time" | "priority" | "category" | "message" | "sourceTagName";
  sortDirection?: "asc" | "desc";
  columns?: string[];
  columnLabels?: Record<string, string>;
  columnWidths?: Record<string, number>;
  columnAlignments?: Record<string, "left" | "center" | "right">;
  fontSize?: number;
  rowHeight?: number;
  headerHeight?: number;
  cellPadding?: number;
  cellTextAlign?: "left" | "center" | "right";
  borderRadius?: number;
  borderWidth?: number;
  textColor?: string;
  mutedTextColor?: string;
  backgroundColor?: string;
  transparentBackground?: boolean;
  headerBackgroundColor?: string;
  headerTextColor?: string;
  borderColor?: string;
  gridLineColor?: string;
  selectedRowColor?: string;
  activeAlarmColor?: string;
  warningColor?: string;
  criticalColor?: string;
  acknowledgedColor?: string;
  clearedColor?: string;
  showGridLines?: boolean;
  zebraRows?: boolean;
  compactMode?: boolean;
  soundPlaybackMode?: "once" | "loopUntilAcknowledged";
  soundMuteMode?: "silenceCurrent" | "disableUntilEnabled";
  soundRepeatIntervalMs?: number;
  stopSoundOnAck?: boolean;
  stopSoundOnSilence?: boolean;
  enableSoundFallbackByPriority?: boolean;
  fallbackNotificationSoundId?: string;
  fallbackWarningSoundId?: string;
  fallbackAlarmSoundId?: string;
  enableAckButton?: boolean;
  enableAckSelectedButton?: boolean;
  enableSilenceButton?: boolean;
  enableSoundsButton?: boolean;
  enableSearchInToolbar?: boolean;
  enableActiveOnlyToggle?: boolean;
  enableUnackedOnlyToggle?: boolean;
  enableCsvExportButton?: boolean;
};

export type HmiObject =
  | GroupObject
  | TextObject
  | LineObject
  | CompoundShapeObject
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
  | NumericImageIndicatorObject
  | TrendChartObject
  | EventTableObject;
