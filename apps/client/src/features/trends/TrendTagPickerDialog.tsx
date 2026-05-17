import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { WorkbenchButton } from "../../components/workbench";
import type { TrendAxisConfig, TrendTagInfo, TrendTagSelection } from "./trendTypes";
import { pickSeriesColor } from "./trendUtils";

type TrendTagPickerDialogProps = {
  open: boolean;
  tags: TrendTagInfo[];
  selectedTags: TrendTagSelection[];
  axes: TrendAxisConfig[];
  onClose: () => void;
  onApply: (nextTags: TrendTagSelection[], nextAxes: TrendAxisConfig[]) => void;
};

const TABLE_COLUMNS = "34px minmax(220px, 1fr) 90px 90px 120px";

export function TrendTagPickerDialog({ open, tags, selectedTags, axes, onClose, onApply }: TrendTagPickerDialogProps) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [selectedTagName, setSelectedTagName] = useState<string>("");
  const [draftTags, setDraftTags] = useState<TrendTagSelection[]>(selectedTags);
  const [draftAxes, setDraftAxes] = useState<TrendAxisConfig[]>(axes);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch("");
    setGroupFilter("all");
    setDraftTags(selectedTags);
    setDraftAxes(axes);
    setSelectedTagName((selectedTags[0]?.tag ?? tags[0]?.name ?? ""));
  }, [axes, open, selectedTags, tags]);

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
      if (groupFilter !== "all" && group !== groupFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return tag.name.toLowerCase().includes(term)
        || (tag.displayName ?? "").toLowerCase().includes(term)
        || group.toLowerCase().includes(term);
    });
  }, [groupFilter, search, tags]);

  const current = draftTagMap.get(selectedTagName);
  const currentInfo = current ? tagsByName.get(current.tag) : undefined;

  if (!open) {
    return null;
  }

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
    setDraftTags([]);
    setSelectedTagName("");
  };

  return (
    <div className="trends-dialog-layer">
      <div className="trends-dialog trends-dialog--wide trends-dialog--archive-like">
        <div className="screen-editor-window-content screen-editor-tags-window screen-editor-archive-window trends-archive-picker">
          <div className="screen-editor-tags-window__toolbar">
            <WorkbenchButton variant="primary" onClick={selectFiltered} disabled={filtered.length === 0}>Select Found</WorkbenchButton>
            <WorkbenchButton onClick={clearSelected} disabled={draftTags.length === 0}>Clear Selected</WorkbenchButton>
            <div className="screen-editor-tags-window__toolbar-meta">
              Total: {tags.length} | Found: {filtered.length} | Selected: {draftTags.length}
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
            <WorkbenchButton onClick={() => { setSearch(""); setGroupFilter("all"); }} disabled={!search && groupFilter === "all"}>Clear Filter</WorkbenchButton>
          </div>

          <div className="screen-editor-tags-window__body" style={{ "--tags-details-width": "360px" } as CSSProperties}>
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

            <div className="screen-editor-tags-window__details">
              <div className="screen-editor-tag-editor">
                <div className="screen-editor-tag-editor__title">Series Details</div>
                {current ? (
                  <>
                    <div className="screen-editor-tag-editor__kv"><span>Tag</span><strong>{current.tag}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Type</span><strong>{currentInfo?.dataType ?? "number"}</strong></div>
                    <div className="screen-editor-tag-editor__kv"><span>Group</span><strong>{currentInfo?.group || "Ungrouped"}</strong></div>

                    <label className="workbench-field" style={{ marginTop: 8 }}>
                      <span className="workbench-field__label">Display name</span>
                      <input className="workbench-input" value={current.displayName || ""} onChange={(event) => updateCurrent({ displayName: event.target.value })} />
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Color</span>
                      <input className="workbench-input" type="color" value={current.color || "#4FC3F7"} onChange={(event) => updateCurrent({ color: event.target.value })} />
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
                  <div className="screen-editor-empty-state">Select a tag</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
