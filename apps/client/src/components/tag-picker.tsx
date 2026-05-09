import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Modal, Select, Space, Tag, Typography, message } from "antd";
import type { ScadaProject, TagDefinition, TagSourceType } from "@web-scada/shared";

type Props = {
  project: ScadaProject;
  value: string;
  onChange: (tagName: string | undefined) => void;
  writableOnly?: boolean;
  allowedDataTypes?: string[];
  allowedSourceTypes?: TagSourceType[];
};

type PickerTag = TagDefinition & {
  sourceType: TagSourceType;
};

type TagSelectOption = {
  value: string;
  label: string;
  tag: PickerTag;
};

type TagSelectGroup = {
  label: string;
  options: TagSelectOption[];
};

const DATA_TYPE_COLORS: Record<string, string> = {
  BOOL: "green",
  INT: "blue",
  UINT: "cyan",
  DINT: "purple",
  UDINT: "geekblue",
  REAL: "orange",
  STRING: "magenta",
};

const SOURCE_COLORS: Record<TagSourceType, string> = {
  opcua: "geekblue",
  modbus: "purple",
  simulated: "volcano",
  internal: "cyan",
  lw: "gold",
  computed: "lime",
};

const SOURCE_LABELS: Record<TagSourceType, string> = {
  opcua: "OPC UA",
  modbus: "Modbus",
  simulated: "Sim",
  internal: "Internal",
  lw: "LW",
  computed: "Computed",
};

const DEFAULT_ALLOWED_SOURCES: TagSourceType[] = ["opcua", "simulated", "internal", "lw", "computed"];
const GROUP_ORDER = ["OPC UA", "LW", "Internal", "Simulated", "Computed"];

function normalizeSourceType(tag: TagDefinition): TagSourceType {
  return (tag.sourceType ?? "simulated") as TagSourceType;
}

function getTagGroupLabel(sourceType: TagSourceType): string {
  if (sourceType === "opcua") return "OPC UA";
  if (sourceType === "modbus") return "Modbus";
  if (sourceType === "lw") return "LW";
  if (sourceType === "internal") return "Internal";
  if (sourceType === "simulated") return "Simulated";
  return "Computed";
}

