import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { WorkbenchButton, WorkbenchWindow } from "../components/workbench";
import type { WorkbenchWindowRect } from "../components/workbench";
import { api, type ArchivePolicy, type ArchivePolicyPayload, type ArchiveStatus, type ArchiveTagConfig, type ArchiveTagOverride } from "../services/api";

type PolicyFormState = ArchivePolicyPayload;

type OverrideFormState = {
  enabled: "inherit" | "true" | "false";
  mode?: string;
  periodMs?: number | null;
  deadband?: number | null;
  retentionDays?: number | null;
  aggregateEnabled: "inherit" | "true" | "false";
  compressionAfterDays?: number | null;
};

const defaultPolicy: PolicyFormState = {
  name: "Fast analog archive",
  enabled: true,
  mode: "on_change_with_periodic",
  periodMs: 1000,
  deadband: 0,
  retentionDays: 365,
  aggregateEnabled: true,
  compressionAfterDays: 7,
};

function boolSelectToOverride(value: "inherit" | "true" | "false"): boolean | null {
  if (value === "inherit") {
    return null;
  }
  return value === "true";
}

function boolToSelect(value: boolean | null | undefined): "inherit" | "true" | "false" {
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  return "inherit";
}

function cleanOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type ArchiveWorkbenchDialogProps = {
  id: string;
  title: string;
  open: boolean;
  defaultRect: WorkbenchWindowRect;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
};

