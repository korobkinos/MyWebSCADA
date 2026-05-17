import type { TrendAggregationMode, TrendPoint, TrendQueryResponse, TrendTagInfo } from "../../services/api";

export type { TrendAggregationMode, TrendPoint, TrendQueryResponse, TrendTagInfo };

export type TrendRangePreset = "5m" | "15m" | "1h" | "8h" | "24h" | "custom";

export type TrendLineType = "solid" | "dashed" | "dotted";
export type TrendRenderMode = "line" | "step" | "points";

export type TrendAxisConfig = {
  id: string;
  name?: string;
  unit?: string;
  position: "left" | "right";
  offset?: number;
  min?: number | "auto";
  max?: number | "auto";
  color?: string;
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
};

export type TrendSettings = {
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
  maxPointsPerSeries: number;
  aggregation: TrendAggregationMode;
  zoomDebounceMs: number;
  progressive: boolean;
  disableAnimationsLargeData: boolean;
  cacheEnabled: boolean;
  cacheSize: number;
  liveBufferLimit: number;
  autoScale: boolean;
  defaultAxisMin?: number | "auto";
  defaultAxisMax?: number | "auto";
  groupByUnit: boolean;
  separateAxisPerTag: boolean;
  axisPlacement: "left" | "right" | "split";
  axisOffsetStep: number;
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
  getWidth: () => number;
  getPointCount: () => number;
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
