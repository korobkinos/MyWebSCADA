import type { TrendAggregationMode, TrendPoint, TrendQueryResponse, TrendTagInfo } from "../../services/api";

export type { TrendAggregationMode, TrendPoint, TrendQueryResponse, TrendTagInfo };

export type TrendRangePreset = "5m" | "15m" | "1h" | "8h" | "24h" | "custom";
export type TrendQuickPreset = "5m" | "15m" | "1h";
export type TrendSeriesColumnId = "visible" | "tag" | "displayName" | "description" | "axis" | "color" | "value";
export type TrendSeriesColumnWidths = Record<TrendSeriesColumnId, number>;

export type TrendLineType = "solid" | "dashed" | "dotted";
export type TrendRenderMode = "line" | "step" | "points";
export type TrendAxisTitleMode = "hidden" | "compactLabel" | "verticalLabel";
export type TrendRenderer = "echarts";
export type TrendLiveDataSource = "archivePolling" | "realtimeAppend";
export type TrendRealtimeSnapshotAggregation = "auto" | "raw" | "minmax";

export type TrendAxisConfig = {
  id: string;
  name?: string;
  unit?: string;
  position: "left" | "right";
  offset?: number;
  min?: number | "auto";
  max?: number | "auto";
  color?: string;
  axisTextColor?: string;
  axisGridLineColor?: string;
  axisPointerLabelBackgroundColor?: string;
  axisLabelFontSize?: number;
  axisLabelMargin?: number;
  axisNameFontSize?: number;
  axisNameGap?: number;
  axisNamePaddingX?: number;
  axisNamePaddingY?: number;
  verticalLabelOffsetX?: number;
  axisTitleMode?: TrendAxisTitleMode;
};

export type TrendTagSelection = {
  tag: string;
  color?: string;
  displayName?: string;
  unit?: string;
  visible?: boolean;
  lineWidth?: number;
  lineType?: TrendLineType;
  mode?: TrendRenderMode;
  step?: boolean;
  axisMode?: "auto" | "manual";
  axisId?: string;
  archiveMode?: string;
  archivePeriodMs?: number;
};

export type TrendTagPickerSelectionFilter = "all" | "added";

export type TrendTagPickerFilters = {
  search: string;
  groupFilter: string;
  driverFilter: string;
  selectionFilter: TrendTagPickerSelectionFilter;
};

export type TrendTableSettings = {
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

export type TrendSettings = {
  renderer: TrendRenderer;
  theme: "workbench-dark" | "echarts-dark" | "custom";
  background: string;
  gridLines: boolean;
  axisLabels: boolean;
  legend: boolean;
  tooltip: boolean;
  dataZoomSlider: boolean;
  defaultLineWidth: number;
  showSymbols: boolean;
  showUnitsInTooltip: boolean;
  showBadQualityGaps: boolean;
  maxVisiblePointsPerSeries: number;
  maxLivePointsPerTag: number;
  maxCachedRanges: number;
  // Legacy fields kept for backward compatibility with older project/settings payloads.
  maxPointsPerSeries: number;
  aggregation: TrendAggregationMode;
  zoomDebounceMs: number;
  refreshIntervalMs: number;
  progressive: boolean;
  disableAnimationsLargeData: boolean;
  cacheEnabled: boolean;
  // Legacy field kept for backward compatibility with older project/settings payloads.
  cacheSize: number;
  // Legacy field kept for backward compatibility with older project/settings payloads.
  liveBufferLimit: number;
  liveDataSource: TrendLiveDataSource;
  liveResyncEnabled: boolean;
  liveResyncIntervalSec: number;
  realtimeAppendSnapshotAggregation: TrendRealtimeSnapshotAggregation;
  realtimeAppendSnapshotMaxPoints: number;
  realtimeAppendFlushMs: number;
  autoScale: boolean;
  defaultAxisMin?: number | "auto";
  defaultAxisMax?: number | "auto";
  groupByUnit: boolean;
  separateAxisPerTag: boolean;
  axisPlacement: "left" | "right" | "split";
  axisOffsetStep: number;
  axisScaleGap: number;
  showSeriesTable: boolean;
  seriesTableRows: number;
  table?: TrendTableSettings;
  showToolbarMenuButton: boolean;
  showToolbarTagsButton: boolean;
  showToolbarLiveButton: boolean;
  showToolbarTimeRangeButton: boolean;
  showToolbarQuickRangeButtons: boolean;
  showToolbarPanButtons: boolean;
  showToolbarZoomButtons: boolean;
  showToolbarRefreshButton: boolean;
  showToolbarScaleButton: boolean;
  showToolbarSettingsButton: boolean;
};

export type TrendVisibleRange = {
  from: number;
  to: number;
};

export type TrendSeriesView = {
  tag: string;
  displayName: string;
  unit?: string;
  points: TrendPoint[];
};

export type TrendStatus = {
  seriesCount: number;
  pointCount: number;
  aggregation: Exclude<TrendAggregationMode, "auto">;
  lastLoadAt?: number;
  rangeFrom: number;
  rangeTo: number;
};

export type TrendChartApi = {
  appendLivePoints: (updates: Array<{ tag: string; value: number | boolean | string | null; quality?: string; timestamp: number }>) => void;
  notifyLiveHeartbeat?: (timestampMs?: number) => void;
  getWidth: () => number;
  getPointCount: () => number;
  getRenderedPointCount?: () => number;
};

export type TrendQueryCacheEntry = {
  key: string;
  value: TrendQueryResponse;
  createdAt: number;
};

export type TrendTagGroup = {
  name: string;
  tags: TrendTagInfo[];
};