function ArchiveWorkbenchDialog({ id, title, open, defaultRect, children, onClose, onSubmit }: ArchiveWorkbenchDialogProps) {
  const [rect, setRect] = useState<WorkbenchWindowRect>(defaultRect);

  useEffect(() => {
    if (!open) {
      return;
    }
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    setRect({
      ...defaultRect,
      x: Math.max(24, Math.round((viewportWidth - defaultRect.width) / 2)),
      y: Math.max(24, Math.round((viewportHeight - defaultRect.height) / 2)),
    });
  }, [defaultRect.height, defaultRect.width, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="archive-workbench-dialog-layer">
      <WorkbenchWindow
        id={id}
        title={title}
        rect={rect}
        zIndex={1800}
        minWidth={520}
        minHeight={320}
        onClose={onClose}
        onFocus={() => undefined}
        onMove={(x, y) => setRect((prev) => ({ ...prev, x, y }))}
        onResize={setRect}
      >
        <div className="archive-workbench-dialog">
          <div className="archive-workbench-dialog__body">{children}</div>
          <div className="archive-workbench-dialog__footer">
            <WorkbenchButton onClick={onClose}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={onSubmit}>OK</WorkbenchButton>
          </div>
        </div>
      </WorkbenchWindow>
    </div>
  );
}

export function ArchivePage() {
  const [status, setStatus] = useState<ArchiveStatus>({ enabled: false, queuedSamples: 0 });
  const [policies, setPolicies] = useState<ArchivePolicy[]>([]);
  const [tagConfigs, setTagConfigs] = useState<ArchiveTagConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [overrideTag, setOverrideTag] = useState<ArchiveTagConfig | null>(null);
  const [policyForm] = Form.useForm<PolicyFormState>();
  const [overrideForm] = Form.useForm<OverrideFormState>();

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const nextStatus = await api.getArchiveStatus();
      setStatus(nextStatus);
      if (!nextStatus.enabled) {
        setPolicies([]);
        setTagConfigs([]);
        return;
      }
      const [nextPolicies, nextTagConfigs] = await Promise.all([api.listArchivePolicies(), api.listArchiveTagConfigs()]);
      setPolicies(nextPolicies);
      setTagConfigs(nextTagConfigs);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Archive load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreatePolicy = (): void => {
    setEditingPolicyId(null);
    policyForm.setFieldsValue(defaultPolicy);
    setPolicyModalOpen(true);
  };

  const openEditPolicy = (policy: ArchivePolicy): void => {
    setEditingPolicyId(policy.id);
    policyForm.setFieldsValue({
      name: policy.name,
      enabled: policy.enabled,
      mode: policy.mode,
      periodMs: policy.periodMs,
      deadband: policy.deadband,
      retentionDays: policy.retentionDays,
      aggregateEnabled: policy.aggregateEnabled,
      compressionAfterDays: policy.compressionAfterDays,
    });
    setPolicyModalOpen(true);
  };

  const savePolicy = async (): Promise<void> => {
    const values = await policyForm.validateFields();
    const payload: ArchivePolicyPayload = {
      ...values,
      compressionAfterDays: values.compressionAfterDays ?? null,
    };
    if (editingPolicyId) {
      await api.updateArchivePolicy(editingPolicyId, payload);
      void message.success("Archive policy updated");
    } else {
      await api.createArchivePolicy(payload);
      void message.success("Archive policy created");
    }
    setPolicyModalOpen(false);
    await load();
  };

  const deletePolicy = (policy: ArchivePolicy): void => {
    Modal.confirm({
      title: `Delete policy ${policy.name}?`,
      onOk: async () => {
        await api.deleteArchivePolicy(policy.id);
        void message.success("Archive policy deleted");
        await load();
      },
    });
  };

  const openOverride = (row: ArchiveTagConfig): void => {
    setOverrideTag(row);
    overrideForm.setFieldsValue({
      enabled: boolToSelect(row.override?.enabled),
      mode: row.override?.mode ?? undefined,
      periodMs: row.override?.periodMs ?? undefined,
      deadband: row.override?.deadband ?? undefined,
      retentionDays: row.override?.retentionDays ?? undefined,
      aggregateEnabled: boolToSelect(row.override?.aggregateEnabled),
      compressionAfterDays: row.override?.compressionAfterDays ?? undefined,
    });
  };

  const saveOverride = async (): Promise<void> => {
    if (!overrideTag) {
      return;
    }
    const values = await overrideForm.validateFields();
    const payload: ArchiveTagOverride = {
      enabled: boolSelectToOverride(values.enabled),
      mode: values.mode?.trim() || null,
      periodMs: cleanOptionalNumber(values.periodMs),
      deadband: cleanOptionalNumber(values.deadband),
      retentionDays: cleanOptionalNumber(values.retentionDays),
      aggregateEnabled: boolSelectToOverride(values.aggregateEnabled),
      compressionAfterDays: cleanOptionalNumber(values.compressionAfterDays),
    };
    await api.updateArchiveTagOverride(overrideTag.tagName, payload);
    void message.success("Tag override saved");
    setOverrideTag(null);
    await load();
  };

  const clearOverride = async (row: ArchiveTagConfig): Promise<void> => {
    await api.deleteArchiveTagOverride(row.tagName);
    void message.success("Tag override cleared");
    await load();
  };

  const policyOptions = useMemo(
    () => [
      { label: "No policy", value: 0 },
      ...policies.map((policy) => ({ label: policy.name, value: policy.id })),
    ],
    [policies],
  );

  const policyColumns: ColumnsType<ArchivePolicy> = [
    {
      title: "Name",
      dataIndex: "name",
      width: 220,
      render: (name: string, row) => (
        <Space>
          <Typography.Text strong>{name}</Typography.Text>
          {row.enabled ? <Tag color="green">enabled</Tag> : <Tag>disabled</Tag>}
        </Space>
      ),
    },
    { title: "Mode", dataIndex: "mode", width: 180 },
    { title: "Period ms", dataIndex: "periodMs", width: 110 },
    { title: "Deadband", dataIndex: "deadband", width: 100 },
    { title: "Retention days", dataIndex: "retentionDays", width: 130 },
    {
      title: "Compression after",
      dataIndex: "compressionAfterDays",
      width: 150,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "Actions",
      width: 180,
      render: (_, row) => (
        <Space>
          <WorkbenchButton onClick={() => openEditPolicy(row)}>Edit</WorkbenchButton>
          <WorkbenchButton variant="danger" onClick={() => deletePolicy(row)}>Delete</WorkbenchButton>
        </Space>
      ),
    },
  ];

  const tagColumns: ColumnsType<ArchiveTagConfig> = [
    { title: "Tag", dataIndex: "tagName", width: 260 },
    {
      title: "Policy",
      width: 240,
      render: (_, row) => (
        <Select
          size="small"
          value={row.policyId ?? 0}
          options={policyOptions}
          style={{ width: 220 }}
          onChange={async (value) => {
            await api.assignArchiveTagPolicy(row.tagName, value === 0 ? null : value);
            await load();
          }}
        />
      ),
    },
    {
      title: "Effective",
      width: 300,
      render: (_, row) => (
        <Space wrap>
          {row.enabled ? <Tag color="green">enabled</Tag> : <Tag>disabled</Tag>}
          <Tag>{row.mode ?? "-"}</Tag>
          <Tag>{row.periodMs ?? "-"} ms</Tag>
          <Tag>{row.retentionDays ?? "-"} d</Tag>
        </Space>
      ),
    },
    {
      title: "Override",
      width: 170,
      render: (_, row) => (
        <Space>
          <WorkbenchButton onClick={() => openOverride(row)}>
            {row.override ? "Edit" : "Set"}
          </WorkbenchButton>
          {row.override ? <WorkbenchButton onClick={() => void clearOverride(row)}>Clear</WorkbenchButton> : null}
        </Space>
      ),
    },
  ];

  const archiveDisabled = !status.enabled;

  return (
    <div className="archive-workbench-page">
      <Card size="small">
        <Space wrap>
          {status.enabled ? <Tag color="green">Archive enabled</Tag> : <Tag color="red">Archive disabled</Tag>}
          <Typography.Text type="secondary">Queue: {status.queuedSamples}</Typography.Text>
          <WorkbenchButton onClick={() => void load()} disabled={loading}>{loading ? "Refreshing" : "Refresh"}</WorkbenchButton>
          <WorkbenchButton
            disabled={archiveDisabled}
            onClick={async () => {
              const result = await api.runArchiveMaintenance();
              void message.success(`Deleted samples: ${result.deletedSamples}`);
              await load();
            }}
          >
            Run Maintenance
          </WorkbenchButton>
        </Space>
      </Card>

      {archiveDisabled ? (
        <Card size="small">
          <Space direction="vertical">
            <Typography.Text type="secondary">Archive database is not configured on the server.</Typography.Text>
            {status.reason ? <Typography.Text type="secondary">{status.reason}</Typography.Text> : null}
          </Space>
        </Card>
      ) : (
        <Tabs
          items={[
            {
              key: "policies",
              label: "Policies",
              children: (
                <Card
                  size="small"
                  title="Archive Policies"
                  extra={<WorkbenchButton variant="primary" onClick={openCreatePolicy}>Add Policy</WorkbenchButton>}
                >
                  <Table
                    rowKey="id"
                    size="small"
                    loading={loading}
                    columns={policyColumns}
                    dataSource={policies}
                    pagination={false}
                    scroll={{ x: 1100 }}
                  />
                </Card>
              ),
            },
            {
              key: "tags",
              label: "Tag Config",
              children: (
                <Card size="small" title="Tag Archive Config">
                  <Table
                    rowKey="tagId"
                    size="small"
                    loading={loading}
                    columns={tagColumns}
                    dataSource={tagConfigs}
                    pagination={{ pageSize: 50 }}
                    scroll={{ x: 1100 }}
                  />
                </Card>
              ),
            },
          ]}
        />
      )}

      <ArchiveWorkbenchDialog
        id="archive-policy-editor"
        title={editingPolicyId ? "Edit Archive Policy" : "Add Archive Policy"}
        open={policyModalOpen}
        defaultRect={{ x: 0, y: 0, width: 620, height: 440 }}
        onClose={() => setPolicyModalOpen(false)}
        onSubmit={() => void savePolicy()}
      >
        <Form form={policyForm} layout="vertical" size="small">
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="mode" label="Mode" rules={[{ required: true }]}>
            <Select
              options={[
                { label: "on_change_with_periodic", value: "on_change_with_periodic" },
                { label: "periodic", value: "periodic" },
                { label: "on_change", value: "on_change" },
              ]}
            />
          </Form.Item>
          <Space>
            <Form.Item name="periodMs" label="Period ms" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="deadband" label="Deadband" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="retentionDays" label="Retention days" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="compressionAfterDays" label="Compression after">
              <InputNumber min={1} style={{ width: 130 }} />
            </Form.Item>
          </Space>
          <Form.Item name="aggregateEnabled" label="Aggregates enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </ArchiveWorkbenchDialog>

      <ArchiveWorkbenchDialog
        id="archive-tag-override-editor"
        title={overrideTag ? `Override: ${overrideTag.tagName}` : "Tag Override"}
        open={Boolean(overrideTag)}
        defaultRect={{ x: 0, y: 0, width: 620, height: 420 }}
        onClose={() => setOverrideTag(null)}
        onSubmit={() => void saveOverride()}
      >
        <Form form={overrideForm} layout="vertical" size="small">
          <Form.Item name="enabled" label="Enabled">
            <Select
              options={[
                { label: "Inherit", value: "inherit" },
                { label: "Enabled", value: "true" },
                { label: "Disabled", value: "false" },
              ]}
            />
          </Form.Item>
          <Form.Item name="mode" label="Mode">
            <Select
              allowClear
              options={[
                { label: "on_change_with_periodic", value: "on_change_with_periodic" },
                { label: "periodic", value: "periodic" },
                { label: "on_change", value: "on_change" },
              ]}
            />
          </Form.Item>
          <Space>
            <Form.Item name="periodMs" label="Period ms">
              <InputNumber min={1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="deadband" label="Deadband">
              <InputNumber min={0} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="retentionDays" label="Retention days">
              <InputNumber min={1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="compressionAfterDays" label="Compression after">
              <InputNumber min={1} style={{ width: 130 }} />
            </Form.Item>
          </Space>
          <Form.Item name="aggregateEnabled" label="Aggregates enabled">
            <Select
              options={[
                { label: "Inherit", value: "inherit" },
                { label: "Enabled", value: "true" },
                { label: "Disabled", value: "false" },
              ]}
            />
          </Form.Item>
        </Form>
      </ArchiveWorkbenchDialog>
    </div>
  );
}
