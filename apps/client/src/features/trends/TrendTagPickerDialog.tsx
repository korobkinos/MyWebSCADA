import { type CSSProperties, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, Input, Space } from "antd";
import { WorkbenchButton } from "../../components/workbench";
import type { TrendAxisConfig, TrendTagInfo, TrendTagPickerFilters, TrendTagSelection } from "./trendTypes";
import { TREND_DEFAULT_AXIS_ID, formatTrendArchivePolicy, getSparseTrendArchivePolicyWarning, pickSeriesColor } from "./trendUtils";
import { TrendWorkbenchDialog } from "./TrendWorkbenchDialog";

type TrendTagPickerDialogProps = {
  open: boolean;
  tags: TrendTagInfo[];
  selectedTags: TrendTagSelection[];
  axes: TrendAxisConfig[];
  initialFilters?: TrendTagPickerFilters;
  onClose: () => void;
  onApply: (nextTags: TrendTagSelection[], nextAxes: TrendAxisConfig[]) => void;
  onFiltersChange?: (next: TrendTagPickerFilters) => void;
};

const TREND_TAG_PICKER_DETAILS_WIDTH_STORAGE_KEY = "mywebscada.trends.tagPicker.detailsWidth";
const TREND_TAG_PICKER_COLUMNS_WIDTH_STORAGE_KEY = "mywebscada.trends.tagPicker.columnsWidth";
const DEFAULT_DETAILS_WIDTH = 360;
const MIN_DETAILS_WIDTH = 300;
const MAX_DETAILS_WIDTH = 760;
const TAG_PICKER_COLUMNS = [
  { id: "sel", label: "", width: 34, min: 30 },
  { id: "tag", label: "TAG", width: 320, min: 180 },
  { id: "unit", label: "UNIT", width: 90, min: 70 },
  { id: "type", label: "TYPE", width: 90, min: 70 },
  { id: "group", label: "GROUP", width: 120, min: 90 },
] as const;
type TagPickerColumnId = (typeof TAG_PICKER_COLUMNS)[number]["id"];
type TagPickerColumnWidths = Record<TagPickerColumnId, number>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePickerColor(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const body = trimmed.slice(1);
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return fallback;
}

function defaultTagPickerColumnWidths(): TagPickerColumnWidths {
  return TAG_PICKER_COLUMNS.reduce<TagPickerColumnWidths>((acc, column) => {
    acc[column.id] = column.width;
    return acc;
  }, {} as TagPickerColumnWidths);
}

function nextManualAxisId(existingAxes: TrendAxisConfig[]): string {
  const used = new Set(existingAxes.map((axis) => axis.id));
  let index = existingAxes.length + 1;
  while (used.has(`axis:manual:${index}`)) {
    index += 1;
  }
  return `axis:manual:${index}`;
}

