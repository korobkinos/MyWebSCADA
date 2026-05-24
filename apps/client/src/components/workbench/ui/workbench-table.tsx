import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type WorkbenchTableColumn<T> = {
  id: string;
  title: string;
  width?: number;
  minWidth?: number;
  render: (row: T) => ReactNode;
};

type WorkbenchTableProps<T> = {
  rows: T[];
  columns: WorkbenchTableColumn<T>[];
  getRowId: (row: T) => string;
  emptyText: string;
  selectedRowId?: string | null;
  selectedIds?: string[];
  onRowClick?: (row: T) => void;
  onToggleRow?: (row: T) => void;
  onToggleAllRows?: (checked: boolean) => void;
  columnStorageKey?: string;
  className?: string;
};

type ColumnWidthState = Record<string, number>;

const DEFAULT_COLUMN_WIDTH = 180;

function parseStoredColumnWidths(raw: string | null): ColumnWidthState {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: ColumnWidthState = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        next[key] = Math.round(value);
      }
    }
    return next;
  } catch {
    return {};
  }
}

function createDefaultColumnWidths<T>(columns: WorkbenchTableColumn<T>[]): ColumnWidthState {
  const next: ColumnWidthState = {};
  for (const column of columns) {
    next[column.id] = Math.max(column.minWidth ?? 120, Math.round(column.width ?? DEFAULT_COLUMN_WIDTH));
  }
  return next;
}

export function WorkbenchTable<T>({
  rows,
  columns,
  getRowId,
  emptyText,
  selectedRowId,
  selectedIds,
  onRowClick,
  onToggleRow,
  onToggleAllRows,
  columnStorageKey,
  className,
}: WorkbenchTableProps<T>) {
  const hasChecks = Array.isArray(selectedIds) && Boolean(onToggleRow);
  const selectedSet = new Set(selectedIds ?? []);
  const [columnWidths, setColumnWidths] = useState<ColumnWidthState>(() => {
    const defaults = createDefaultColumnWidths(columns);
    if (!columnStorageKey || typeof window === "undefined") {
      return defaults;
    }
    const stored = parseStoredColumnWidths(window.localStorage.getItem(columnStorageKey));
    return { ...defaults, ...stored };
  });
  const resizeStateRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setColumnWidths((prev) => {
      const defaults = createDefaultColumnWidths(columns);
      const merged: ColumnWidthState = {};
      for (const column of columns) {
        const fallback = defaults[column.id] ?? column.width ?? DEFAULT_COLUMN_WIDTH;
        merged[column.id] = Math.max(column.minWidth ?? 120, Math.round(prev[column.id] ?? fallback));
      }
      return merged;
    });
  }, [columns]);

  useEffect(() => {
    if (!columnStorageKey || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(columnStorageKey, JSON.stringify(columnWidths));
  }, [columnStorageKey, columnWidths]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent): void => {
      const active = resizeStateRef.current;
      if (!active) {
        return;
      }
      const column = columns.find((item) => item.id === active.id);
      const minWidth = column?.minWidth ?? 120;
      const nextWidth = Math.max(minWidth, Math.round(active.startWidth + (event.clientX - active.startX)));
      setColumnWidths((prev) => ({ ...prev, [active.id]: nextWidth }));
    };
    const onMouseUp = (): void => {
      resizeStateRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [columns]);

  const selectableRowIds = useMemo(() => rows.map((row) => getRowId(row)), [getRowId, rows]);
  const selectedCount = selectableRowIds.filter((id) => selectedSet.has(id)).length;
  const allSelected = selectableRowIds.length > 0 && selectedCount === selectableRowIds.length;
  const partiallySelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  const gridTemplateColumns = [
    hasChecks ? "36px" : "",
    ...columns.map((column) => `minmax(0, ${columnWidths[column.id] ?? column.width ?? DEFAULT_COLUMN_WIDTH}fr)`),
  ].filter(Boolean).join(" ");

  return (
    <div className={["workbench-table", className ?? ""].filter(Boolean).join(" ")}>
      <div className="workbench-table__row workbench-table__row--header" style={{ gridTemplateColumns }}>
        {hasChecks ? (
          <div className="workbench-table__cell workbench-table__cell--header workbench-table__cell--check">
            {onToggleAllRows ? (
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onToggleAllRows(event.target.checked)}
              />
            ) : null}
          </div>
        ) : null}
        {columns.map((column) => (
          <div key={column.id} className="workbench-table__cell workbench-table__cell--header" title={column.title}>
            {column.title}
            <span
              className="workbench-table__resize-handle"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const currentWidth = columnWidths[column.id] ?? column.width ?? DEFAULT_COLUMN_WIDTH;
                resizeStateRef.current = { id: column.id, startX: event.clientX, startWidth: currentWidth };
              }}
            />
          </div>
        ))}
      </div>
      {rows.map((row) => {
        const rowId = getRowId(row);
        const selected = selectedRowId === rowId;
        return (
          <div
            key={rowId}
            className={[
              "workbench-table__row",
              selected ? "workbench-table__row--selected" : "",
              onRowClick ? "workbench-table__row--clickable" : "",
            ].filter(Boolean).join(" ")}
            style={{ gridTemplateColumns }}
            onClick={() => onRowClick?.(row)}
          >
            {hasChecks ? (
              <div className="workbench-table__cell workbench-table__cell--check">
                <input
                  type="checkbox"
                  checked={selectedSet.has(rowId)}
                  onChange={() => onToggleRow?.(row)}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            ) : null}
            {columns.map((column) => (
              <div key={column.id} className="workbench-table__cell">
                {column.render(row)}
              </div>
            ))}
          </div>
        );
      })}
      {rows.length === 0 ? <div className="workbench-table__empty">{emptyText}</div> : null}
    </div>
  );
}
