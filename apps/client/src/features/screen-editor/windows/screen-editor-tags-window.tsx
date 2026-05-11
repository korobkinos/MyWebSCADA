import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { InternalVariableDefinition, TagDefinition, TagSourceType } from "@web-scada/shared";
import { message } from "antd";
import { WorkbenchButton, WorkbenchTreeItem } from "../../../components/workbench";
import { useScadaStore } from "../../../store/scada-store";

type TagEditorMode = "view" | "add" | "edit";
type SourceFilter = "all" | TagSourceType;
type TagColumnId = "name" | "source" | "dataType" | "driver" | "address" | "group" | "writable";
type TagColumnConfig = {
  id: TagColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
};

const TAG_COLUMNS: TagColumnConfig[] = [
  { id: "name", title: "NAME", defaultWidth: 260, minWidth: 140 },
  { id: "source", title: "SOURCE", defaultWidth: 100, minWidth: 80 },
  { id: "dataType", title: "TYPE", defaultWidth: 90, minWidth: 70 },
  { id: "driver", title: "DRIVER", defaultWidth: 160, minWidth: 100 },
  { id: "address", title: "NODE / ADDRESS", defaultWidth: 320, minWidth: 160 },
  { id: "group", title: "GROUP", defaultWidth: 120, minWidth: 90 },
  { id: "writable", title: "W", defaultWidth: 60, minWidth: 44 },
];

const TAG_DETAILS_WIDTH_STORAGE_KEY = "screenEditor.tags.detailsWidth";
const TAG_COLUMNS_WIDTH_STORAGE_KEY = "screenEditor.tags.columnWidths";
const DEFAULT_DETAILS_WIDTH = 340;
const MIN_DETAILS_WIDTH = 260;
const MAX_DETAILS_WIDTH = 640;

function clampDetailsWidth(value: number): number {
  return Math.min(MAX_DETAILS_WIDTH, Math.max(MIN_DETAILS_WIDTH, value));
}

function createDefaultColumnWidths(): Record<TagColumnId, number> {
  return TAG_COLUMNS.reduce<Record<TagColumnId, number>>(
    (acc, column) => ({ ...acc, [column.id]: column.defaultWidth }),
    {
      name: 0,
      source: 0,
      dataType: 0,
      driver: 0,
      address: 0,
      group: 0,
      writable: 0,
    },
  );
}

