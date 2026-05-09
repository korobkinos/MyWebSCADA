import { useMemo, useRef, useState } from "react";
import type { DockPanelState, TagDefinition, TagSourceType } from "@web-scada/shared";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, InputNumber, List, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { FloatingPanel } from "../components/floating-panel";
import { ResizableDockPanel } from "../components/resizable-dock-panel";
import { useDockLayout } from "../hooks/use-dock-layout";
import { useScadaStore } from "../store/scada-store";

const sourceTypeOptions: Array<{ label: string; value: TagSourceType }> = [
  { label: "OPC UA", value: "opcua" },
  { label: "LW", value: "lw" },
  { label: "Internal", value: "internal" },
  { label: "Computed", value: "computed" },
  { label: "Simulated", value: "simulated" },
];

const dataTypeOptions = ["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"];

const dockDefaults: DockPanelState[] = [
  { id: "tags.left", side: "left", hidden: false, size: 320, lastVisibleSize: 320 },
  { id: "tags.right", side: "right", hidden: false, size: 360, lastVisibleSize: 360 },
];
const defaultLeftPanel = dockDefaults[0]!;
const defaultRightPanel = dockDefaults[1]!;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createId(): string {
  return `tag_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function TagsPage() {
  const project = useScadaStore((s) => s.project);
  const drivers = useScadaStore((s) => s.project?.drivers ?? []);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<TagSourceType | "all">("all");
  const [driverFilter, setDriverFilter] = useState<string | "all">("all");
  const [groupFilter, setGroupFilter] = useState<string | "all">("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [form] = Form.useForm<TagDefinition>();

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dock = useDockLayout(dockDefaults, { autoSaveMs: 900 });
  const leftPanel = dock.getPanelState("tags.left") ?? defaultLeftPanel;
  const rightPanel = dock.getPanelState("tags.right") ?? defaultRightPanel;

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const tags = project.tags ?? [];

  const groupOptions = useMemo(
    () => [...new Set(tags.map((tag) => tag.group).filter((value): value is string => Boolean(value)))],
    [tags],
  );

  const filtered = useMemo(
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

  const start = (page - 1) * 50;
  const pageRows = filtered.slice(start, start + 50);
  const selectedTag = tags.find((tag) => (tag.id ?? tag.name) === selectedId) ?? pageRows[0] ?? null;

  const saveTags = (nextTags: TagDefinition[]): void => {
    updateProjectJson({ ...project, tags: nextTags });
  };

  const openAdd = (): void => {
    setEditingId(null);
    form.setFieldsValue({
      id: createId(),
      name: "",
      sourceType: "opcua",
      dataType: "REAL",
      writable: false,
      scanRateMs: 500,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    setOpen(true);
  };

  const openEdit = (tag: TagDefinition): void => {
    setEditingId(tag.id ?? tag.name);
    form.setFieldsValue({ ...tag });
    setOpen(true);
  };

  const deleteTag = (tag: TagDefinition): void => {
    Modal.confirm({
      title: `Delete tag ${tag.name}?`,
      onOk: () => {
        saveTags(tags.filter((item) => (item.id ?? item.name) !== (tag.id ?? tag.name)));
      },
    });
  };

  const duplicateTag = (tag: TagDefinition): void => {
    let base = `${tag.name}_copy`;
    let i = 1;
    while (tags.some((item) => item.name === base)) {
      i += 1;
      base = `${tag.name}_copy_${i}`;
    }
    saveTags([
      ...tags,
      {
        ...tag,
        id: createId(),
        name: base,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ]);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const normalized: TagDefinition = {
      ...values,
      id: values.id ?? createId(),
      name: values.name.trim(),
      sourceType: values.sourceType ?? "simulated",
      createdAt: editingId ? values.createdAt ?? nowIso() : nowIso(),
      updatedAt: nowIso(),
    };

    if (!normalized.name) {
      void message.error("Tag name is required");
      return;
    }

    const duplicate = tags.some(
      (item) => item.name === normalized.name && (item.id ?? item.name) !== (editingId ?? ""),
    );
    if (duplicate) {
      void message.error("Tag name must be unique");
      return;
    }

    const next = editingId
      ? tags.map((item) => ((item.id ?? item.name) === editingId ? normalized : item))
      : [...tags, normalized];

    saveTags(next);
    setSelectedId(normalized.id ?? normalized.name);
    setOpen(false);
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
    const a = document.createElement("a");
    a.href = url;
    a.download = "tags.csv";
    a.click();
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
      const headers = parseCsv(lines[0] ?? "").map((h) => h.trim());
      const rows = lines.slice(1).map((line) => parseCsv(line));
      const next = rows
        .map((cells): TagDefinition => {
          const map = new Map<string, string>();
          headers.forEach((header, index) => {
            map.set(header, cells[index] ?? "");
          });
          const sourceType = (map.get("sourceType") as TagSourceType | undefined) ?? "simulated";
          const lwAddressRaw = map.get("lwAddress") ?? map.get("address");
          const lwAddress = lwAddressRaw ? Number(lwAddressRaw) : undefined;
          return {
            id: createId(),
            name: map.get("name") ?? "",
            description: map.get("description") ?? undefined,
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
            internalVariableName: map.get("internalVariableName") || undefined,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
        })
        .filter((tag) => tag.name);
      saveTags(next);
      void message.success(`Imported ${next.length} tags`);
    };
    reader.readAsText(file);
  };

  const sourceType = Form.useWatch("sourceType", form) as TagSourceType | undefined;
  const driverOptions = drivers.filter((driver) => {
    if (sourceType === "opcua") {
      return driver.type === "opcua";
    }
    if (sourceType === "simulated") {
      return driver.type === "simulated";
    }
    return false;
  });

  const setDetached = (panelId: "tags.left" | "tags.right", detached: boolean) => {
    dock.setPanelState(panelId, (prev) => ({
      ...prev,
      detached,
      hidden: detached ? true : false,
      x: prev.x ?? (panelId === "tags.left" ? 90 : 420),
      y: prev.y ?? 120,
      width: prev.width ?? prev.size,
      height: prev.height ?? 560,
    }));
  };

  const filtersPanel = (
    <Card
      size="small"
      title="Tag Filters"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("tags.left", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("tags.left", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      <Button type="primary" onClick={openAdd}>Add Tag</Button>
      <Button onClick={exportCsv}>Export CSV</Button>
      <label style={{ cursor: "pointer" }}>
        <Button>Import CSV</Button>
        <input
          hidden
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              importCsv(file);
            }
            event.currentTarget.value = "";
          }}
        />
      </label>
      <Button onClick={() => void saveProject()}>Save Project</Button>

      <Input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Select
        value={sourceFilter}
        onChange={(value) => setSourceFilter(value)}
        options={[{ label: "All", value: "all" }, ...sourceTypeOptions]}
      />
      <Select
        value={driverFilter}
        onChange={(value) => setDriverFilter(value)}
        options={[
          { label: "All drivers", value: "all" },
          ...drivers.map((driver) => ({ label: `${driver.name ?? driver.id} (${driver.type})`, value: driver.id })),
        ]}
      />
      <Select
        value={groupFilter}
        onChange={(value) => setGroupFilter(value)}
        options={[{ label: "All groups", value: "all" }, ...groupOptions.map((group) => ({ label: group, value: group }))]}
      />
      <Typography.Text type="secondary">Rows: {filtered.length}</Typography.Text>
    </Card>
  );

  const detailsPanel = (
    <Card
      size="small"
      title="Tag Details"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("tags.right", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("tags.right", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      {selectedTag ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text strong>{selectedTag.name}</Typography.Text>
          <Tag>{selectedTag.sourceType ?? "simulated"}</Tag>
          <Typography.Text type="secondary">Type: {selectedTag.dataType}</Typography.Text>
          <Typography.Text type="secondary">Driver: {selectedTag.driverId ?? "-"}</Typography.Text>
          <Typography.Text type="secondary">Address: {selectedTag.nodeId ?? String(selectedTag.lwAddress ?? selectedTag.internalVariableName ?? selectedTag.address ? JSON.stringify(selectedTag.address) : "-")}</Typography.Text>
          <Typography.Text type="secondary">Group: {selectedTag.group ?? "-"}</Typography.Text>
          <Space>
            <Button size="small" onClick={() => openEdit(selectedTag)}>Edit</Button>
            <Button size="small" onClick={() => duplicateTag(selectedTag)}>Duplicate</Button>
            <Button size="small" danger onClick={() => deleteTag(selectedTag)}>Delete</Button>
          </Space>
        </Space>
      ) : (
        <Typography.Text type="secondary">Select tag</Typography.Text>
      )}
    </Card>
  );

  return (
    <div
      ref={workspaceRef}
      className="route-page-fill"
      style={{ display: "flex", gap: 10, minWidth: 0, minHeight: 0, overflow: "hidden", position: "relative" }}
    >
      {!leftPanel.detached ? (
        <ResizableDockPanel
          id="tags.left"
          side="left"
          hidden={leftPanel.hidden}
          size={clamp(leftPanel.size, 0, 540)}
          lastVisibleSize={leftPanel.lastVisibleSize}
          minSize={220}
          maxSize={540}
          autoHideThreshold={80}
          restoreSize={320}
          workspaceRef={workspaceRef}
          restoreTooltip="Show tag filters"
          restoreIcon={<RightOutlined />}
          onStateChange={(state) => dock.setPanelState("tags.left", () => state)}
        >
          {filtersPanel}
        </ResizableDockPanel>
      ) : null}

      <Card
        size="small"
        title="Tags"
        style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
        bodyStyle={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        <Table
          size="small"
          rowKey={(tag) => tag.id ?? tag.name}
          dataSource={pageRows}
          pagination={{
            current: page,
            pageSize: 50,
            total: filtered.length,
            onChange: setPage,
          }}
          onRow={(row) => ({
            onClick: () => setSelectedId(row.id ?? row.name),
          })}
          columns={[
            { title: "name", dataIndex: "name" },
            {
              title: "source",
              width: 120,
              render: (_, row: TagDefinition) => <Tag>{row.sourceType ?? "simulated"}</Tag>,
            },
            { title: "dataType", dataIndex: "dataType", width: 90 },
            { title: "driverId", dataIndex: "driverId", width: 140 },
            {
              title: "node/address",
              width: 190,
              render: (_, row: TagDefinition) =>
                row.nodeId ?? String(row.address ?? row.lwAddress ?? row.internalVariableName ?? ""),
            },
            { title: "group", dataIndex: "group", width: 120 },
            {
              title: "w",
              width: 40,
              render: (_, row: TagDefinition) => (row.writable ? "Y" : "N"),
            },
            {
              title: "actions",
              width: 170,
              render: (_, row: TagDefinition) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(row)}>Edit</Button>
                  <Button size="small" onClick={() => duplicateTag(row)}>Duplicate</Button>
                  <Button size="small" danger onClick={() => deleteTag(row)}>Delete</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {!rightPanel.detached ? (
        <ResizableDockPanel
          id="tags.right"
          side="right"
          hidden={rightPanel.hidden}
          size={clamp(rightPanel.size, 0, 680)}
          lastVisibleSize={rightPanel.lastVisibleSize}
          minSize={240}
          maxSize={680}
          autoHideThreshold={80}
          restoreSize={360}
          workspaceRef={workspaceRef}
          restoreTooltip="Show tag details"
          restoreIcon={<LeftOutlined />}
          onStateChange={(state) => dock.setPanelState("tags.right", () => state)}
        >
          {detailsPanel}
        </ResizableDockPanel>
      ) : null}

      {leftPanel.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Tag Filters"
            rect={{ x: leftPanel.x ?? 90, y: leftPanel.y ?? 120, width: leftPanel.width ?? 340, height: leftPanel.height ?? 560 }}
            onRectChange={(rect) =>
              dock.setPanelState("tags.left", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))
            }
            onClose={() => setDetached("tags.left", false)}
            onDockLeft={() =>
              dock.setPanelState("tags.left", (prev) => ({ ...prev, detached: false, hidden: false, side: "left" }))
            }
          >
            {filtersPanel}
          </FloatingPanel>
        </div>
      ) : null}

      {rightPanel.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Tag Details"
            rect={{ x: rightPanel.x ?? 420, y: rightPanel.y ?? 120, width: rightPanel.width ?? 380, height: rightPanel.height ?? 560 }}
            onRectChange={(rect) =>
              dock.setPanelState("tags.right", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))
            }
            onClose={() => setDetached("tags.right", false)}
            onDockRight={() =>
              dock.setPanelState("tags.right", (prev) => ({ ...prev, detached: false, hidden: false, side: "right" }))
            }
          >
            {detailsPanel}
          </FloatingPanel>
        </div>
      ) : null}

      <Modal
        title={editingId ? "Edit Tag" : "Add Tag"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        width={680}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
          <Form.Item name="sourceType" label="Source Type" rules={[{ required: true }]}>
            <Select options={sourceTypeOptions} />
          </Form.Item>
          <Form.Item name="dataType" label="Data Type" rules={[{ required: true }]}>
            <Select options={dataTypeOptions.map((type) => ({ label: type, value: type }))} />
          </Form.Item>

          {sourceType === "opcua" ? (
            <>
              <Form.Item name="driverId" label="OPC UA Driver" rules={[{ required: true }]}>
                <Select options={driverOptions.map((driver) => ({ label: driver.name ?? driver.id, value: driver.id }))} />
              </Form.Item>
              <Form.Item name="nodeId" label="NodeId" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </>
          ) : null}

          {sourceType === "lw" ? (
            <>
              <Form.Item name="lwAddress" label="LW Address" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Form.Item name="persistent" label="Persistent" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          ) : null}

          {sourceType === "internal" ? (
            <Form.Item name="internalVariableName" label="Internal Variable Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          ) : null}

          <Space style={{ width: "100%" }}>
            <Form.Item name="scanRateMs" label="Scan Rate ms" style={{ width: 180 }}>
              <InputNumber style={{ width: "100%" }} min={50} />
            </Form.Item>
            <Form.Item name="scale" label="Scale" style={{ width: 120 }}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="offset" label="Offset" style={{ width: 120 }}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="group" label="Group" style={{ width: 140 }}>
              <Input />
            </Form.Item>
          </Space>

          <Form.Item name="writable" label="Writable" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function parseCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
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
