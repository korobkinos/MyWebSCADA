import type { ReactNode } from "react";

export type WorkbenchTableColumn<T> = {
  id: string;
  title: string;
  width?: string;
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
  className?: string;
};

export function WorkbenchTable<T>({
  rows,
  columns,
  getRowId,
  emptyText,
  selectedRowId,
  selectedIds,
  onRowClick,
  onToggleRow,
  className,
}: WorkbenchTableProps<T>) {
  const hasChecks = Array.isArray(selectedIds) && Boolean(onToggleRow);
  const selectedSet = new Set(selectedIds ?? []);
  const gridTemplateColumns = [
    hasChecks ? "36px" : "",
    ...columns.map((column) => column.width ?? "minmax(120px, 1fr)"),
  ].filter(Boolean).join(" ");

  return (
    <div className={["workbench-table", className ?? ""].filter(Boolean).join(" ")}>
      <div className="workbench-table__row workbench-table__row--header" style={{ gridTemplateColumns }}>
        {hasChecks ? <div className="workbench-table__cell workbench-table__cell--header" /> : null}
        {columns.map((column) => (
          <div key={column.id} className="workbench-table__cell workbench-table__cell--header" title={column.title}>
            {column.title}
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