function toLwTagName(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

function buildPickerTags(project: ScadaProject): PickerTag[] {
  const byName = new Map<string, PickerTag>();

  for (const tag of project.tags ?? []) {
    const sourceType = normalizeSourceType(tag);
    byName.set(tag.name, {
      ...tag,
      sourceType,
    });
  }

  for (const variable of project.variables ?? []) {
    const internalName = variable.name.startsWith("LW.") ? variable.name : `LW.${variable.name}`;
    if (!byName.has(internalName)) {
      byName.set(internalName, {
        name: internalName,
        description: variable.description,
        dataType: variable.dataType,
        sourceType: "internal",
        writable: variable.writable ?? true,
        persistent: variable.persistent,
        internalVariableName: variable.name,
      });
    }

    if (typeof variable.lwAddress === "number" && Number.isFinite(variable.lwAddress)) {
      const lwName = toLwTagName(variable.lwAddress);
      byName.set(lwName, {
        name: lwName,
        description: variable.description ?? variable.name,
        dataType: variable.dataType,
        sourceType: "lw",
        writable: variable.writable ?? true,
        persistent: variable.persistent,
        lwAddress: variable.lwAddress,
      });
    }
  }

  for (const [addressText] of Object.entries(project.lwStore?.values ?? {})) {
    const address = Number(addressText);
    if (!Number.isFinite(address)) {
      continue;
    }
    const lwName = toLwTagName(address);
    if (!byName.has(lwName)) {
      byName.set(lwName, {
        name: lwName,
        description: `LW address ${address}`,
        dataType: "INT",
        sourceType: "lw",
        writable: true,
        lwAddress: address,
        persistent: project.lwStore?.mode === "persistent",
      });
    }
  }

  return [...byName.values()];
}

function getSecondaryText(tag: PickerTag): string {
  const bits: string[] = [];
  if (tag.description) {
    bits.push(tag.description);
  }
  if (tag.sourceType === "lw" && typeof tag.lwAddress === "number") {
    bits.push(`address ${tag.lwAddress}`);
  }
  if (tag.driverId) {
    bits.push(`driver ${tag.driverId}`);
  }
  if (tag.internalVariableName) {
    bits.push(`var ${tag.internalVariableName}`);
  }
  return bits.join(" · ");
}

function TagOptionRow({ tag }: { tag: PickerTag }) {
  const meta = getSecondaryText(tag);
  return (
    <div className="tag-option-row">
      <div className="tag-option-row__title" title={tag.name}>
        {tag.name}
      </div>
      <div className="tag-option-row__badges">
        <Tag className="tag-badge" color={DATA_TYPE_COLORS[tag.dataType] ?? "default"}>
          {tag.dataType}
        </Tag>
        <Tag className="tag-badge" color={SOURCE_COLORS[tag.sourceType]}>
          {SOURCE_LABELS[tag.sourceType]}
        </Tag>
      </div>
      {meta ? (
        <div className="tag-option-row__meta" title={meta}>
          {meta}
        </div>
      ) : null}
    </div>
  );
}

function TagSelectedValue({ tag, fallbackName }: { tag?: PickerTag; fallbackName: string }) {
  if (!tag) {
    return (
      <div className="tag-picker-selected">
        <span className="tag-picker-selected__name">{fallbackName}</span>
        <span className="tag-picker-selected__badges">
          <Tag className="tag-badge" color="red">
            not found
          </Tag>
        </span>
      </div>
    );
  }

  return (
    <div className="tag-picker-selected">
      <span className="tag-picker-selected__name" title={tag.name}>
        {tag.name}
      </span>
      <span className="tag-picker-selected__badges">
        <Tag className="tag-badge" color={DATA_TYPE_COLORS[tag.dataType] ?? "default"}>
          {tag.dataType}
        </Tag>
        <Tag className="tag-badge" color={SOURCE_COLORS[tag.sourceType]}>
          {SOURCE_LABELS[tag.sourceType]}
        </Tag>
      </span>
    </div>
  );
}

export function TagPicker({
  project,
  value,
  onChange,
  writableOnly,
  allowedDataTypes,
  allowedSourceTypes,
}: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagType, setNewTagType] = useState<string>("BOOL");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search]);

  const tags = useMemo(() => buildPickerTags(project), [project]);
  const tagByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag])), [tags]);

  const filteredTags = useMemo(() => {
    const sourceAllowSet = new Set(
      allowedSourceTypes && allowedSourceTypes.length > 0 ? allowedSourceTypes : DEFAULT_ALLOWED_SOURCES,
    );
    let list = tags.filter((tag) => sourceAllowSet.has(tag.sourceType));

    if (writableOnly) {
      list = list.filter((tag) => tag.writable !== false);
    }

    if (allowedDataTypes && allowedDataTypes.length > 0) {
      list = list.filter((tag) => allowedDataTypes.includes(tag.dataType));
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      list = list.filter((tag) => {
        const sourceLabel = SOURCE_LABELS[tag.sourceType].toLowerCase();
        return (
          tag.name.toLowerCase().includes(q) ||
          (tag.description ?? "").toLowerCase().includes(q) ||
          tag.dataType.toLowerCase().includes(q) ||
          sourceLabel.includes(q) ||
          String(tag.lwAddress ?? "").includes(q)
        );
      });
    }

    return list;
  }, [allowedDataTypes, allowedSourceTypes, debouncedSearch, tags, writableOnly]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, TagSelectOption[]>();
    for (const tag of filteredTags) {
      const groupName = getTagGroupLabel(tag.sourceType);
      const arr = groups.get(groupName) ?? [];
      arr.push({ value: tag.name, label: tag.name, tag });
      groups.set(groupName, arr);
    }

    const out: TagSelectGroup[] = [];
    for (const groupName of GROUP_ORDER) {
      const groupItems = groups.get(groupName);
      if (!groupItems || groupItems.length === 0) {
        continue;
      }
      groupItems.sort((a, b) => a.value.localeCompare(b.value));
      out.push({ label: groupName, options: groupItems });
    }
    return out;
  }, [filteredTags]);

  const tagExists = useMemo(() => {
    if (!value) return true;
    return tagByName.has(value);
  }, [tagByName, value]);

  const handleCreateTag = () => {
    const name = newTagName.trim();
    if (!name) {
      void message.warning("Tag name is required");
      return;
    }
    if (tags.some((tag) => tag.name === name)) {
      void message.warning("Tag with this name already exists");
      return;
    }
    onChange(name);
    setCreateModalOpen(false);
    setNewTagName("");
    setNewTagType("BOOL");
    void message.success(`Tag \"${name}\" selected (not yet saved to project)`);
  };

  return (
    <Space direction="vertical" style={{ width: "100%", minWidth: 0 }} size={4}>
      <Select
        className="tag-picker-control"
        labelInValue
        showSearch
        allowClear
        style={{ width: "100%", minWidth: 0 }}
        placeholder="Select tag..."
        value={value ? { value, label: value } : undefined}
        onChange={(val) => {
          const next = (val as { value?: string } | undefined)?.value;
          onChange(next ?? undefined);
        }}
        onSearch={setSearch}
        filterOption={false}
        options={groupedOptions as never}
        listHeight={320}
        popupMatchSelectWidth
        placement="bottomLeft"
        getPopupContainer={() => document.body}
        dropdownStyle={{ zIndex: 4000, maxWidth: "min(520px, calc(100vw - 24px))" }}
        labelRender={(label) => {
          const selectedName = String(label.value ?? "");
          return <TagSelectedValue tag={tagByName.get(selectedName)} fallbackName={selectedName} />;
        }}
        optionRender={(option) => {
          const opt = option.data as TagSelectOption;
          return <TagOptionRow tag={opt.tag} />;
        }}
        notFoundContent={
          <Space direction="vertical" style={{ width: "100%", padding: 8 }}>
            <Typography.Text type="secondary">No tags found</Typography.Text>
            <Button size="small" type="link" onClick={() => setCreateModalOpen(true)}>
              + Create new tag
            </Button>
          </Space>
        }
        popupRender={(menu) => (
          <div>
            {menu}
            <div style={{ borderTop: "1px solid #f0f0f0", padding: 8 }}>
              <Button size="small" type="link" onClick={() => setCreateModalOpen(true)} block>
                + Create new tag
              </Button>
            </div>
          </div>
        )}
      />

      {value && !tagExists ? (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          Warning: Tag "{value}" not found in project tags
        </Typography.Text>
      ) : null}

      <Modal
        title="Create New Tag"
        open={createModalOpen}
        onOk={handleCreateTag}
        onCancel={() => {
          setCreateModalOpen(false);
          setNewTagName("");
          setNewTagType("BOOL");
        }}
        okText="Create & Select"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Typography.Text>Tag Name</Typography.Text>
            <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Enter tag name" />
          </div>
          <div>
            <Typography.Text>Data Type</Typography.Text>
            <Select
              style={{ width: "100%" }}
              value={newTagType}
              onChange={setNewTagType}
              options={["BOOL", "INT", "DINT", "REAL", "STRING"].map((dt) => ({
                label: dt,
                value: dt,
              }))}
            />
          </div>
        </Space>
      </Modal>
    </Space>
  );
}