export function TrendTagPickerDialog({ open, tags, selectedTags, axes, initialFilters, onClose, onApply, onFiltersChange }: TrendTagPickerDialogProps) {
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [groupFilter, setGroupFilter] = useState<string>(initialFilters?.groupFilter ?? "all");
  const [driverFilter, setDriverFilter] = useState<string>(initialFilters?.driverFilter ?? "all");
  const [selectionFilter, setSelectionFilter] = useState<TrendTagPickerFilters["selectionFilter"]>(initialFilters?.selectionFilter ?? "all");
  const [selectedTagName, setSelectedTagName] = useState<string>("");
  const [selectedRowNames, setSelectedRowNames] = useState<Set<string>>(() => new Set());
  const [draftTags, setDraftTags] = useState<TrendTagSelection[]>(selectedTags);
  const [draftAxes, setDraftAxes] = useState<TrendAxisConfig[]>(axes);
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DETAILS_WIDTH;
    }
    try {
      const raw = window.localStorage.getItem(TREND_TAG_PICKER_DETAILS_WIDTH_STORAGE_KEY);
      if (!raw) {
        return DEFAULT_DETAILS_WIDTH;
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? clamp(parsed, MIN_DETAILS_WIDTH, MAX_DETAILS_WIDTH) : DEFAULT_DETAILS_WIDTH;
    } catch {
      return DEFAULT_DETAILS_WIDTH;
    }
  });
  const [isDetailsResizeActive, setIsDetailsResizeActive] = useState(false);
  const [columnWidths, setColumnWidths] = useState<TagPickerColumnWidths>(() => {
    const fallback = defaultTagPickerColumnWidths();
    if (typeof window === "undefined") {
      return fallback;
    }
    try {
      const raw = window.localStorage.getItem(TREND_TAG_PICKER_COLUMNS_WIDTH_STORAGE_KEY);
      if (!raw) {
        return fallback;
      }
      const parsed = JSON.parse(raw) as Partial<Record<TagPickerColumnId, unknown>>;
      const next = { ...fallback };
      for (const column of TAG_PICKER_COLUMNS) {
        const value = Number(parsed[column.id]);
        if (Number.isFinite(value)) {
          next[column.id] = Math.max(column.min, Math.round(value));
        }
      }
      return next;
    } catch {
      return fallback;
    }
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const columnResizeStateRef = useRef<{ id: TagPickerColumnId | null; startX: number; startWidth: number }>({
    id: null,
    startX: 0,
    startWidth: 0,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch(initialFilters?.search ?? "");
    setGroupFilter(initialFilters?.groupFilter ?? "all");
    setDriverFilter(initialFilters?.driverFilter ?? "all");
    setSelectionFilter(initialFilters?.selectionFilter ?? "all");
    setDraftTags(selectedTags);
    setDraftAxes(axes);
    setSelectedTagName((selectedTags[0]?.tag ?? tags[0]?.name ?? ""));
    setSelectedRowNames(new Set());
  }, [axes, initialFilters?.driverFilter, initialFilters?.groupFilter, initialFilters?.search, initialFilters?.selectionFilter, open, selectedTags, tags]);

  const draftTagMap = useMemo(() => new Map(draftTags.map((item) => [item.tag, item])), [draftTags]);
  const tagsByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag])), [tags]);
  const groups = useMemo(() => {
    const values = new Set<string>();
    for (const tag of tags) {
      values.add(tag.group?.trim() || "Ungrouped");
    }
    return ["all", ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [tags]);

  const driverTypeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const tag of tags) {
      const sourceType = (tag.sourceType ?? "").toLowerCase();
      const driverType = (tag.driverType ?? "").toLowerCase();
      if (sourceType === "opcua" || driverType === "opcua") {
        values.add("opcua");
        continue;
      }
      if (sourceType === "simulated" || driverType === "simulated") {
        values.add("simulated");
      }
    }
    const options = [{ value: "all", label: "All drivers" }];
    if (values.has("opcua")) {
      options.push({ value: "opcua", label: "OPC UA" });
    }
    if (values.has("simulated")) {
      options.push({ value: "simulated", label: "Simulation" });
    }
    return options;
  }, [tags]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tags.filter((tag) => {
      const group = tag.group?.trim() || "Ungrouped";
      const selected = draftTagMap.has(tag.name);
      const sourceType = (tag.sourceType ?? "").toLowerCase();
      const driverType = (tag.driverType ?? "").toLowerCase();
      if (groupFilter !== "all" && group !== groupFilter) {
        return false;
      }
      if (driverFilter === "opcua" && !(sourceType === "opcua" || driverType === "opcua")) {
        return false;
      }
      if (driverFilter === "simulated" && !(sourceType === "simulated" || driverType === "simulated")) {
        return false;
      }
      if (selectionFilter === "added" && !selected) {
        return false;
      }
      if (!term) {
        return true;
      }
      return tag.name.toLowerCase().includes(term)
        || (tag.displayName ?? "").toLowerCase().includes(term)
        || group.toLowerCase().includes(term);
    });
  }, [draftTagMap, driverFilter, groupFilter, search, selectionFilter, tags]);

  useEffect(() => {
    if (!open) {
      return;
    }
    onFiltersChange?.({ search, groupFilter, driverFilter, selectionFilter });
  }, [driverFilter, groupFilter, onFiltersChange, open, search, selectionFilter]);

  const selectedTagInfo = tagsByName.get(selectedTagName);
  const current = selectedTagInfo ? draftTagMap.get(selectedTagInfo.name) : undefined;
  const currentInfo = selectedTagInfo;
  const tableColumnsTemplate = useMemo(
    () => TAG_PICKER_COLUMNS.map((column) => `${Math.round(columnWidths[column.id])}px`).join(" "),
    [columnWidths],
  );
  const axisUsageCount = useMemo(() => {
    const usage = new Map<string, number>();
    for (const tag of draftTags) {
      if (tag.axisMode !== "manual" || !tag.axisId) {
        continue;
      }
      usage.set(tag.axisId, (usage.get(tag.axisId) ?? 0) + 1);
    }
    return usage;
  }, [draftTags]);

  useEffect(() => {
    if (!open || filtered.length === 0) {
      return;
    }
    if (!selectedTagName || !filtered.some((tag) => tag.name === selectedTagName)) {
      setSelectedTagName(filtered[0]!.name);
    }
  }, [filtered, open, selectedTagName]);

  const toggleTag = (tag: TrendTagInfo) => {
    const exists = draftTagMap.get(tag.name);
    if (exists) {
      const next = draftTags.filter((item) => item.tag !== tag.name);
      setDraftTags(next);
      if (selectedTagName === tag.name) {
        setSelectedTagName(next[0]?.tag ?? "");
      }
      return;
    }
    const next: TrendTagSelection = {
      tag: tag.name,
      displayName: tag.displayName,
      unit: tag.unit,
      color: pickSeriesColor(draftTags.length),
      visible: false,
      lineWidth: 1,
      lineType: "solid",
      mode: tag.dataType === "boolean" ? "step" : "line",
      step: tag.dataType === "boolean",
      axisMode: "auto",
      archiveMode: tag.archiveMode,
      archivePeriodMs: tag.archivePeriodMs,
    };
    setDraftTags([...draftTags, next]);
    setSelectedTagName(tag.name);
  };

  const updateCurrent = (patch: Partial<TrendTagSelection>) => {
    if (!selectedTagName || !draftTagMap.has(selectedTagName)) {
      return;
    }
    setDraftTags((prev) => prev.map((item) => (item.tag === selectedTagName ? { ...item, ...patch } : item)));
  };

  const createNewAxisForCurrent = () => {
    if (!selectedTagName || !current) {
      return;
    }
    const id = nextManualAxisId(draftAxes);
    const newAxis: TrendAxisConfig = {
      id,
      name: current.unit || current.displayName || current.tag,
      unit: current.unit,
      position: draftAxes.filter((axis) => axis.position === "left").length <= draftAxes.filter((axis) => axis.position === "right").length ? "left" : "right",
      min: "auto",
      max: "auto",
      axisNameGap: 6,
      axisNamePaddingX: 6,
      axisNamePaddingY: 4,
      verticalLabelOffsetX: 0,
      axisTitleMode: "verticalLabel",
    };
    setDraftAxes((prev) => [...prev, newAxis]);
    setDraftTags((prev) => prev.map((item) => (item.tag === selectedTagName ? { ...item, axisMode: "manual", axisId: id } : item)));
  };

  const updateAxis = (axisId: string, patch: Partial<TrendAxisConfig>) => {
    setDraftAxes((prev) => prev.map((axis) => (axis.id === axisId ? { ...axis, ...patch } : axis)));
  };

  const removeAxis = (axisId: string) => {
    if (axisId === TREND_DEFAULT_AXIS_ID) {
      return;
    }
    setDraftAxes((prev) => prev.filter((axis) => axis.id !== axisId));
    setDraftTags((prev) => prev.map((tag) => (
      tag.axisMode === "manual" && tag.axisId === axisId
        ? { ...tag, axisMode: "auto", axisId: undefined }
        : tag
    )));
  };

  const selectFiltered = () => {
    if (filtered.length === 0) {
      return;
    }
    const map = new Map(draftTagMap);
    for (const tag of filtered) {
      if (map.has(tag.name)) {
        continue;
      }
      map.set(tag.name, {
        tag: tag.name,
        displayName: tag.displayName,
        unit: tag.unit,
        color: pickSeriesColor(map.size),
        visible: false,
        lineWidth: 1,
        lineType: "solid",
        mode: tag.dataType === "boolean" ? "step" : "line",
        step: tag.dataType === "boolean",
        axisMode: "auto",
        archiveMode: tag.archiveMode,
        archivePeriodMs: tag.archivePeriodMs,
      });
    }
    setDraftTags(Array.from(map.values()));
    if (!selectedTagName) {
      setSelectedTagName(filtered[0]?.name ?? "");
    }
  };

  const clearSelected = () => {
    if (!selectedTagName) {
      setDraftTags([]);
      return;
    }
    const next = draftTags.filter((item) => item.tag !== selectedTagName);
    setDraftTags(next);
    if (!next.some((item) => item.tag === selectedTagName)) {
      setSelectedTagName(next[0]?.tag ?? filtered[0]?.name ?? "");
    }
  };

  const toggleRowSelection = (tagName: string) => {
    setSelectedRowNames((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  };

  const selectFoundRows = () => {
    if (filtered.length === 0) {
      return;
    }
    setSelectedRowNames(new Set(filtered.map((tag) => tag.name)));
  };

  const clearRowSelection = () => {
    setSelectedRowNames(new Set());
  };

  const addSelectedRows = () => {
    if (selectedRowNames.size === 0) {
      return;
    }
    const byName = new Map(tags.map((tag) => [tag.name, tag]));
    const nextMap = new Map(draftTags.map((item) => [item.tag, item]));
    for (const tagName of selectedRowNames) {
      if (nextMap.has(tagName)) {
        continue;
      }
      const tag = byName.get(tagName);
      if (!tag) {
        continue;
      }
      nextMap.set(tagName, {
        tag: tag.name,
        displayName: tag.displayName,
        unit: tag.unit,
        color: pickSeriesColor(nextMap.size),
        visible: false,
        lineWidth: 1,
        lineType: "solid",
      mode: tag.dataType === "boolean" ? "step" : "line",
      step: tag.dataType === "boolean",
      axisMode: "auto",
      archiveMode: tag.archiveMode,
      archivePeriodMs: tag.archivePeriodMs,
    });
    }
    setDraftTags(Array.from(nextMap.values()));
  };

  const removeSelectedRows = () => {
    if (selectedRowNames.size === 0) {
      return;
    }
    const next = draftTags.filter((item) => !selectedRowNames.has(item.tag));
    setDraftTags(next);
    if (selectedTagName && selectedRowNames.has(selectedTagName)) {
      setSelectedTagName(next[0]?.tag ?? filtered[0]?.name ?? "");
    }
  };

  const startDetailsResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = detailsWidth;
    setIsDetailsResizeActive(true);
  };

  const startColumnResize = (event: ReactMouseEvent<HTMLDivElement>, columnId: TagPickerColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    columnResizeStateRef.current = {
      id: columnId,
      startX: event.clientX,
      startWidth: columnWidths[columnId],
    };
  };

  useEffect(() => {
    if (!isDetailsResizeActive) {
      return;
    }
    const onMouseMove = (event: MouseEvent) => {
      const delta = resizeStartXRef.current - event.clientX;
      const containerWidth = bodyRef.current?.clientWidth ?? 0;
      const dynamicMax = containerWidth > 0 ? Math.max(MIN_DETAILS_WIDTH, containerWidth - 520) : MAX_DETAILS_WIDTH;
      const next = clamp(resizeStartWidthRef.current + delta, MIN_DETAILS_WIDTH, Math.min(MAX_DETAILS_WIDTH, dynamicMax));
      setDetailsWidth(next);
    };
    const onMouseUp = () => {
      setIsDetailsResizeActive(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDetailsResizeActive]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = columnResizeStateRef.current;
      if (!state.id) {
        return;
      }
      const config = TAG_PICKER_COLUMNS.find((column) => column.id === state.id);
      if (!config) {
        return;
      }
      const delta = event.clientX - state.startX;
      const nextWidth = Math.max(config.min, Math.round(state.startWidth + delta));
      setColumnWidths((prev) => ({ ...prev, [state.id as TagPickerColumnId]: nextWidth }));
    };
    const handleUp = () => {
      if (!columnResizeStateRef.current.id) {
        return;
      }
      columnResizeStateRef.current = { id: null, startX: 0, startWidth: 0 };
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(TREND_TAG_PICKER_DETAILS_WIDTH_STORAGE_KEY, String(Math.round(detailsWidth)));
    } catch {
      // ignore storage failures for dialog-only preference
    }
  }, [detailsWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(TREND_TAG_PICKER_COLUMNS_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // ignore storage failures for dialog-only preference
    }
  }, [columnWidths]);

  if (!open) {
    return null;
  }

  return (
    <TrendWorkbenchDialog
      id="trend-tag-picker-dialog"
      title="Add / Remove Tags"
      open={open}
      defaultRect={{ x: 80, y: 56, width: 1320, height: 760 }}
      minWidth={900}
      minHeight={520}
      bodyClassName="trends-dialog-body--flush"
      onClose={onClose}
    >
        <div className="screen-editor-window-content screen-editor-tags-window screen-editor-archive-window trends-archive-picker">
          <div className="screen-editor-tags-window__toolbar">
            <WorkbenchButton variant="primary" onClick={addSelectedRows} disabled={selectedRowNames.size === 0}>Add Selected</WorkbenchButton>
            <WorkbenchButton variant="danger" onClick={removeSelectedRows} disabled={selectedRowNames.size === 0}>Remove Selected</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={selectFiltered} disabled={filtered.length === 0}>Select Found</WorkbenchButton>
            <WorkbenchButton onClick={clearSelected} disabled={draftTags.length === 0}>Clear Current</WorkbenchButton>
            <WorkbenchButton onClick={selectFoundRows} disabled={filtered.length === 0}>Mark Found</WorkbenchButton>
            <WorkbenchButton onClick={clearRowSelection} disabled={selectedRowNames.size === 0}>Clear Marked</WorkbenchButton>
            <div className="screen-editor-tags-window__toolbar-meta">
              Total: {tags.length} | Found: {filtered.length} | Marked: {selectedRowNames.size} | Added: {draftTags.length}
            </div>
            <WorkbenchButton onClick={onClose}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => onApply(draftTags, draftAxes)}>Apply</WorkbenchButton>
          </div>

          <div className="screen-editor-tags-window__toolbar screen-editor-archive-window__search-row">
            <input className="workbench-input screen-editor-tags-window__toolbar-input" placeholder="Search tags" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="workbench-select screen-editor-tags-window__toolbar-select" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              {groups.map((group) => (
                <option key={group} value={group}>{group === "all" ? "All groups" : group}</option>
              ))}
            </select>
            <select className="workbench-select screen-editor-tags-window__toolbar-select" value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}>
              {driverTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select className="workbench-select screen-editor-tags-window__toolbar-select" value={selectionFilter} onChange={(event) => setSelectionFilter(event.target.value as TrendTagPickerFilters["selectionFilter"])}>
              <option value="all">All tags</option>
              <option value="added">Added to chart</option>
            </select>
            <WorkbenchButton onClick={() => { setSearch(""); setGroupFilter("all"); setDriverFilter("all"); setSelectionFilter("all"); }} disabled={!search && groupFilter === "all" && driverFilter === "all" && selectionFilter === "all"}>Clear Filter</WorkbenchButton>
          </div>

          <div
            ref={bodyRef}
            className="screen-editor-tags-window__body"
            style={{ "--tags-details-width": `${detailsWidth}px` } as CSSProperties}
          >
            <div className="screen-editor-tags-window__list">
              <div className="screen-editor-tags-table">
                <div className="screen-editor-tags-row screen-editor-tags-row--header" style={{ gridTemplateColumns: tableColumnsTemplate }}>
                  {TAG_PICKER_COLUMNS.map((column, index) => (
                    <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell">
                      {column.label}
                      {index < TAG_PICKER_COLUMNS.length - 1 ? (
                        <div className="screen-editor-tags-column-resize-handle" onMouseDown={(event) => startColumnResize(event, column.id)} />
                      ) : null}
                    </div>
                  ))}
                </div>
                {filtered.map((tag) => {
                  const active = draftTagMap.has(tag.name);
                  const rowSelected = selectedTagName === tag.name;
                  const rowMarked = selectedRowNames.has(tag.name);
                  const displayName = tag.displayName || tag.name;
                  return (
                    <div
                      key={tag.name}
                      className={["screen-editor-tags-row", rowSelected ? "screen-editor-tags-row--selected" : ""].filter(Boolean).join(" ")}
                      style={{ gridTemplateColumns: tableColumnsTemplate }}
                      onClick={() => setSelectedTagName(tag.name)}
                    >
                      <div className="screen-editor-tags-cell" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={rowMarked} onChange={() => toggleRowSelection(tag.name)} />
                      </div>
                      <div className="screen-editor-tags-cell" title={displayName}>{displayName}{active ? " *" : ""}</div>
                      <div className="screen-editor-tags-cell">{tag.unit || "-"}</div>
                      <div className="screen-editor-tags-cell">{tag.dataType || "number"}</div>
                      <div className="screen-editor-tags-cell">{tag.group || "Ungrouped"}</div>
                    </div>
                  );
                })}
                {filtered.length === 0 ? <div className="screen-editor-empty-state">No tags match the filters</div> : null}
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
                <div className="screen-editor-tag-editor__title">Tag Details</div>
                {currentInfo ? (
                  <>
                    {(() => {
                      const archiveWarning = getSparseTrendArchivePolicyWarning(currentInfo.archiveMode);
                      return (
                        <>
                          <div className="screen-editor-tag-editor__kv"><span>Archive</span><strong>{formatTrendArchivePolicy(currentInfo.archiveMode, currentInfo.archivePeriodMs)}</strong></div>
                          {archiveWarning ? <div className="trends-policy-warning">{archiveWarning}</div> : null}
                        </>
                      );
                    })()}
                    <div className="screen-editor-tag-editor__kv"><span>Tag</span><strong>{currentInfo.name}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>ID</span><strong>{currentInfo.id}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Display name</span><strong>{currentInfo.displayName || "-"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Type</span><strong>{currentInfo?.dataType ?? "number"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Group</span><strong>{currentInfo?.group || "Ungrouped"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Unit</span><strong>{currentInfo.unit || "-"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Description</span><strong>{currentInfo.description || "-"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Range</span><strong>{typeof currentInfo.min === "number" || typeof currentInfo.max === "number" ? `${typeof currentInfo.min === "number" ? currentInfo.min : "-"} .. ${typeof currentInfo.max === "number" ? currentInfo.max : "-"}` : "-"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Added to chart</span><strong>{current ? "Yes" : "No"}</strong></div>

                    {current ? (
                      <>
                        <label className="workbench-field" style={{ marginTop: 8 }}>
                          <span className="workbench-field__label">Series display name</span>
                          <input className="workbench-input" value={current.displayName || ""} onChange={(event) => updateCurrent({ displayName: event.target.value })} />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Color</span>
                          <Space.Compact className="trends-tag-picker-color-row" style={{ width: "100%" }}>
                            <ColorPicker
                              size="small"
                              value={normalizePickerColor(current.color, "#4FC3F7")}
                              onChangeComplete={(color) => updateCurrent({ color: color.toHexString() })}
                            />
                            <Input
                              className="trends-tag-picker-color-input"
                              value={current.color || ""}
                              onChange={(event) => updateCurrent({ color: event.target.value })}
                              placeholder="#4FC3F7"
                            />
                          </Space.Compact>
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Line width</span>
                          <input className="workbench-input" type="number" min={1} max={5} value={current.lineWidth ?? 1} onChange={(event) => updateCurrent({ lineWidth: Number(event.target.value) })} />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Line style</span>
                          <select className="workbench-select" value={current.lineType || "solid"} onChange={(event) => updateCurrent({ lineType: event.target.value as TrendTagSelection["lineType"] })}>
                            <option value="solid">solid</option>
                            <option value="dashed">dashed</option>
                            <option value="dotted">dotted</option>
                          </select>
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Render mode</span>
                          <select className="workbench-select" value={current.mode || "line"} onChange={(event) => updateCurrent({ mode: event.target.value as TrendTagSelection["mode"], step: event.target.value === "step" })}>
                            <option value="line">line</option>
                            <option value="step">step</option>
                            <option value="points">points</option>
                          </select>
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Axis</span>
                          <select
                            className="workbench-select"
                            value={current.axisMode === "manual" && current.axisId && draftAxes.some((axis) => axis.id === current.axisId) ? current.axisId : "auto"}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === "auto") {
                                updateCurrent({ axisMode: "auto", axisId: undefined });
                                return;
                              }
                              updateCurrent({ axisMode: "manual", axisId: value });
                            }}
                          >
                            <option value="auto">auto</option>
                            {draftAxes.map((axis) => (
                              <option key={axis.id} value={axis.id}>{axis.name || axis.id}</option>
                            ))}
                          </select>
                        </label>
                        <WorkbenchButton onClick={createNewAxisForCurrent}>Create New Axis</WorkbenchButton>
                        <div className="trends-tag-picker-axis-table">
                          {draftAxes.map((axis) => (
                            <div key={axis.id} className="trends-tag-picker-axis-row">
                              <input
                                className="workbench-input"
                                value={axis.name ?? ""}
                                onChange={(event) => updateAxis(axis.id, { name: event.target.value })}
                                placeholder={axis.id}
                                title={axis.id}
                              />
                              <select
                                className="workbench-select"
                                value={axis.position}
                                onChange={(event) => updateAxis(axis.id, { position: event.target.value as TrendAxisConfig["position"] })}
                              >
                                <option value="left">left</option>
                                <option value="right">right</option>
                              </select>
                              <label className="screen-editor-settings-check">
                                <input type="checkbox" checked={axis.min === "auto" || axis.min === undefined} onChange={(event) => updateAxis(axis.id, { min: event.target.checked ? "auto" : 0 })} />
                                <span>Min auto</span>
                              </label>
                              <input
                                className="workbench-input"
                                type="number"
                                disabled={axis.min === "auto" || axis.min === undefined}
                                value={axis.min === "auto" || axis.min === undefined ? "" : axis.min}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  if (!Number.isFinite(parsed)) {
                                    return;
                                  }
                                  updateAxis(axis.id, { min: parsed });
                                }}
                                placeholder="Min"
                              />
                              <label className="screen-editor-settings-check">
                                <input type="checkbox" checked={axis.max === "auto" || axis.max === undefined} onChange={(event) => updateAxis(axis.id, { max: event.target.checked ? "auto" : 100 })} />
                                <span>Max auto</span>
                              </label>
                              <input
                                className="workbench-input"
                                type="number"
                                disabled={axis.max === "auto" || axis.max === undefined}
                                value={axis.max === "auto" || axis.max === undefined ? "" : axis.max}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  if (!Number.isFinite(parsed)) {
                                    return;
                                  }
                                  updateAxis(axis.id, { max: parsed });
                                }}
                                placeholder="Max"
                              />
                              <WorkbenchButton onClick={() => removeAxis(axis.id)} variant="danger">
                                Delete
                              </WorkbenchButton>
                              <span className="trends-tag-picker-axis-row__meta" title={axis.id}>
                                {axisUsageCount.get(axis.id) ?? 0} used
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <WorkbenchButton variant="primary" onClick={() => toggleTag(currentInfo)} style={{ marginTop: 8 }}>Add To Chart</WorkbenchButton>
                    )}
                  </>
                ) : (
                  <div className="screen-editor-empty-state">Select a tag</div>
                )}
              </div>
            </div>
          </div>
        </div>
    </TrendWorkbenchDialog>
  );
}
