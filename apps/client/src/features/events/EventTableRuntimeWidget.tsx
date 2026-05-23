import type { EventTableObject } from "@web-scada/shared";

type EventTableRuntimeWidgetProps = {
  object: EventTableObject;
};

const DEFAULT_COLUMNS = ["timestamp", "priority", "category", "message", "source", "value", "state", "ack"];
const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  timestamp: "Timestamp",
  priority: "Priority",
  category: "Category",
  message: "Message",
  source: "Source",
  value: "Value",
  state: "State",
  ack: "Ack",
};

function formatHistoryPreset(preset: EventTableObject["historyPeriodPreset"]): string {
  switch (preset) {
    case "lastHour":
      return "last hour";
    case "shift":
      return "shift";
    case "day":
      return "day";
    case "week":
      return "week";
    case "custom":
      return "custom";
    default:
      return "last hour";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function EventTableRuntimeWidget({ object }: EventTableRuntimeWidgetProps) {
  const title = object.title?.trim() || "Event Table";
  const columns = (object.columns && object.columns.length > 0 ? object.columns : DEFAULT_COLUMNS).slice(0, 12);
  const textColor = object.textColor ?? "#d4d4d4";
  const mutedTextColor = object.mutedTextColor ?? "#9ea6ad";
  const backgroundColor = object.backgroundColor ?? "#1f2328";
  const headerBackgroundColor = object.headerBackgroundColor ?? "#2a3038";
  const headerTextColor = object.headerTextColor ?? "#ced8df";
  const borderColor = object.borderColor ?? "#3c3c3c";
  const gridLineColor = object.gridLineColor ?? "#30363d";
  const fontSize = clamp(toFiniteNumber(object.fontSize, 12), 10, 24);
  const rowHeight = clamp(toFiniteNumber(object.rowHeight, 26), 20, 52);
  const headerHeight = clamp(toFiniteNumber(object.headerHeight, 28), 20, 60);
  const borderRadius = clamp(toFiniteNumber(object.borderRadius, 6), 0, 24);
  const borderWidth = clamp(toFiniteNumber(object.borderWidth, 1), 0, 4);
  const mode = object.mode ?? (object.enableHistoryMode ? "history" : "online");
  const historyPreset = formatHistoryPreset(object.historyPeriodPreset ?? "lastHour");
  const statusPosition = object.statusPosition ?? "bottom";
  const statusStyle = object.statusStyle ?? "archiveLike";
  const showStatus = object.showStatusBar !== false && statusStyle !== "hidden" && statusPosition !== "hidden";
  const showTopStatus = showStatus && statusPosition === "top";
  const showBottomStatus = showStatus && statusPosition === "bottom";
  const showToolbar = object.showToolbar !== false;
  const showHeader = object.showHeader !== false;
  const showTitle = object.showTitle !== false;
  const maxRows = Math.max(1, Math.round(object.maxRows ?? 100));
  const pageSize = Math.max(1, Math.round(object.pageSize ?? 50));
  const compactMode = object.compactMode ?? false;
  const showGridLines = object.showGridLines !== false;
  const transparentBackground = object.transparentBackground === true;
  const tableBackground = transparentBackground ? "transparent" : backgroundColor;
  const statusTone = mode === "history" ? (object.warningColor ?? "#e6b450") : (object.activeAlarmColor ?? "#4ec94e");

  const renderStatus = () => {
    if (!showStatus) {
      return null;
    }
    const lineOne =
      mode === "history"
        ? `Event archive: ready | period: ${historyPreset} | records 0`
        : `Event status: offline | active 0 | unacked 0 | last update ${object.showLastUpdate === false ? "--:--:--" : "--:--:--"}`;
    const lineTwo =
      mode === "history"
        ? `DB: -- MB | Records: --`
        : `Mode: ${object.showModeIndicator === false ? "--" : "online"} | Rows: ${object.showRecordCount === false ? "--" : maxRows}`;

    if (statusStyle === "compact") {
      return (
        <div
          style={{
            minHeight: Math.max(20, rowHeight - 2),
            padding: "4px 8px",
            borderTop: showBottomStatus ? `1px solid ${gridLineColor}` : "none",
            borderBottom: showTopStatus ? `1px solid ${gridLineColor}` : "none",
            color: mutedTextColor,
            fontSize: Math.max(10, fontSize - 1),
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {lineOne}
        </div>
      );
    }

    return (
      <div
        style={{
          minHeight: Math.max(24, rowHeight),
          padding: compactMode ? "4px 8px" : "5px 10px",
          borderTop: showBottomStatus ? `1px solid ${gridLineColor}` : "none",
          borderBottom: showTopStatus ? `1px solid ${gridLineColor}` : "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 1,
          overflow: "hidden",
        }}
      >
        <div style={{ color: statusTone, fontSize: Math.max(10, fontSize - 1), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineOne}
        </div>
        <div style={{ color: mutedTextColor, opacity: 0.9, fontSize: Math.max(9, fontSize - 2), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {object.showDatabaseStatus === false && mode === "history" ? "DB: -- | Records: --" : lineTwo}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius,
        background: tableBackground,
        color: textColor,
        boxSizing: "border-box",
        fontFamily: "Segoe UI, Tahoma, sans-serif",
        fontSize,
        overflow: "hidden",
      }}
    >
      {showTitle ? (
        <div
          style={{
            minHeight: compactMode ? Math.max(20, headerHeight - 4) : headerHeight,
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            background: headerBackgroundColor,
            color: headerTextColor,
            borderBottom: `1px solid ${gridLineColor}`,
            fontWeight: 600,
            letterSpacing: 0.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
      ) : null}
      {showTopStatus ? renderStatus() : null}
      {showToolbar ? (
        <div
          style={{
            minHeight: compactMode ? Math.max(20, rowHeight - 4) : rowHeight,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            borderBottom: `1px solid ${gridLineColor}`,
            color: mutedTextColor,
            flexWrap: "wrap",
            overflow: "hidden",
            alignContent: "center",
          }}
        >
          {object.enableSearchInToolbar !== false ? (
            <div
              style={{
                minWidth: 110,
                maxWidth: 200,
                height: 20,
                border: `1px solid ${gridLineColor}`,
                borderRadius: 3,
                padding: "0 6px",
                color: mutedTextColor,
                display: "flex",
                alignItems: "center",
                fontSize: Math.max(9, fontSize - 2),
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {object.searchText?.trim() ? object.searchText : "Search..."}
            </div>
          ) : null}
          {object.enableActiveOnlyToggle !== false ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2), color: object.showActiveOnly !== false ? (object.activeAlarmColor ?? "#4ec94e") : mutedTextColor }}>
              Active {object.showActiveOnly !== false ? "on" : "off"}
            </span>
          ) : null}
          {object.enableUnackedOnlyToggle !== false ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2), color: object.showUnacknowledgedOnly ? (object.warningColor ?? "#e6b450") : mutedTextColor }}>
              Unacked {object.showUnacknowledgedOnly ? "on" : "off"}
            </span>
          ) : null}
          {mode === "history" && object.showHistoryToolbar !== false ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2) }}>Period {historyPreset} | Page {pageSize}</span>
          ) : null}
          {object.enableAckButton ? <span style={{ fontSize: Math.max(9, fontSize - 2), opacity: 0.7 }}>Ack (TODO)</span> : null}
          {object.enableAckSelectedButton ? <span style={{ fontSize: Math.max(9, fontSize - 2), opacity: 0.7 }}>Ack Selected (TODO)</span> : null}
          {object.enableSilenceButton ? <span style={{ fontSize: Math.max(9, fontSize - 2), opacity: 0.7 }}>Silence (TODO)</span> : null}
          {mode === "history" && object.enableCsvExportButton && object.enableCsvExport ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2), opacity: 0.7 }}>CSV Export (TODO)</span>
          ) : null}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {showHeader ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: columns
                .map((column) => {
                  const width = Number(object.columnWidths?.[column]);
                  return Number.isFinite(width) && width > 32 ? `${width}px` : "minmax(70px, 1fr)";
                })
                .join(" "),
              alignItems: "center",
              minHeight: headerHeight,
              background: headerBackgroundColor,
              color: headerTextColor,
              borderBottom: `1px solid ${gridLineColor}`,
              fontWeight: 600,
              fontSize: Math.max(9, fontSize - 1),
              textTransform: "uppercase",
              letterSpacing: 0.45,
              overflow: "hidden",
            }}
          >
            {columns.map((column, index) => (
              <div
                key={column}
                style={{
                  padding: "0 8px",
                  borderRight: showGridLines && index < columns.length - 1 ? `1px solid ${gridLineColor}` : "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={column}
              >
                {object.columnLabels?.[column]?.trim() || DEFAULT_COLUMN_LABELS[column] || column}
              </div>
            ))}
          </div>
        ) : null}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: mutedTextColor,
            background: object.zebraRows ? "linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0) 100%)" : "transparent",
            textAlign: "center",
            padding: 12,
            overflow: "auto",
          }}
        >
          {mode === "history"
            ? "History mode is configured. Archive API is not connected yet."
            : "Event runtime data is not connected yet."}
        </div>
      </div>
      {showBottomStatus ? renderStatus() : null}
    </div>
  );
}
