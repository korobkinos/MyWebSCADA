import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { EventDefinition } from "@web-scada/shared";
import { WorkbenchButton } from "../components/workbench";
import { useScadaStore } from "../store/scada-store";

type EventColumnId =
  | "enabled"
  | "id"
  | "category"
  | "priority"
  | "source"
  | "condition"
  | "ack"
  | "sound"
  | "message";

type EventColumnConfig = {
  id: EventColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
};

type EventColumnVisibility = Record<EventColumnId, boolean>;

const EVENT_COLUMNS: EventColumnConfig[] = [
  { id: "enabled", title: "ON", defaultWidth: 60, minWidth: 44 },
  { id: "id", title: "ID", defaultWidth: 220, minWidth: 140 },
  { id: "category", title: "CATEGORY", defaultWidth: 140, minWidth: 110 },
  { id: "priority", title: "PRIORITY", defaultWidth: 90, minWidth: 76 },
  { id: "source", title: "SOURCE TAG", defaultWidth: 170, minWidth: 130 },
  { id: "condition", title: "CONDITION", defaultWidth: 170, minWidth: 130 },
  { id: "ack", title: "ACK", defaultWidth: 120, minWidth: 90 },
  { id: "sound", title: "SOUND", defaultWidth: 130, minWidth: 96 },
  { id: "message", title: "MESSAGE", defaultWidth: 360, minWidth: 170 },
];

const EVENTS_COLUMNS_WIDTH_STORAGE_KEY = "screenEditor.events.columnWidths";
const EVENTS_COLUMN_VISIBILITY_STORAGE_KEY = "screenEditor.events.columnVisibility";
const EVENTS_PAGE_SIZE_STORAGE_KEY = "screenEditor.events.pageSize";
const EVENTS_DETAILS_WIDTH_STORAGE_KEY = "screenEditor.events.detailsWidth";
const DEFAULT_PAGE_SIZE = 100;
const MIN_DETAILS_WIDTH = 260;
const MAX_DETAILS_WIDTH = 640;
const DEFAULT_DETAILS_WIDTH = 360;

function createDefaultColumnVisibility(): EventColumnVisibility {
  return EVENT_COLUMNS.reduce<EventColumnVisibility>(
    (acc, column) => ({ ...acc, [column.id]: true }),
    {
      enabled: true,
      id: true,
      category: true,
      priority: true,
      source: true,
      condition: true,
      ack: true,
      sound: true,
      message: true,
    },
  );
}

function createDefaultColumnWidths(): Record<EventColumnId, number> {
  return EVENT_COLUMNS.reduce<Record<EventColumnId, number>>(
    (acc, column) => ({ ...acc, [column.id]: column.defaultWidth }),
    {
      enabled: 0,
      id: 0,
      category: 0,
      priority: 0,
      source: 0,
      condition: 0,
      ack: 0,
      sound: 0,
      message: 0,
    },
  );
}

function parseStoredColumnWidths(raw: string | null): Record<EventColumnId, number> {
  const defaults = createDefaultColumnWidths();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<EventColumnId, unknown>>;
    return EVENT_COLUMNS.reduce<Record<EventColumnId, number>>((acc, column) => {
      const candidate = parsed[column.id];
      acc[column.id] =
        typeof candidate === "number" && Number.isFinite(candidate)
          ? Math.max(column.minWidth, candidate)
          : defaults[column.id];
      return acc;
    }, { ...defaults });
  } catch {
    return defaults;
  }
}

function parseStoredColumnVisibility(raw: string | null): EventColumnVisibility {
  const defaults = createDefaultColumnVisibility();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<EventColumnId, unknown>>;
    const next = EVENT_COLUMNS.reduce<EventColumnVisibility>((acc, column) => {
      acc[column.id] = parsed[column.id] === false ? false : true;
      return acc;
    }, { ...defaults });
    next.id = true;
    if (!Object.values(next).some(Boolean)) {
      next.id = true;
    }
    return next;
  } catch {
    return defaults;
  }
}

function parseStoredPageSize(raw: string | null): number {
  const parsed = Number(raw);
  return parsed === 50 || parsed === 100 || parsed === 200 || parsed === 500 ? parsed : DEFAULT_PAGE_SIZE;
}

function clampDetailsWidth(value: number): number {
  return Math.max(MIN_DETAILS_WIDTH, Math.min(MAX_DETAILS_WIDTH, value));
}

function formatCondition(event: EventDefinition): string {
  if (event.conditionMode === "bit") {
    return event.bitTrigger ? `bit ${event.bitTrigger}` : "bit -";
  }
  if (event.conditionMode === "word") {
    const op = event.wordOperator ?? "?";
    const value = typeof event.wordValue === "number" ? String(event.wordValue) : "-";
    return `word ${op} ${value}`;
  }
  return "-";
}

