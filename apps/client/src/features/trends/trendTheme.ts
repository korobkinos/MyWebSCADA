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

export type TrendUiTheme = {
  background: string;
  panel: string;
  border: string;
  text: string;
  mutedText: string;
  accent: string;
  gridLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  toolbarBg: string;
  buttonBg: string;
  buttonHoverBg: string;
  tableBg: string;
  tableBorder: string;
};

export const TREND_WORKBENCH_THEME: TrendUiTheme = {
  background: "#1e1e1e",
  panel: "#252526",
  border: "#3c3c3c",
  text: "#d4d4d4",
  mutedText: "#8a8a8a",
  accent: "#007acc",
  gridLine: "#2f2f2f",
  tooltipBg: "#1f1f1f",
  tooltipBorder: "#3c3c3c",
  toolbarBg: "#1e1e1e",
  buttonBg: "#2d2d30",
  buttonHoverBg: "#3b3b40",
  tableBg: "#252526",
  tableBorder: "#3c3c3c",
};

export const TREND_ECHARTS_DARK_THEME: TrendUiTheme = {
  background: "#1f1f1f",
  panel: "#262a33",
  border: "#3d4452",
  text: "#e0e0e0",
  mutedText: "#a7b0c0",
  accent: "#4992ff",
  gridLine: "#313947",
  tooltipBg: "#1f2530",
  tooltipBorder: "#4a5a75",
  toolbarBg: "#1f2430",
  buttonBg: "#313849",
  buttonHoverBg: "#3a4459",
  tableBg: "#242a36",
  tableBorder: "#3d4452",
};

export const TREND_CUSTOM_THEME: TrendUiTheme = {
  background: "#171717",
  panel: "#212121",
  border: "#3b3b3b",
  text: "#f1f1f1",
  mutedText: "#a0a0a0",
  accent: "#ff8f00",
  gridLine: "#353535",
  tooltipBg: "#1e1e1e",
  tooltipBorder: "#444444",
  toolbarBg: "#1d1d1d",
  buttonBg: "#2b2b2b",
  buttonHoverBg: "#383838",
  tableBg: "#1f1f1f",
  tableBorder: "#3b3b3b",
};

export function resolveTrendTheme(theme: "workbench-dark" | "echarts-dark" | "custom" | undefined): TrendUiTheme {
  if (theme === "echarts-dark") {
    return TREND_ECHARTS_DARK_THEME;
  }
  if (theme === "custom") {
    return TREND_CUSTOM_THEME;
  }
  return TREND_WORKBENCH_THEME;
}
