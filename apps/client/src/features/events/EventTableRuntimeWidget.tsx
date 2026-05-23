import type { EventTableObject } from "@web-scada/shared";

type EventTableRuntimeWidgetProps = {
  object: EventTableObject;
};

const DEFAULT_COLUMNS = ["timestamp", "priority", "category", "message", "source", "ack"];

export function EventTableRuntimeWidget({ object }: EventTableRuntimeWidgetProps) {
  const title = object.title?.trim() || "Event Table";
  const columns = (object.columns ?? DEFAULT_COLUMNS).slice(0, 6);
  const textColor = object.textColor ?? "#d4d4d4";
  const backgroundColor = object.backgroundColor ?? "#1e1e1e";
  const headerBackgroundColor = object.headerBackgroundColor ?? "#2d2d30";
  const borderColor = object.borderColor ?? "#3c3c3c";
  const fontSize = Math.max(10, Math.min(24, Number(object.fontSize ?? 12)));
  const rowHeight = Math.max(20, Math.min(60, Number(object.rowHeight ?? 28)));
  const mode = object.mode ?? (object.enableHistoryMode ? "history" : "online");
  const historyPreset = object.historyPeriodPreset ?? "lastHour";
  const pageSize = Math.max(1, Math.round(object.pageSize ?? 50));

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${borderColor}`,
        background: backgroundColor,
        color: textColor,
        boxSizing: "border-box",
        fontFamily: "Consolas, monospace",
        fontSize,
        overflow: "hidden",
      }}
    >
      {object.showHeader !== false ? (
        <div
          style={{
            height: rowHeight,
            minHeight: rowHeight,
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            background: headerBackgroundColor,
            borderBottom: `1px solid ${borderColor}`,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      ) : null}
      {object.showToolbar !== false ? (
        <div
          style={{
            height: rowHeight,
            minHeight: rowHeight,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            borderBottom: `1px solid ${borderColor}`,
            opacity: 0.9,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span>Active: {object.showActiveOnly !== false ? "On" : "Off"}</span>
          <span>Unacked: {object.showUnacknowledgedOnly === true ? "On" : "Off"}</span>
          <span>Rows: {Math.max(1, Math.round(object.maxRows ?? 100))}</span>
          <span>Mode: {mode}</span>
          {mode === "history" && object.showHistoryToolbar !== false ? (
            <>
              <span>Range: {historyPreset}</span>
              <span>Page: {pageSize}</span>
            </>
          ) : null}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(40px, 1fr))`,
            alignItems: "center",
            minHeight: rowHeight,
            background: headerBackgroundColor,
            borderBottom: `1px solid ${borderColor}`,
            fontWeight: 600,
          }}
        >
          {columns.map((column) => (
            <div
              key={column}
              style={{
                padding: "0 8px",
                borderRight: object.showGridLines === false ? "none" : `1px solid ${borderColor}`,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {column}
            </div>
          ))}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.72,
            textAlign: "center",
            padding: 12,
          }}
        >
          {mode === "history"
            ? "History mode is configured, archive API is not connected yet."
            : "Event runtime data is not connected yet."}
        </div>
      </div>
    </div>
  );
}