export function EventsPage() {
  const project = useScadaStore((s) => s.project);

  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "on" | "off">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PAGE_SIZE;
    }
    return parseStoredPageSize(window.localStorage.getItem(EVENTS_PAGE_SIZE_STORAGE_KEY));
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DETAILS_WIDTH;
    }
    const stored = Number(window.localStorage.getItem(EVENTS_DETAILS_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) ? clampDetailsWidth(stored) : DEFAULT_DETAILS_WIDTH;
  });
  const [isDetailsResizeActive, setIsDetailsResizeActive] = useState(false);
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<EventColumnVisibility>(() => {
    if (typeof window === "undefined") {
      return createDefaultColumnVisibility();
    }
    return parseStoredColumnVisibility(window.localStorage.getItem(EVENTS_COLUMN_VISIBILITY_STORAGE_KEY));
  });
  const [columnWidths, setColumnWidths] = useState<Record<EventColumnId, number>>(() => {
    if (typeof window === "undefined") {
      return createDefaultColumnWidths();
    }
    return parseStoredColumnWidths(window.localStorage.getItem(EVENTS_COLUMNS_WIDTH_STORAGE_KEY));
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);

  if (!project) {
    return (
      <div className="screen-editor-window-content screen-editor-tags-window">
        <div className="screen-editor-empty-state">Project is not loaded</div>
      </div>
    );
  }

  const events = project.events ?? [];
  const categories = project.eventCategories ?? [];
  const sounds = project.eventSounds ?? [];

  const categoryOptions = useMemo(
    () => categories.map((item) => ({ id: item.id, name: item.name || item.id })),
    [categories],
  );

  const soundNameById = useMemo(
    () => new Map(sounds.map((sound) => [sound.id, sound.name || sound.id])),
    [sounds],
  );

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((event) => {
      if (enabledFilter === "on" && event.enabled === false) {
        return false;
      }
      if (enabledFilter === "off" && event.enabled !== false) {
        return false;
      }
      if (categoryFilter !== "all") {
        const eventCategory = event.categoryId ?? event.categoryName ?? "";
        if (eventCategory !== categoryFilter) {
          return false;
        }
      }
      if (!term) {
        return true;
      }
      const fields = [
        event.id,
        event.categoryName ?? "",
        event.categoryId ?? "",
        event.message ?? "",
        event.sourceTagName ?? "",
        event.notificationTagName ?? "",
        event.ackTagName ?? "",
      ];
      return fields.some((field) => field.toLowerCase().includes(term));
    });
  }, [categoryFilter, enabledFilter, events, search]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EVENTS_COLUMNS_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EVENTS_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EVENTS_PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EVENTS_DETAILS_WIDTH_STORAGE_KEY, String(detailsWidth));
  }, [detailsWidth]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
    setPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [filteredEvents.length, pageSize]);

  const totalRows = filteredEvents.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = filteredEvents.slice(pageStart, pageStart + pageSize);
  const selectedEvent = filteredEvents.find((item) => item.id === selectedId) ?? pageRows[0] ?? null;

  const visibleColumns = EVENT_COLUMNS.filter((column) => columnVisibility[column.id] !== false);
  const eventGridTemplateColumns = visibleColumns
    .map((column) => `${Math.max(column.minWidth, columnWidths[column.id])}px`)
    .join(" ");

  const resetWidths = useCallback(() => {
    setDetailsWidth(DEFAULT_DETAILS_WIDTH);
    setColumnWidths(createDefaultColumnWidths());
  }, []);

  const startDetailsResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailsWidth;
    setIsDetailsResizeActive(true);
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = clampDetailsWidth(startWidth + delta);
      setDetailsWidth(next);
      bodyRef.current?.style.setProperty("--tags-details-width", `${next}px`);
    };
    const onUp = () => {
      setIsDetailsResizeActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [detailsWidth]);

  const startColumnResize = useCallback((event: ReactMouseEvent<HTMLSpanElement>, columnId: EventColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[columnId];
    const minWidth = EVENT_COLUMNS.find((column) => column.id === columnId)?.minWidth ?? 80;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      setColumnWidths((prev) => ({
        ...prev,
        [columnId]: Math.max(minWidth, startWidth + delta),
      }));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [columnWidths]);

  const selectedCategory = selectedEvent?.categoryName ?? selectedEvent?.categoryId ?? "-";
  const selectedSound = selectedEvent?.soundEnabled && selectedEvent?.soundId
    ? (soundNameById.get(selectedEvent.soundId) ?? selectedEvent.soundId)
    : "Off";
  const selectedAck = selectedEvent?.requireAck ? (selectedEvent.ackTagName ?? "Required") : "No";
  const selectedCondition = selectedEvent ? formatCondition(selectedEvent) : "-";

  return (
    <div className="screen-editor-window-content screen-editor-tags-window">
      <div className="screen-editor-tags-window__toolbar">
        <WorkbenchButton variant="primary" disabled>
          Add Event
        </WorkbenchButton>
        <WorkbenchButton disabled>
          Edit
        </WorkbenchButton>
        <WorkbenchButton variant="danger" disabled>
          Delete
        </WorkbenchButton>
        <WorkbenchButton onClick={resetWidths}>
          Reset Widths
        </WorkbenchButton>
        <WorkbenchButton onClick={() => setColumnsPanelOpen((open) => !open)}>
          Columns
        </WorkbenchButton>

        <input
          className="workbench-input screen-editor-tags-window__toolbar-input"
          value={search}
          placeholder="Search id / message / tag"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={enabledFilter}
          onChange={(event) => setEnabledFilter(event.target.value as "all" | "on" | "off")}
        >
          <option value="all">All states</option>
          <option value="on">Enabled</option>
          <option value="off">Disabled</option>
        </select>
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="all">All categories</option>
          {categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <div className="screen-editor-tags-window__toolbar-meta">
          Definitions: {events.length} | Categories: {categories.length} | Sounds: {sounds.length} | Filtered: {totalRows}
        </div>
      </div>

      {columnsPanelOpen ? (
        <div className="screen-editor-tags-columns-panel">
          {EVENT_COLUMNS.map((column) => (
            <label key={column.id} className="screen-editor-tags-column-toggle">
              <input
                type="checkbox"
                checked={columnVisibility[column.id] !== false}
                disabled={column.id === "id"}
                onChange={(event) =>
                  setColumnVisibility((prev) => ({
                    ...prev,
                    [column.id]: event.target.checked,
                    id: true,
                  }))}
              />
              <span>{column.title}</span>
            </label>
          ))}
        </div>
      ) : null}

      <div
        ref={bodyRef}
        className="screen-editor-tags-window__body"
        style={{ "--tags-details-width": `${detailsWidth}px` } as CSSProperties}
      >
        <div className="screen-editor-tags-window__list">
          <div className="screen-editor-tags-table">
            <div
              className="screen-editor-tags-row screen-editor-tags-row--header"
              style={{ gridTemplateColumns: eventGridTemplateColumns }}
            >
              {visibleColumns.map((column) => (
                <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell">
                  <span>{column.title}</span>
                  <span
                    className="screen-editor-tags-column-resize-handle"
                    onMouseDown={(event) => startColumnResize(event, column.id)}
                  />
                </div>
              ))}
            </div>
            {pageRows.map((event) => {
              const selected = selectedEvent?.id === event.id;
              const rowCells: Record<EventColumnId, string> = {
                enabled: event.enabled === false ? "OFF" : "ON",
                id: event.id,
                category: event.categoryName ?? event.categoryId ?? "-",
                priority: typeof event.priority === "number" ? String(event.priority) : "-",
                source: event.sourceTagName ?? "-",
                condition: formatCondition(event),
                ack: event.requireAck ? (event.ackTagName ?? "Required") : "No",
                sound: event.soundEnabled && event.soundId ? (soundNameById.get(event.soundId) ?? event.soundId) : "Off",
                message: event.message?.trim() || "-",
              };
              return (
                <div
                  key={event.id}
                  className={["screen-editor-tags-row", selected ? "screen-editor-tags-row--selected" : ""].filter(Boolean).join(" ")}
                  onClick={() => setSelectedId(event.id)}
                  style={{ gridTemplateColumns: eventGridTemplateColumns }}
                >
                  {visibleColumns.map((column) => {
                    const value = rowCells[column.id];
                    return (
                      <div key={column.id} className="screen-editor-tags-cell" title={value}>
                        {value}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {pageRows.length === 0 ? (
              <div className="screen-editor-empty-state">No events match the filters</div>
            ) : null}
          </div>
        </div>

        <div
          className={[
            "screen-editor-tags-resize-handle",
            isDetailsResizeActive ? "screen-editor-tags-resize-handle--active" : "",
          ].filter(Boolean).join(" ")}
          onMouseDown={startDetailsResize}
        />

        <div className="screen-editor-tags-window__details">
          <div className="screen-editor-tag-editor">
            <div className="screen-editor-tag-editor__title">Event Details</div>
            {selectedEvent ? (
              <>
                <div className="screen-editor-tag-editor__kv"><span>ID</span><strong>{selectedEvent.id}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Enabled</span><strong>{selectedEvent.enabled === false ? "No" : "Yes"}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Category</span><strong>{selectedCategory}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Priority</span><strong>{typeof selectedEvent.priority === "number" ? selectedEvent.priority : "-"}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Source Tag</span><strong>{selectedEvent.sourceTagName ?? "-"}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Condition</span><strong>{selectedCondition}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Acknowledgement</span><strong>{selectedAck}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Sound</span><strong>{selectedSound}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Message</span><strong>{selectedEvent.message?.trim() || "-"}</strong></div>
              </>
            ) : (
              <div className="screen-editor-empty-state">Select an event</div>
            )}
            <div className="screen-editor-tag-editor__hint">
              Event Manager scaffold is ready. Runtime processing and acknowledgements will be added in a future step.
            </div>
          </div>
        </div>
      </div>

      <div className="screen-editor-tags-pagination">
        <span>Rows: {totalRows} | Page {safePage} / {totalPages}</span>
        <WorkbenchButton disabled={safePage <= 1} onClick={() => setPage(1)}>First</WorkbenchButton>
        <WorkbenchButton disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Prev</WorkbenchButton>
        <WorkbenchButton disabled={safePage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>Next</WorkbenchButton>
        <WorkbenchButton disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>Last</WorkbenchButton>
        <select
          className="workbench-select screen-editor-tags-page-size"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
        </select>
      </div>
    </div>
  );
}
