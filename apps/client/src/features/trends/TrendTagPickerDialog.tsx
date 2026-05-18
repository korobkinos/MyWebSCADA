import { type CSSProperties, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, Input, Space } from "antd";
import { WorkbenchButton } from "../../components/workbench";
import type { TrendAxisConfig, TrendTagInfo, TrendTagPickerFilters, TrendTagSelection } from "./trendTypes";
import { pickSeriesColor } from "./trendUtils";
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

const TABLE_COLUMNS = "34px minmax(220px, 1fr) 90px 90px 120px";
const TREND_TAG_PICKER_DETAILS_WIDTH_STORAGE_KEY = "mywebscada.trends.tagPicker.detailsWidth";
const DEFAULT_DETAILS_WIDTH = 360;
const MIN_DETAILS_WIDTH = 300;
const MAX_DETAILS_WIDTH = 760;

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

export function TrendTagPickerDialog({ open, tags, selectedTags, axes, initialFilters, onClose, onApply, onFiltersChange }: TrendTagPickerDialogProps) {
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [groupFilter, setGroupFilter] = useState<string>(initialFilters?.groupFilter ?? "all");
  const [selectionFilter, setSelectionFilter] = useState<TrendTagPickerFilters["selectionFilter"]>(initialFilters?.selectionFilter ?? "all");
  const [selectedTagName, setSelectedTagName] = useState<string>("");
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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch(initialFilters?.search ?? "");
    setGroupFilter(initialFilters?.groupFilter ?? "all");
    setSelectionFilter(initialFilters?.selectionFilter ?? "all");
    setDraftTags(selectedTags);
    setDraftAxes(axes);
    setSelectedTagName((selectedTags[0]?.tag ?? tags[0]?.name ?? ""));
  }, [axes, initialFilters?.groupFilter, initialFilters?.search, initialFilters?.selectionFilter, open, selectedTags, tags]);

  const draftTagMap = useMemo(() => new Map(draftTags.map((item) => [item.tag, item])), [draftTags]);
  const tagsByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag])), [tags]);
  const groups = useMemo(() => {
    const values = new Set<string>();
    for (const tag of tags) {
      values.add(tag.group?.trim() || "Ungrouped");
    }
    return ["all", ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [tags]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tags.filter((tag) => {
      const group = tag.group?.trim() || "Ungrouped";
      const selected = draftTagMap.has(tag.name);
      if (groupFilter !== "all" && group !== groupFilter) {
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
  }, [draftTagMap, groupFilter, search, selectionFilter, tags]);

  useEffect(() => {
    if (!open) {
      return;
    }
    onFiltersChange?.({ search, groupFilter, selectionFilter });
  }, [groupFilter, onFiltersChange, open, search, selectionFilter]);

  const selectedTagInfo = tagsByName.get(selectedTagName);
  const current = selectedTagInfo ? draftTagMap.get(selectedTagInfo.name) : undefined;
  const currentInfo = selectedTagInfo;

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
      visible: true,
      lineWidth: 1,
      lineType: "solid",
      mode: tag.dataType === "boolean" ? "step" : "line",
      step: tag.dataType === "boolean",
      axisMode: "auto",
    };
    setDraftTags([...draftTags, next]);
    setSelectedTagName(tag.name);
  };

  const updateCurrent = (patch: Partial<TrendTagSelection>) => {
    if (!current) {
      return;
    }
    setDraftTags((prev) => prev.map((item) => (item.tag === current.tag ? { ...item, ...patch } : item)));
  };

  const createNewAxisForCurrent = () => {
    if (!current) {
      return;
    }
    const id = `axis:manual:${draftAxes.length + 1}`;
    const newAxis: TrendAxisConfig = {
      id,
      name: current.unit || current.displayName || current.tag,
      unit: current.unit,
      position: draftAxes.filter((axis) => axis.position === "left").length <= draftAxes.filter((axis) => axis.position === "right").length ? "left" : "right",
      min: "auto",
      max: "auto",
    };
    setDraftAxes([...draftAxes, newAxis]);
    updateCurrent({ axisMode: "manual", axisId: id });
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
        visible: true,
        lineWidth: 1,
        lineType: "solid",
        mode: tag.dataType === "boolean" ? "step" : "line",
        step: tag.dataType === "boolean",
        axisMode: "auto",
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

  const startDetailsResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = detailsWidth;
    setIsDetailsResizeActive(true);
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
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(TREND_TAG_PICKER_DETAILS_WIDTH_STORAGE_KEY, String(Math.round(detailsWidth)));
    } catch {
      // ignore storage failures for dialog-only preference
    }
  }, [detailsWidth]);

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
            <WorkbenchButton variant="primary" onClick={selectFiltered} disabled={filtered.length === 0}>Select Found</WorkbenchButton>
            <WorkbenchButton onClick={clearSelected} disabled={draftTags.length === 0}>Clear Selected</WorkbenchButton>
            <div className="screen-editor-tags-window__toolbar-meta">
              Total: {tags.length} | Found: {filtered.length} | Added: {draftTags.length}
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
            <select className="workbench-select screen-editor-tags-window__toolbar-select" value={selectionFilter} onChange={(event) => setSelectionFilter(event.target.value as TrendTagPickerFilters["selectionFilter"])}>
              <option value="all">All tags</option>
              <option value="added">Added to chart</option>
            </select>
            <WorkbenchButton onClick={() => { setSearch(""); setGroupFilter("all"); setSelectionFilter("all"); }} disabled={!search && groupFilter === "all" && selectionFilter === "all"}>Clear Filter</WorkbenchButton>
          </div>

          <div
            ref={bodyRef}
            className="screen-editor-tags-window__body"
            style={{ "--tags-details-width": `${detailsWidth}px` } as CSSProperties}
          >
            <div className="screen-editor-tags-window__list">
              <div className="screen-editor-tags-table">
                <div className="screen-editor-tags-row screen-editor-tags-row--header" style={{ gridTemplateColumns: TABLE_COLUMNS }}>
                  <div className="screen-editor-tags-cell screen-editor-tags-header-cell" />
                  <div className="screen-editor-tags-cell screen-editor-tags-header-cell">TAG</div>
                  <div className="screen-editor-tags-cell screen-editor-tags-header-cell">UNIT</div>
                  <div className="screen-editor-tags-cell screen-editor-tags-header-cell">TYPE</div>
                  <div className="screen-editor-tags-cell screen-editor-tags-header-cell">GROUP</div>
                </div>
                {filtered.map((tag) => {
                  const active = draftTagMap.has(tag.name);
                  const rowSelected = selectedTagName === tag.name;
                  const displayName = tag.displayName || tag.name;
                  return (
                    <div
                      key={tag.name}
                      className={["screen-editor-tags-row", rowSelected ? "screen-editor-tags-row--selected" : ""].filter(Boolean).join(" ")}
                      style={{ gridTemplateColumns: TABLE_COLUMNS }}
                      onClick={() => setSelectedTagName(tag.name)}
                    >
                      <div className="screen-editor-tags-cell" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={active} onChange={() => toggleTag(tag)} />
                      </div>
                      <div className="screen-editor-tags-cell" title={displayName}>{displayName}</div>
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
                            value={current.axisMode === "manual" ? (current.axisId || "") : "auto"}
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
