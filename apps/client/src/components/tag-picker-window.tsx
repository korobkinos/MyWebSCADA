import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TagSourceType } from "@web-scada/shared";
import { WorkbenchWindow, type WorkbenchWindowRect } from "./workbench";

export type TagPickerWindowTag = {
  key: string;
  name: string;
  description?: string;
  sourceType: TagSourceType;
  dataType: string;
  driverId?: string;
  group?: string;
  writable?: boolean;
  nodeOrAddress: string;
};

type SourceFilter = "all" | TagSourceType;

type WorkbenchTagPickerWindowProps = {
  open: boolean;
  rect: WorkbenchWindowRect;
  zIndex: number;
  tags: TagPickerWindowTag[];
  selectedValue?: string;
  writableOnly?: boolean;
  allowedDataTypes?: string[];
  allowedSourceTypes?: TagSourceType[];
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (rect: WorkbenchWindowRect) => void;
  onSelect: (tagName: string | undefined) => void;
  onCreateTag?: (tagName: string, dataType: string) => void;
};

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "opcua", label: "OPC UA" },
  { value: "simulated", label: "Simulated" },
  { value: "lw", label: "LW" },
  { value: "internal", label: "Internal" },
  { value: "computed", label: "Computed" },
  { value: "modbus", label: "Modbus" },
];

const SOURCE_LABELS: Record<TagSourceType, string> = {
  opcua: "OPC UA",
  modbus: "Modbus",
  simulated: "Simulated",
  internal: "Internal",
  lw: "LW",
  computed: "Computed",
};

const DATA_TYPES = ["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"];
const PAGE_SIZE = 100;