function parseStoredColumnWidths(raw: string | null): Record<TagColumnId, number> {
  const defaults = createDefaultColumnWidths();
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<TagColumnId, unknown>>;
    return TAG_COLUMNS.reduce<Record<TagColumnId, number>>((acc, column) => {
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

const sourceTypeOptions: Array<{ label: string; value: TagSourceType }> = [
  { label: "OPC UA", value: "opcua" },
  { label: "LW", value: "lw" },
  { label: "Internal", value: "internal" },
  { label: "Computed", value: "computed" },
  { label: "Simulated", value: "simulated" },
  { label: "Modbus", value: "modbus" },
];

const dataTypeOptions: TagDefinition["dataType"][] = [
  "BOOL",
  "INT",
  "UINT",
  "DINT",
  "UDINT",
  "REAL",
  "STRING",
];

function createId(): string {
  return `tag_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function tagKey(tag: TagDefinition): string {
  return tag.id ?? tag.name;
}

function toOptionalNumber(raw: string): number | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  const next = Number(raw);
  return Number.isFinite(next) ? next : undefined;
}

function formatAddressCell(tag: TagDefinition): string {
  if (tag.nodeId) {
    return tag.nodeId;
  }
  if (typeof tag.lwAddress === "number") {
    return String(tag.lwAddress);
  }
  if (tag.internalVariableName) {
    return tag.internalVariableName;
  }
  if (tag.address && typeof tag.address === "object") {
    const raw = (tag.address as { raw?: unknown }).raw;
    return typeof raw === "string" ? raw : JSON.stringify(tag.address);
  }
  return "-";
}

function createDefaultDraft(): TagDefinition {
  return {
    id: createId(),
    name: "",
    description: "",
    sourceType: "opcua",
    dataType: "REAL",
    writable: false,
    scanRateMs: 500,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeDraft(draft: TagDefinition, isEditing: boolean): TagDefinition {
  const normalized: TagDefinition = {
    ...draft,
    id: draft.id ?? createId(),
    name: draft.name.trim(),
    sourceType: draft.sourceType ?? "simulated",
    dataType: draft.dataType ?? "REAL",
    description: draft.description?.trim() || undefined,
    group: draft.group?.trim() || undefined,
    unit: draft.unit?.trim() || undefined,
    createdAt: isEditing ? draft.createdAt ?? nowIso() : nowIso(),
    updatedAt: nowIso(),
  };

  const sourceType = normalized.sourceType ?? "simulated";

  if (sourceType !== "opcua") {
    normalized.driverId = undefined;
    normalized.nodeId = undefined;
  }
  if (sourceType !== "lw") {
    normalized.lwAddress = undefined;
    normalized.persistent = undefined;
  }
  if (sourceType !== "internal") {
    normalized.internalVariableName = undefined;
  }
  if (sourceType !== "simulated" && sourceType !== "modbus") {
    normalized.address = undefined;
  }

  return normalized;
}

export function ScreenEditorTagsWindow() {
  const project = useScadaStore((s) => s.project);
  const runtimeTags = useScadaStore((s) => s.tags);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const addVariable = useScadaStore((s) => s.addVariable);
  const macros = useScadaStore((s) => s.macros);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [driverFilter, setDriverFilter] = useState<string | "all">("all");
  const [groupFilter, setGroupFilter] = useState<string | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<TagEditorMode>("view");
  const [draftTag, setDraftTag] = useState<TagDefinition | null>(null);
  const [pendingDeleteTagId, setPendingDeleteTagId] = useState<string | null>(null);
  const [newVarName, setNewVarName] = useState("Counter1");
  const [newVarType, setNewVarType] = useState<InternalVariableDefinition["dataType"]>("REAL");
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DETAILS_WIDTH;
    }
    const saved = window.localStorage.getItem(TAG_DETAILS_WIDTH_STORAGE_KEY);
    const parsed = saved ? Number(saved) : Number.NaN;
    return Number.isFinite(parsed) ? clampDetailsWidth(parsed) : DEFAULT_DETAILS_WIDTH;
  });
  const [columnWidths, setColumnWidths] = useState<Record<TagColumnId, number>>(() => {
    if (typeof window === "undefined") {
      return createDefaultColumnWidths();
    }
    return parseStoredColumnWidths(window.localStorage.getItem(TAG_COLUMNS_WIDTH_STORAGE_KEY));
  });
  const [isDetailsResizeActive, setIsDetailsResizeActive] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  if (!project) {
    return (
      <div className="screen-editor-window-content screen-editor-tags-window">
        <div className="screen-editor-empty-state">Project is not loaded</div>
      </div>
    );
  }

  const tags = project.tags ?? [];
  const drivers = project.drivers ?? [];
  const internalVariables = project.variables ?? [];
  const macrosToShow = macros.length > 0 ? macros : project.macros ?? [];

  const groupOptions = useMemo(
    () => [...new Set(tags.map((tag) => tag.group).filter((value): value is string => Boolean(value)))],
    [tags],
  );

  const filteredTags = useMemo(
    () =>
      tags.filter((tag) => {
        if (search.trim()) {
          const term = search.trim().toLowerCase();
          const hit =
            tag.name.toLowerCase().includes(term) ||
            (tag.description ?? "").toLowerCase().includes(term) ||
            (tag.nodeId ?? "").toLowerCase().includes(term);
          if (!hit) {
            return false;
          }
        }
        if (sourceFilter !== "all" && (tag.sourceType ?? "simulated") !== sourceFilter) {
          return false;
        }
        if (driverFilter !== "all" && (tag.driverId ?? "") !== driverFilter) {
          return false;
        }
        if (groupFilter !== "all" && (tag.group ?? "") !== groupFilter) {
          return false;
        }
        return true;
      }),
    [driverFilter, groupFilter, search, sourceFilter, tags],
  );

  const selectedTag = tags.find((tag) => tagKey(tag) === selectedId) ?? filteredTags[0] ?? null;
  const sourceType = draftTag?.sourceType ?? "simulated";
  const editorDriverOptions = drivers.filter((driver) => {
    if (sourceType === "opcua") {
      return driver.type === "opcua";
    }
    if (sourceType === "simulated") {
      return driver.type === "simulated";
    }
    return false;
  });

  const saveTags = (nextTags: TagDefinition[]): void => {
    updateProjectJson({
      ...project,
      tags: nextTags,
    });
  };

  const openAdd = (): void => {
    setDraftTag(createDefaultDraft());
    setEditingId(null);
    setEditorMode("add");
    setPendingDeleteTagId(null);
  };

  const openEdit = (tag: TagDefinition): void => {
    const key = tagKey(tag);
    setSelectedId(key);
    setEditingId(key);
    setDraftTag(structuredClone(tag));
    setEditorMode("edit");
    setPendingDeleteTagId(null);
  };

  const cancelEditor = (): void => {
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
  };

  const applySaveDraft = (): void => {
    if (!draftTag) {
      return;
    }
    const normalized = normalizeDraft(draftTag, editorMode === "edit");

    if (!normalized.name) {
      void message.error("Tag name is required");
      return;
    }

    if (normalized.sourceType === "opcua" && (!normalized.driverId || !normalized.nodeId?.trim())) {
      void message.error("OPC UA tag requires driver and NodeId");
      return;
    }
    if (normalized.sourceType === "lw" && typeof normalized.lwAddress !== "number") {
      void message.error("LW tag requires LW Address");
      return;
    }
    if (normalized.sourceType === "internal" && !normalized.internalVariableName?.trim()) {
      void message.error("Internal tag requires Internal Variable Name");
      return;
    }

    const duplicate = tags.some(
      (tag) =>
        tag.name === normalized.name &&
        tagKey(tag) !== (editingId ?? ""),
    );
    if (duplicate) {
      void message.error("Tag name must be unique");
      return;
    }

    const nextTags =
      editorMode === "edit" && editingId
        ? tags.map((tag) => (tagKey(tag) === editingId ? normalized : tag))
        : [...tags, normalized];

    saveTags(nextTags);
    setSelectedId(tagKey(normalized));
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
    setPendingDeleteTagId(null);
  };

  const requestDeleteSelected = (): void => {
    if (!selectedTag) {
      return;
    }
    setPendingDeleteTagId(tagKey(selectedTag));
  };

  const confirmDelete = (): void => {
    if (!pendingDeleteTagId) {
      return;
    }
    const nextTags = tags.filter((tag) => tagKey(tag) !== pendingDeleteTagId);
    saveTags(nextTags);
    setPendingDeleteTagId(null);
    if (selectedId === pendingDeleteTagId) {
      const nextSelected = nextTags[0];
      setSelectedId(nextSelected ? tagKey(nextSelected) : null);
    }
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
  };

  const duplicateTag = (tag: TagDefinition): void => {
    let nextName = `${tag.name}_copy`;
    let suffix = 1;
    while (tags.some((item) => item.name === nextName)) {
      suffix += 1;
      nextName = `${tag.name}_copy_${suffix}`;
    }
    const duplicated: TagDefinition = {
      ...tag,
      id: createId(),
      name: nextName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const nextTags = [...tags, duplicated];
    saveTags(nextTags);
    setSelectedId(tagKey(duplicated));
  };

  const exportCsv = (): void => {
    const header = [
      "name",
      "description",
      "sourceType",
      "dataType",
      "driverId",
      "nodeId",
      "area",
      "address",
      "bit",
      "scale",
      "offset",
      "unit",
      "writable",
      "scanRateMs",
      "group",
      "internalVariableName",
      "lwAddress",
      "persistent",
    ];
    const rows = tags.map((tag) => [
      tag.name,
      tag.description ?? "",
      tag.sourceType ?? "simulated",
      tag.dataType,
      tag.driverId ?? "",
      tag.nodeId ?? "",
      tag.area ?? "",
      tag.address ? JSON.stringify(tag.address) : tag.lwAddress ?? tag.internalVariableName ?? "",
      tag.bit ?? "",
      tag.scale ?? "",
      tag.offset ?? "",
      tag.unit ?? "",
      tag.writable ? "1" : "0",
      tag.scanRateMs ?? "",
      tag.group ?? "",
      tag.internalVariableName ?? "",
      tag.lwAddress ?? "",
      tag.persistent ? "1" : "0",
    ]);

    const csv = [header, ...rows]
      .map((line) =>
        line
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tags.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (!lines.length) {
        return;
      }
      const headers = parseCsv(lines[0] ?? "").map((header) => header.trim());
      const rows = lines.slice(1).map((line) => parseCsv(line));
      const imported = rows
        .map((cells): TagDefinition => {
          const map = new Map<string, string>();
          headers.forEach((header, index) => {
            map.set(header, cells[index] ?? "");
          });
          const sourceType = (map.get("sourceType") as TagSourceType | undefined) ?? "simulated";
          const lwAddressRaw = map.get("lwAddress") ?? map.get("address");
          const lwAddress = lwAddressRaw ? Number(lwAddressRaw) : undefined;
          const internalFromCell = map.get("internalVariableName") || (sourceType === "internal" ? map.get("address") : undefined);
          return {
            id: createId(),
            name: map.get("name")?.trim() ?? "",
            description: map.get("description") || undefined,
            sourceType,
            dataType: (map.get("dataType") as TagDefinition["dataType"]) ?? "REAL",
            driverId: map.get("driverId") || undefined,
            nodeId: map.get("nodeId") || undefined,
            area: (map.get("area") as TagDefinition["area"]) || undefined,
            address:
              sourceType === "modbus" || sourceType === "simulated"
                ? parseAddressCell(map.get("address"))
                : undefined,
            bit: map.get("bit") ? Number(map.get("bit")) : undefined,
            scale: map.get("scale") ? Number(map.get("scale")) : undefined,
            offset: map.get("offset") ? Number(map.get("offset")) : undefined,
            unit: map.get("unit") || undefined,
            writable: map.get("writable") === "1" || map.get("writable")?.toLowerCase() === "true",
            scanRateMs: map.get("scanRateMs") ? Number(map.get("scanRateMs")) : undefined,
            group: map.get("group") || undefined,
            lwAddress: Number.isFinite(lwAddress) ? lwAddress : undefined,
            internalVariableName: internalFromCell || undefined,
            persistent: map.get("persistent") === "1" || map.get("persistent")?.toLowerCase() === "true",
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
        })
        .filter((tag) => tag.name);

      saveTags(imported);
      setSelectedId(imported[0] ? tagKey(imported[0]) : null);
      cancelEditor();
      setPendingDeleteTagId(null);
      void message.success(`Imported ${imported.length} tags`);
    };
    reader.readAsText(file);
  };

  const onImportClick = (): void => {
    importInputRef.current?.click();
  };

  const addInternalVariable = (): void => {
    const name = newVarName.trim();
    if (!name) {
      void message.error("Variable name is required");
      return;
    }
    if (internalVariables.some((item) => item.name === name)) {
      void message.error("Internal variable name must be unique");
      return;
    }
    addVariable(name, newVarType, newVarType === "BOOL" ? false : 0);
    setNewVarName("");
  };

  const tagGridTemplateColumns = useMemo(
    () => TAG_COLUMNS.map((column) => `${columnWidths[column.id] ?? column.defaultWidth}px`).join(" "),
    [columnWidths],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TAG_DETAILS_WIDTH_STORAGE_KEY, String(detailsWidth));
  }, [detailsWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TAG_COLUMNS_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const startDetailsResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = detailsWidth;

    const onMove = (moveEvent: MouseEvent): void => {
      const delta = startX - moveEvent.clientX;
      setDetailsWidth(clampDetailsWidth(startWidth + delta));
    };

    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDetailsResizeActive(false);
    };

    setIsDetailsResizeActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [detailsWidth]);

  const startColumnResize = useCallback((
    event: React.MouseEvent<HTMLSpanElement>,
    columnId: TagColumnId,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const column = TAG_COLUMNS.find((item) => item.id === columnId);
    if (!column) {
      return;
    }

    const startX = event.clientX;
    const startWidth = columnWidths[columnId] ?? column.defaultWidth;

    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(column.minWidth, startWidth + delta);
      setColumnWidths((prev) => ({
        ...prev,
        [columnId]: next,
      }));
    };

    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [columnWidths]);

  const resetWidths = useCallback(() => {
    setDetailsWidth(DEFAULT_DETAILS_WIDTH);
    setColumnWidths(createDefaultColumnWidths());
  }, []);

  return (
    <div className="screen-editor-window-content screen-editor-tags-window">
      <div className="screen-editor-tags-window__toolbar">
        <WorkbenchButton variant="primary" onClick={openAdd}>
          Add Tag
        </WorkbenchButton>
        <WorkbenchButton
          onClick={() => selectedTag && duplicateTag(selectedTag)}
          disabled={!selectedTag}
        >
          Duplicate
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={requestDeleteSelected}
          disabled={!selectedTag}
        >
          Delete
        </WorkbenchButton>
        <WorkbenchButton onClick={exportCsv} disabled={tags.length === 0}>
          Export CSV
        </WorkbenchButton>
        <WorkbenchButton onClick={onImportClick}>
          Import CSV
        </WorkbenchButton>
        <WorkbenchButton onClick={() => void saveProject()}>
          Save Project
        </WorkbenchButton>
        <WorkbenchButton onClick={resetWidths}>
          Reset Widths
        </WorkbenchButton>

        <input
          ref={importInputRef}
          hidden
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              return;
            }
            if (!window.confirm("Import CSV replaces current tags. Continue?")) {
              return;
            }
            importCsv(file);
          }}
        />

        <input
          className="workbench-input screen-editor-tags-window__toolbar-input"
          value={search}
          placeholder="Search name / description / nodeId"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
        >
          <option value="all">All sources</option>
          {sourceTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={driverFilter}
          onChange={(event) => setDriverFilter(event.target.value)}
        >
          <option value="all">All drivers</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {(driver.name ?? driver.id)} ({driver.type})
            </option>
          ))}
        </select>
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
        >
          <option value="all">All groups</option>
          {groupOptions.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        <div className="screen-editor-tags-window__toolbar-meta">
          Total: {tags.length} | Filtered: {filteredTags.length} | Runtime: {Object.keys(runtimeTags).length}
        </div>
      </div>

      <div
        className="screen-editor-tags-window__body"
        style={{ "--screen-editor-tags-details-width": `${detailsWidth}px` } as CSSProperties}
      >
        <div className="screen-editor-tags-window__list">
          <div className="screen-editor-tags-table">
            <div
              className="screen-editor-tags-row screen-editor-tags-row--header"
              style={{ gridTemplateColumns: tagGridTemplateColumns }}
            >
              {TAG_COLUMNS.map((column) => (
                <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell">
                  <span>{column.title}</span>
                  <span
                    className="screen-editor-tags-column-resize-handle"
                    onMouseDown={(event) => startColumnResize(event, column.id)}
                  />
                </div>
              ))}
            </div>
            {filteredTags.map((tag) => {
              const key = tagKey(tag);
              const selected = selectedTag ? tagKey(selectedTag) === key : false;
              const address = formatAddressCell(tag);
              const rowCells: Record<TagColumnId, string> = {
                name: tag.name,
                source: tag.sourceType ?? "simulated",
                dataType: tag.dataType,
                driver: tag.driverId ?? "-",
                address,
                group: tag.group ?? "-",
                writable: tag.writable ? "Y" : "N",
              };
              return (
                <div
                  key={key}
                  className={[
                    "screen-editor-tags-row",
                    selected ? "screen-editor-tags-row--selected" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelectedId(key);
                    if (editorMode === "add") {
                      cancelEditor();
                    }
                  }}
                  onDoubleClick={() => openEdit(tag)}
                  style={{ gridTemplateColumns: tagGridTemplateColumns }}
                >
                  {TAG_COLUMNS.map((column) => {
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
            {filteredTags.length === 0 ? (
              <div className="screen-editor-empty-state">No tags match the filters</div>
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
            {editorMode !== "view" && draftTag ? (
              <>
                <div className="screen-editor-tag-editor__title">
                  {editorMode === "add" ? "Add Tag" : "Edit Tag"}
                </div>

                <label className="workbench-field">
                  <span className="workbench-field__label">Name</span>
                  <input
                    className="workbench-input"
                    value={draftTag.name}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Description</span>
                  <input
                    className="workbench-input"
                    value={draftTag.description ?? ""}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Source Type</span>
                  <select
                    className="workbench-select"
                    value={draftTag.sourceType ?? "simulated"}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            sourceType: event.target.value as TagSourceType,
                          }
                          : prev,
                      )}
                  >
                    {sourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Data Type</span>
                  <select
                    className="workbench-select"
                    value={draftTag.dataType}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            dataType: event.target.value as TagDefinition["dataType"],
                          }
                          : prev,
                      )}
                  >
                    {dataTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                {sourceType === "opcua" ? (
                  <>
                    <label className="workbench-field">
                      <span className="workbench-field__label">OPC UA Driver</span>
                      <select
                        className="workbench-select"
                        value={draftTag.driverId ?? ""}
                        onChange={(event) =>
                          setDraftTag((prev) => (prev ? { ...prev, driverId: event.target.value || undefined } : prev))}
                      >
                        <option value="">Select driver</option>
                        {editorDriverOptions.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name ?? driver.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">NodeId</span>
                      <input
                        className="workbench-input"
                        value={draftTag.nodeId ?? ""}
                        onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, nodeId: event.target.value } : prev))}
                      />
                    </label>
                  </>
                ) : null}

                {sourceType === "lw" ? (
                  <>
                    <label className="workbench-field">
                      <span className="workbench-field__label">LW Address</span>
                      <input
                        className="workbench-input"
                        type="number"
                        min={0}
                        value={draftTag.lwAddress ?? ""}
                        onChange={(event) =>
                          setDraftTag((prev) =>
                            prev
                              ? {
                                ...prev,
                                lwAddress: toOptionalNumber(event.target.value),
                              }
                              : prev,
                          )}
                      />
                    </label>
                    <label className="screen-editor-tags-checkbox-field">
                      <input
                        type="checkbox"
                        checked={Boolean(draftTag.persistent)}
                        onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, persistent: event.target.checked } : prev))}
                      />
                      <span>Persistent</span>
                    </label>
                  </>
                ) : null}

                {sourceType === "internal" ? (
                  <label className="workbench-field">
                    <span className="workbench-field__label">Internal Variable Name</span>
                    <input
                      className="workbench-input"
                      value={draftTag.internalVariableName ?? ""}
                      onChange={(event) =>
                        setDraftTag((prev) => (prev ? { ...prev, internalVariableName: event.target.value } : prev))}
                    />
                  </label>
                ) : null}

                {(sourceType === "simulated" || sourceType === "modbus") ? (
                  <label className="workbench-field">
                    <span className="workbench-field__label">Address (raw)</span>
                    <input
                      className="workbench-input"
                      value={(draftTag.address as { raw?: string } | undefined)?.raw ?? ""}
                      onChange={(event) =>
                        setDraftTag((prev) =>
                          prev
                            ? {
                              ...prev,
                              address: event.target.value.trim() ? { raw: event.target.value } : undefined,
                            }
                            : prev,
                        )}
                    />
                  </label>
                ) : null}

                <label className="workbench-field">
                  <span className="workbench-field__label">Group</span>
                  <input
                    className="workbench-input"
                    value={draftTag.group ?? ""}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, group: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Unit</span>
                  <input
                    className="workbench-input"
                    value={draftTag.unit ?? ""}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, unit: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Scan Rate (ms)</span>
                  <input
                    className="workbench-input"
                    type="number"
                    min={50}
                    value={draftTag.scanRateMs ?? ""}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            scanRateMs: toOptionalNumber(event.target.value),
                          }
                          : prev,
                      )}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Scale</span>
                  <input
                    className="workbench-input"
                    type="number"
                    value={draftTag.scale ?? ""}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            scale: toOptionalNumber(event.target.value),
                          }
                          : prev,
                      )}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Offset</span>
                  <input
                    className="workbench-input"
                    type="number"
                    value={draftTag.offset ?? ""}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            offset: toOptionalNumber(event.target.value),
                          }
                          : prev,
                      )}
                  />
                </label>

                <label className="screen-editor-tags-checkbox-field">
                  <input
                    type="checkbox"
                    checked={Boolean(draftTag.writable)}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, writable: event.target.checked } : prev))}
                  />
                  <span>Writable</span>
                </label>

                <div className="screen-editor-tag-editor-actions">
                  <WorkbenchButton variant="primary" onClick={applySaveDraft}>
                    Save
                  </WorkbenchButton>
                  <WorkbenchButton onClick={cancelEditor}>
                    Cancel
                  </WorkbenchButton>
                </div>
              </>
            ) : selectedTag ? (
              <>
                <div className="screen-editor-tag-editor__title">Tag Details</div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Name</span>
                  <strong>{selectedTag.name}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Source</span>
                  <strong>{selectedTag.sourceType ?? "simulated"}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Data Type</span>
                  <strong>{selectedTag.dataType}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Driver</span>
                  <strong>{selectedTag.driverId ?? "-"}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Address</span>
                  <strong>{formatAddressCell(selectedTag)}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Group</span>
                  <strong>{selectedTag.group ?? "-"}</strong>
                </div>
                <div className="screen-editor-tag-editor-actions">
                  <WorkbenchButton onClick={() => openEdit(selectedTag)}>Edit</WorkbenchButton>
                  <WorkbenchButton onClick={() => duplicateTag(selectedTag)}>Duplicate</WorkbenchButton>
                  <WorkbenchButton variant="danger" onClick={requestDeleteSelected}>Delete</WorkbenchButton>
                </div>
              </>
            ) : (
              <div className="screen-editor-empty-state">Select tag</div>
            )}

            {pendingDeleteTagId && selectedTag && pendingDeleteTagId === tagKey(selectedTag) ? (
              <div className="screen-editor-tags-inline-confirm">
                <div className="screen-editor-tags-inline-confirm__title">
                  Delete {selectedTag.name}?
                </div>
                <div className="screen-editor-tags-inline-confirm__actions">
                  <WorkbenchButton onClick={() => setPendingDeleteTagId(null)}>Cancel</WorkbenchButton>
                  <WorkbenchButton variant="danger" onClick={confirmDelete}>Delete</WorkbenchButton>
                </div>
              </div>
            ) : null}
          </div>

          <div className="screen-editor-tags-side-section">
            <div className="screen-editor-tags-side-section__title">
              Internal Variables (LW)
            </div>
            <div className="screen-editor-tags-side-section__controls">
              <input
                className="workbench-input"
                value={newVarName}
                onChange={(event) => setNewVarName(event.target.value)}
                placeholder="Variable name"
              />
              <select
                className="workbench-select"
                value={newVarType}
                onChange={(event) => setNewVarType(event.target.value as InternalVariableDefinition["dataType"])}
              >
                <option value="BOOL">BOOL</option>
                <option value="INT">INT</option>
                <option value="DINT">DINT</option>
                <option value="REAL">REAL</option>
                <option value="STRING">STRING</option>
              </select>
              <WorkbenchButton onClick={addInternalVariable}>
                Add
              </WorkbenchButton>
            </div>
            <div className="screen-editor-tags-side-section__list">
              {internalVariables.length === 0 ? (
                <div className="screen-editor-empty-state">No variables</div>
              ) : (
                internalVariables.slice(0, 100).map((variable) => (
                  <WorkbenchTreeItem key={variable.name}>
                    <span>{variable.name} ({variable.dataType})</span>
                  </WorkbenchTreeItem>
                ))
              )}
            </div>
          </div>

          <div className="screen-editor-tags-side-section">
            <div className="screen-editor-tags-side-section__title">Macros</div>
            <div className="screen-editor-tags-side-section__list">
              {macrosToShow.length === 0 ? (
                <div className="screen-editor-empty-state">No macros</div>
              ) : (
                macrosToShow.map((macro) => (
                  <WorkbenchTreeItem key={macro.id}>
                    <span className="screen-editor-tag-macro-row">
                      <span>{macro.name}</span>
                      <span
                        className={[
                          "screen-editor-tag-macro-badge",
                          macro.enabled ?? true ? "screen-editor-tag-macro-badge--enabled" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {macro.enabled ?? true ? "EN" : "DIS"}
                      </span>
                    </span>
                  </WorkbenchTreeItem>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseAddressCell(value: string | undefined): TagDefinition["address"] {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as TagDefinition["address"];
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // plain text address
  }
  return { raw: value };
}
