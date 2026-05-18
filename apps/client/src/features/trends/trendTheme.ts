export const TREND_COLORS = [
  "#4FC3F7",
  "#81C784",
  "#FFB74D",
  "#BA68C8",
  "#E57373",
  "#64B5F6",
  "#A1887F",
  "#AED581",
  "#4DB6AC",
  "#F06292",
  "#FFD54F",
  "#90A4AE",
];

export const TREND_WORKBENCH_THEME = {
  background: "#1e1e1e",
  panel: "#252526",
  border: "#3c3c3c",
  text: "#d4d4d4",
  mutedText: "#8a8a8a",
  accent: "#007acc",
  gridLine: "#2f2f2f",
};

export const TREND_ECHARTS_DARK_THEME = {
  background: "#1f1f1f",
  panel: "#262626",
  border: "#434343",
  text: "#e0e0e0",
  mutedText: "#a6a6a6",
  accent: "#4992ff",
  gridLine: "#303030",
};

export function resolveTrendTheme(theme: "workbench-dark" | "echarts-dark" | "custom" | undefined) {
  if (theme === "echarts-dark") {
    return TREND_ECHARTS_DARK_THEME;
  }
  return TREND_WORKBENCH_THEME;
}