export function WorkbenchTagPickerWindow({
  open,
  rect,
  zIndex,
  tags,
  selectedValue,
  writableOnly,
  allowedDataTypes,
  allowedSourceTypes,
  onClose,
  onFocus,
  onMove,
  onResize,
  onSelect,
  onCreateTag,
}: WorkbenchTagPickerWindowProps) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagType, setNewTagType] = useState("BOOL");
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  const sourceAllowSet = useMemo(
    () => new Set(allowedSourceTypes && allowedSourceTypes.length > 0 ? allowedSourceTypes : SOURCE_OPTIONS.slice(1).map((item) => item.value as TagSourceType)),
    [allowedSourceTypes],
  );

  const filteredBase = useMemo(() => {
    let list = tags.filter((tag) => sourceAllowSet.has(tag.sourceType));

    if (writableOnly) {
      list = list.filter((tag) => tag.writable !== false);
    }

    if (allowedDataTypes && allowedDataTypes.length > 0) {
      list = list.filter((tag) => allowedDataTypes.includes(tag.dataType));
    }

    return list;
  }, [allowedDataTypes, sourceAllowSet, tags, writableOnly]);

  const driverOptions = useMemo(() => {
    const values = new Set<string>();
    for (const tag of filteredBase) {
      if (tag.driverId) {
        values.add(tag.driverId);
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [filteredBase]);

  const groupOptions = useMemo(() => {
    const values = new Set<string>();
    for (const tag of filteredBase) {
      if (tag.group) {
        values.add(tag.group);
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [filteredBase]);

  const filteredTags = useMemo(() => {
    const query = search.trim().toLowerCase();
    return filteredBase.filter((tag) => {
      if (sourceFilter !== "all" && tag.sourceType !== sourceFilter) {
        return false;
      }
      if (driverFilter !== "all" && tag.driverId !== driverFilter) {
        return false;
      }
      if (groupFilter !== "all" && tag.group !== groupFilter) {
        return false;
      }
      if (!query) {
        return true;
      }

      return (
        tag.name.toLowerCase().includes(query) ||
        (tag.description ?? "").toLowerCase().includes(query) ||
        tag.dataType.toLowerCase().includes(query) ||
        (tag.driverId ?? "").toLowerCase().includes(query) ||
        (tag.group ?? "").toLowerCase().includes(query) ||
        tag.nodeOrAddress.toLowerCase().includes(query)
      );
    });
  }, [driverFilter, filteredBase, groupFilter, search, sourceFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTags.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredTags.slice(start, start + PAGE_SIZE);
  }, [filteredTags, safePage]);

  const selectedTag = useMemo(
    () => filteredTags.find((tag) => tag.key === selectedKey) ?? tags.find((tag) => tag.key === selectedKey),
    [filteredTags, selectedKey, tags],
  );

  useEffect(() => {
    setPage(1);
  }, [driverFilter, groupFilter, search, sourceFilter]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const matched = selectedValue ? tags.find((tag) => tag.name === selectedValue) : undefined;
    setSelectedKey(matched?.key);
  }, [open, selectedValue, tags]);

  useEffect(() => {
    setCreateError(undefined);
  }, [newTagName, newTagType]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="tag-picker-window-layer"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <WorkbenchWindow
        id="tagPicker"
        title="Select Tag"
        rect={rect}
        zIndex={zIndex}
        minWidth={620}
        minHeight={420}
        onClose={onClose}
        onFocus={onFocus}
        onMove={onMove}
        onResize={onResize}
      >
        <div className="tag-picker-window">
          <div className="tag-picker-window__toolbar">
            <input
              className="workbench-input"
              value={search}
              placeholder="Search name / description / node / driver / group"
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="workbench-select"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="workbench-select"
              value={driverFilter}
              onChange={(event) => setDriverFilter(event.target.value)}
            >
              <option value="all">All drivers</option>
              {driverOptions.map((driverId) => (
                <option key={driverId} value={driverId}>
                  {driverId}
                </option>
              ))}
            </select>
            <select
              className="workbench-select"
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
            <button
              type="button"
              className="workbench-button"
              onClick={() => {
                setSearch("");
                setSourceFilter("all");
                setDriverFilter("all");
                setGroupFilter("all");
              }}
            >
              <span className="workbench-button__label">Clear</span>
            </button>
          </div>

          {createOpen ? (
            <div className="tag-picker-window__create-row">
              <input
                className="workbench-input"
                value={newTagName}
                placeholder="New tag name"
                onChange={(event) => setNewTagName(event.target.value)}
              />
              <select
                className="workbench-select"
                value={newTagType}
                onChange={(event) => setNewTagType(event.target.value)}
              >
                {DATA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="workbench-button workbench-button--primary"
                onClick={() => {
                  if (!onCreateTag) {
                    return;
                  }
                  const name = newTagName.trim();
                  if (!name) {
                    setCreateError("Tag name is required");
                    return;
                  }
                  if (tags.some((tag) => tag.name === name)) {
                    setCreateError("Tag with this name already exists");
                    return;
                  }
                  onCreateTag(name, newTagType);
                  setCreateOpen(false);
                  setNewTagName("");
                  setNewTagType("BOOL");
                }}
              >
                <span className="workbench-button__label">Create & Select</span>
              </button>
              <button
                type="button"
                className="workbench-button"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateError(undefined);
                }}
              >
                <span className="workbench-button__label">Cancel</span>
              </button>
              {createError ? <span className="tag-picker-window__create-error">{createError}</span> : null}
            </div>
          ) : null}

          <div className="tag-picker-window__table">
            <div className="tag-picker-window__table-grid">
              <div className="tag-picker-row tag-picker-row--header">
                <div className="tag-picker-cell">Name</div>
                <div className="tag-picker-cell">Source</div>
                <div className="tag-picker-cell">Type</div>
                <div className="tag-picker-cell">Driver</div>
                <div className="tag-picker-cell">Node / Address</div>
                <div className="tag-picker-cell">Writable</div>
                <div className="tag-picker-cell">Group</div>
              </div>
              {pageRows.map((tag) => {
                const isSelected = tag.key === selectedKey;
                return (
                  <div
                    key={tag.key}
                    className={["tag-picker-row", isSelected ? "tag-picker-row--selected" : ""].filter(Boolean).join(" ")}
                    onClick={() => setSelectedKey(tag.key)}
                    onDoubleClick={() => {
                      onSelect(tag.name);
                      onClose();
                    }}
                  >
                    <div className="tag-picker-cell" title={tag.name}>{tag.name}</div>
                    <div className="tag-picker-cell" title={SOURCE_LABELS[tag.sourceType]}>{SOURCE_LABELS[tag.sourceType]}</div>
                    <div className="tag-picker-cell" title={tag.dataType}>{tag.dataType}</div>
                    <div className="tag-picker-cell" title={tag.driverId ?? "-"}>{tag.driverId ?? "-"}</div>
                    <div className="tag-picker-cell" title={tag.nodeOrAddress}>{tag.nodeOrAddress}</div>
                    <div className="tag-picker-cell" title={tag.writable === false ? "No" : "Yes"}>{tag.writable === false ? "N" : "Y"}</div>
                    <div className="tag-picker-cell" title={tag.group ?? "-"}>{tag.group ?? "-"}</div>
                  </div>
                );
              })}
              {pageRows.length === 0 ? <div className="tag-picker-window__empty">No tags match the filters</div> : null}
            </div>
          </div>

          <div className="tag-picker-window__footer">
            <div className="tag-picker-window__selected" title={selectedTag?.name ?? selectedValue ?? "No tag selected"}>
              {selectedTag?.name ?? selectedValue ?? "No tag selected"}
            </div>
            <div className="tag-picker-window__pager">
              <span className="tag-picker-window__pager-label">{filteredTags.length} rows : Page {safePage}/{totalPages}</span>
              <button
                type="button"
                className="workbench-button"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <span className="workbench-button__label">Prev</span>
              </button>
              <button
                type="button"
                className="workbench-button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                <span className="workbench-button__label">Next</span>
              </button>
            </div>
            {onCreateTag ? (
              <button
                type="button"
                className="workbench-button"
                onClick={() => {
                  setCreateOpen((current) => !current);
                  setCreateError(undefined);
                }}
              >
                <span className="workbench-button__label">Create New Tag</span>
              </button>
            ) : null}
            <button
              type="button"
              className="workbench-button"
              onClick={() => {
                onSelect(undefined);
                onClose();
              }}
            >
              <span className="workbench-button__label">Clear Selection</span>
            </button>
            <button type="button" className="workbench-button" onClick={onClose}>
              <span className="workbench-button__label">Cancel</span>
            </button>
            <button
              type="button"
              className="workbench-button workbench-button--primary"
              disabled={!selectedTag}
              onClick={() => {
                if (!selectedTag) {
                  return;
                }
                onSelect(selectedTag.name);
                onClose();
              }}
            >
              <span className="workbench-button__label">Select</span>
            </button>
          </div>
        </div>
      </WorkbenchWindow>
    </div>,
    document.body,
  );
}
