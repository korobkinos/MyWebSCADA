import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { ColumnType, ColumnsType } from "antd/es/table";
import type { TableProps } from "antd";

type WidthMap = Record<string, number>;

export type ResizableColumn<T> = ColumnType<T> & {
  id: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  autoSize?: (row: T) => string;
  headerText?: string;
};

type ResizableHeaderCellProps = HTMLAttributes<HTMLTableCellElement> & {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  onResizeWidth?: (width: number) => void;
  onAutoSize?: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getFromDataIndex<T>(row: T, dataIndex: ColumnType<T>["dataIndex"]): unknown {
  if (!dataIndex) {
    return undefined;
  }
  if (Array.isArray(dataIndex)) {
    let current: unknown = row as unknown;
    for (const key of dataIndex) {
      if (typeof current !== "object" || current === null) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[String(key)];
    }
    return current;
  }
  if (typeof dataIndex === "string") {
    if (dataIndex.includes(".")) {
      return dataIndex.split(".").reduce<unknown>((acc, key) => {
        if (typeof acc !== "object" || acc === null) {
          return undefined;
        }
        return (acc as Record<string, unknown>)[key];
      }, row as unknown);
    }
    return (row as Record<string, unknown>)[dataIndex];
  }
  return (row as Record<string, unknown>)[String(dataIndex)];
}

function estimateTextWidth(text: string): number {
  // Approximation is enough for autosize and avoids expensive DOM measurements.
  return text.length * 8 + 24;
}

function toHeaderText<T>(value: ColumnType<T>["title"]): string {
  if (typeof value === "function") {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

export function ResizableHeaderCell({
  width,
  minWidth = 80,
  maxWidth = 2400,
  resizable = true,
  onResizeWidth,
  onAutoSize,
  style,
  children,
  ...rest
}: ResizableHeaderCellProps) {
  const mergedStyle: CSSProperties = {
    ...(style ?? {}),
    width,
    minWidth: width,
    maxWidth: width,
    position: "relative",
  };

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!resizable || !onResizeWidth) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = width ?? minWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      onResizeWidth(clamp(startWidth + delta, minWidth, maxWidth));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <th {...rest} style={mergedStyle}>
      <div style={{ position: "relative", height: "100%" }}>
        {children}
        {resizable ? (
          <div
            onMouseDown={startResize}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAutoSize?.();
            }}
            style={{
              position: "absolute",
              right: -4,
              top: 0,
              bottom: 0,
              width: 8,
              cursor: "col-resize",
              zIndex: 2,
            }}
          />
        ) : null}
      </div>
    </th>
  );
}

export function useResizableTableColumns<T>({
  tableId,
  columns,
  rows,
  maxAutoSizeRows = 150,
}: {
  tableId: string;
  columns: ResizableColumn<T>[];
  rows: T[];
  maxAutoSizeRows?: number;
}): {
  columns: ColumnsType<T>;
  components: TableProps<T>["components"];
} {
  const storageKey = `scada.table.columns.${tableId}`;
  const [widths, setWidths] = useState<WidthMap>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: WidthMap = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          out[key] = value;
        }
      }
      return out;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [storageKey, widths]);

  const setWidth = useCallback((id: string, width: number) => {
    setWidths((prev) => ({ ...prev, [id]: Math.round(width) }));
  }, []);

  const autoSizeColumn = useCallback((column: ResizableColumn<T>) => {
    const minWidth = column.minWidth ?? 80;
    const maxWidth = column.maxWidth ?? 2400;
    let max = estimateTextWidth(column.headerText ?? toHeaderText(column.title));
    const sampleRows = rows.slice(0, maxAutoSizeRows);
    for (const row of sampleRows) {
      const text = column.autoSize
        ? column.autoSize(row)
        : String(getFromDataIndex(row, column.dataIndex) ?? "");
      max = Math.max(max, estimateTextWidth(text));
    }
    setWidth(column.id, clamp(max + 16, minWidth, maxWidth));
  }, [maxAutoSizeRows, rows, setWidth]);

  const mappedColumns = useMemo<ColumnsType<T>>(() =>
    columns.map((column) => {
      const width = widths[column.id] ?? column.defaultWidth;
      const minWidth = column.minWidth ?? 80;
      const maxWidth = column.maxWidth ?? 2400;
      const canResize = column.resizable !== false;
      const existingHeaderCell = column.onHeaderCell;
      return {
        ...column,
        width,
        onHeaderCell: (item) => {
          const base = existingHeaderCell ? existingHeaderCell(item) : {};
          return {
            ...base,
            width,
            minWidth,
            maxWidth,
            resizable: canResize,
            onResizeWidth: (nextWidth: number) => setWidth(column.id, nextWidth),
            onAutoSize: () => autoSizeColumn(column),
          };
        },
      } satisfies ColumnType<T>;
    }),
  [autoSizeColumn, columns, setWidth, widths]);

  const components = useMemo<TableProps<T>["components"]>(() => ({
    header: {
      cell: ResizableHeaderCell,
    },
  }), []);

  return {
    columns: mappedColumns,
    components,
  };
}
