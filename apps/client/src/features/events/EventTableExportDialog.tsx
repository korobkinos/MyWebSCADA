import { useEffect, useState } from "react";
import { TrendWorkbenchDialog } from "../trends/TrendWorkbenchDialog";
import { WorkbenchButton } from "../../components/workbench";

export type EventTableExportFormat = "csv" | "excel" | "pdf";
export type EventTableCsvDelimiter = "," | ";" | "\t";
export type EventTableCsvSource = "currentView" | "archiveQuery";
export type EventTablePdfOrientation = "portrait" | "landscape";

export type EventTableExportOptions = {
  format: EventTableExportFormat;
  includeHeaders: boolean;
  includeStatusLine: boolean;
  selectedOnly: boolean;
  csvDelimiter: EventTableCsvDelimiter;
  csvSource: EventTableCsvSource;
  pdfOrientation: EventTablePdfOrientation;
};

type EventTableExportDialogProps = {
  open: boolean;
  mode: "online" | "history";
  selectedCount: number;
  busy: boolean;
  onClose: () => void;
  onExport: (options: EventTableExportOptions) => void;
};

const DEFAULT_OPTIONS: EventTableExportOptions = {
  format: "csv",
  includeHeaders: true,
  includeStatusLine: false,
  selectedOnly: false,
  csvDelimiter: ",",
  csvSource: "archiveQuery",
  pdfOrientation: "landscape",
};

export function EventTableExportDialog({
  open,
  mode,
  selectedCount,
  busy,
  onClose,
  onExport,
}: EventTableExportDialogProps) {
  const [options, setOptions] = useState<EventTableExportOptions>(DEFAULT_OPTIONS);

  useEffect(() => {
    if (!open) {
      return;
    }
    setOptions((previous) => ({
      ...previous,
      csvSource: mode === "history" ? previous.csvSource : "currentView",
    }));
  }, [mode, open, selectedCount]);

  const canUseArchiveQuerySource = mode === "history" && !options.selectedOnly;

  return (
    <TrendWorkbenchDialog
      id="event-table-export-dialog"
      title="Export Messages"
      open={open}
      defaultRect={{ x: 260, y: 140, width: 620, height: 420 }}
      minWidth={560}
      minHeight={360}
      bodyClassName="event-table-export-dialog-body"
      footer={(
        <div className="event-table-export-dialog-footer">
          <WorkbenchButton onClick={onClose} disabled={busy}>Close</WorkbenchButton>
          <WorkbenchButton
            variant="primary"
            onClick={() => onExport(options)}
            disabled={busy}
          >
            Export
          </WorkbenchButton>
        </div>
      )}
      onClose={onClose}
    >
      <div className="event-table-export-dialog-fields">
        <label className="workbench-field">
          <span className="workbench-field__label">Format</span>
          <select
            className="workbench-select"
            value={options.format}
            onChange={(event) => setOptions((previous) => ({
              ...previous,
              format: event.target.value as EventTableExportFormat,
            }))}
          >
            <option value="csv">CSV</option>
            <option value="excel">Excel (.xls)</option>
            <option value="pdf">PDF (print)</option>
          </select>
        </label>

        <label className="screen-editor-settings-check">
          <input
            type="checkbox"
            checked={options.includeHeaders}
            onChange={(event) => setOptions((previous) => ({
              ...previous,
              includeHeaders: event.target.checked,
            }))}
          />
          <span>Include column headers</span>
        </label>

        <label className="screen-editor-settings-check">
          <input
            type="checkbox"
            checked={options.includeStatusLine}
            onChange={(event) => setOptions((previous) => ({
              ...previous,
              includeStatusLine: event.target.checked,
            }))}
          />
          <span>Include status summary</span>
        </label>

        <label className="screen-editor-settings-check">
          <input
            type="checkbox"
            checked={options.selectedOnly}
            onChange={(event) => setOptions((previous) => ({
              ...previous,
              selectedOnly: event.target.checked,
              csvSource: event.target.checked ? "currentView" : previous.csvSource,
            }))}
          />
          <span>{selectedCount > 0 ? `Export selected rows only (${selectedCount})` : "Export selected rows only (none selected)"}</span>
        </label>

        {options.format === "csv" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">CSV delimiter</span>
            <select
              className="workbench-select"
              value={options.csvDelimiter}
              onChange={(event) => setOptions((previous) => ({
                ...previous,
                csvDelimiter: event.target.value as EventTableCsvDelimiter,
              }))}
            >
              <option value=",">Comma (,)</option>
              <option value=";">Semicolon (;)</option>
              <option value="\t">Tab</option>
            </select>
          </label>
        ) : null}

        {options.format === "csv" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">CSV source</span>
            <select
              className="workbench-select"
              value={canUseArchiveQuerySource ? options.csvSource : "currentView"}
              disabled={!canUseArchiveQuerySource}
              onChange={(event) => setOptions((previous) => ({
                ...previous,
                csvSource: event.target.value as EventTableCsvSource,
              }))}
            >
              <option value="currentView">Current view</option>
              {mode === "history" ? <option value="archiveQuery">Archive query</option> : null}
            </select>
          </label>
        ) : null}

        {options.format === "pdf" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">PDF orientation</span>
            <select
              className="workbench-select"
              value={options.pdfOrientation}
              onChange={(event) => setOptions((previous) => ({
                ...previous,
                pdfOrientation: event.target.value as EventTablePdfOrientation,
              }))}
            >
              <option value="landscape">landscape</option>
              <option value="portrait">portrait</option>
            </select>
          </label>
        ) : null}
      </div>
    </TrendWorkbenchDialog>
  );
}
