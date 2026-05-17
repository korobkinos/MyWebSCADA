import { useMemo, useState } from "react";
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

export function TrendTagPickerDialog({ open, tags, selectedTags, axes, onClose, onApply }: TrendTagPickerDialogProps) {
  const [search, setSearch] = useState("");
  const [selectedTagName, setSelectedTagName] = useState<string>(selectedTags[0]?.tag ?? "");
  const [draftTags, setDraftTags] = useState<TrendTagSelection[]>(selectedTags);
  const [draftAxes, setDraftAxes] = useState<TrendAxisConfig[]>(axes);

  const draftTagMap = useMemo(() => new Map(draftTags.map((item) => [item.tag, item])), [draftTags]);

  if (!open) {
    return null;
  }

  const filtered = tags.filter((tag) => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return true;
    }
    return tag.name.toLowerCase().includes(term)
      || (tag.displayName ?? "").toLowerCase().includes(term)
      || (tag.group ?? "").toLowerCase().includes(term);
  });

  const grouped = filtered.reduce<Map<string, TrendTagInfo[]>>((acc, tag) => {
    const group = tag.group || "Ungrouped";
    if (!acc.has(group)) {
      acc.set(group, []);
    }
    acc.get(group)?.push(tag);
    return acc;
  }, new Map());

  const current = draftTagMap.get(selectedTagName);

  const toggleTag = (tag: TrendTagInfo) => {
    const exists = draftTagMap.get(tag.name);
    if (exists) {
      setDraftTags(draftTags.filter((item) => item.tag !== tag.name));
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
    setDraftTags(draftTags.map((item) => (item.tag === current.tag ? { ...item, ...patch } : item)));
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

  return (
    <div className="trends-dialog-layer">
      <div className="trends-dialog trends-dialog--wide">
        <div className="trends-dialog__header">
          <span>ADD / REMOVE TAGS</span>
          <div className="trends-dialog__header-actions">
            <WorkbenchButton onClick={onClose}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => onApply(draftTags, draftAxes)}>Apply</WorkbenchButton>
          </div>
        </div>

        <div className="trends-picker-body">
          <div className="trends-picker-list">
            <div className="trends-picker-toolbar">
              <input className="workbench-input" placeholder="Search tag..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <span>{draftTags.length} selected</span>
            </div>
            <div className="trends-picker-groups">
              {[...grouped.entries()].map(([groupName, groupTags]) => (
                <div key={groupName} className="trends-picker-group">
                  <div className="trends-picker-group__title">{groupName}</div>
                  {groupTags.map((tag) => {
                    const active = draftTagMap.has(tag.name);
                    return (
                      <label key={tag.name} className="trends-picker-row" onClick={() => setSelectedTagName(tag.name)}>
                        <input type="checkbox" checked={active} onChange={() => toggleTag(tag)} />
                        <span className="trends-picker-row__name">{tag.displayName || tag.name}</span>
                        <span className="trends-picker-row__meta">{tag.unit || "-"}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="trends-picker-details">
            {current ? (
              <>
                <div className="trends-picker-details__title">{current.displayName || current.tag}</div>
                <label className="workbench-field">
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
              <div className="screen-editor-empty-state">Select a tag from the list</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
