import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Form, Input, InputNumber, Select, Space, Switch, Tag, message } from "antd";
import { WorkbenchButton, WorkbenchWindow } from "../components/workbench";
import type { WorkbenchWindowRect } from "../components/workbench";
import {
  api,
  type ArchivePolicy,
  type ArchivePolicyPayload,
  type ArchiveRuntimeSettings,
  type ArchiveStatus,
  type ArchiveTagConfig,
  type ArchiveTagOverride,
  type EventArchiveStatus,
  type OperatorActionArchiveStatus,
} from "../services/api";
import type { EventArchiveSettings, OperatorActionArchiveSettings } from "@web-scada/shared";

type PolicyFormState = ArchivePolicyPayload;
type ArchiveColumnId = "select" | "name" | "policy" | "mode" | "period" | "retention" | "override";
type ArchiveColumnConfig = {
  id: ArchiveColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
};
type ArchiveColumnVisibility = Record<ArchiveColumnId, boolean>;

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

const ARCHIVE_COLUMNS: ArchiveColumnConfig[] = [
  { id: "select", title: "", defaultWidth: 42, minWidth: 42 },
  { id: "name", title: "NAME", defaultWidth: 300, minWidth: 160 },
  { id: "policy", title: "POLICY", defaultWidth: 220, minWidth: 130 },
  { id: "mode", title: "MODE", defaultWidth: 170, minWidth: 120 },
  { id: "period", title: "PERIOD", defaultWidth: 120, minWidth: 90 },
  { id: "retention", title: "RETENTION", defaultWidth: 120, minWidth: 90 },
  { id: "override", title: "OVERRIDE", defaultWidth: 90, minWidth: 70 },
];

const ARCHIVE_COLUMNS_WIDTH_STORAGE_KEY = "screenEditor.archive.columnWidths";
const ARCHIVE_COLUMN_VISIBILITY_STORAGE_KEY = "screenEditor.archive.columnVisibility";

function createDefaultArchiveColumnVisibility(): ArchiveColumnVisibility {
  return ARCHIVE_COLUMNS.reduce<ArchiveColumnVisibility>(
    (acc, column) => ({ ...acc, [column.id]: true }),
    {
      select: true,
      name: true,
      policy: true,
      mode: true,
      period: true,
      retention: true,
      override: true,
    },
  );
}

function createDefaultArchiveColumnWidths(): Record<ArchiveColumnId, number> {
  return ARCHIVE_COLUMNS.reduce<Record<ArchiveColumnId, number>>(
    (acc, column) => ({ ...acc, [column.id]: column.defaultWidth }),
    {
      select: 0,
      name: 0,
      policy: 0,
      mode: 0,
      period: 0,
      retention: 0,
      override: 0,
    },
  );
}

function parseStoredArchiveColumnWidths(raw: string | null): Record<ArchiveColumnId, number> {
  const defaults = createDefaultArchiveColumnWidths();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ArchiveColumnId, unknown>>;
    return ARCHIVE_COLUMNS.reduce<Record<ArchiveColumnId, number>>((acc, column) => {
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

function parseStoredArchiveColumnVisibility(raw: string | null): ArchiveColumnVisibility {
  const defaults = createDefaultArchiveColumnVisibility();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ArchiveColumnId, unknown>>;
    const next = ARCHIVE_COLUMNS.reduce<ArchiveColumnVisibility>((acc, column) => {
      acc[column.id] = parsed[column.id] === false ? false : true;
      return acc;
    }, { ...defaults });
    next.select = true;
    next.name = true;
    if (!Object.values(next).some(Boolean)) {
      next.name = true;
    }
    return next;
  } catch {
    return defaults;
  }
}

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
  zIndex?: number;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  submitVariant?: "primary" | "danger" | "ghost";
  submitDisabled?: boolean;
  cancelDisabled?: boolean;
};

function ArchiveWorkbenchDialog({
  id,
  title,
  open,
  defaultRect,
  zIndex,
  children,
  onClose,
  onSubmit,
  submitLabel,
  cancelLabel,
  submitVariant,
  submitDisabled,
  cancelDisabled,
}: ArchiveWorkbenchDialogProps) {
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
    <div className="archive-workbench-dialog-layer" style={{ zIndex: zIndex ?? 1800 }}>
      <WorkbenchWindow
        id={id}
        title={title}
        rect={rect}
        zIndex={zIndex ?? 1800}
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
            <WorkbenchButton onClick={onClose} disabled={cancelDisabled}>{cancelLabel ?? "Cancel"}</WorkbenchButton>
            <WorkbenchButton variant={submitVariant ?? "primary"} onClick={onSubmit} disabled={submitDisabled}>{submitLabel ?? "OK"}</WorkbenchButton>
          </div>
        </div>
      </WorkbenchWindow>
    </div>
  );
}

type ArchiveConfirmState = {
  title: string;
  message: string;
  submitLabel?: string;
  submitVariant?: "primary" | "danger" | "ghost";
  onConfirm: () => Promise<void>;
};

type ArchiveSettingsDraft = {
  autoCleanupEnabled: boolean;
  maxDbSizeMb: number | null;
  deleteBatchSize: number;
  maintenanceIntervalMs: number;
  maxMaintenanceTickMs: number;
  maxDeleteTransactionMs: number;
};

type MessageArchiveSettingsDraft = {
  enabled: boolean;
  retentionDays: number;
  maxDatabaseSizeMb: number;
  cleanupMode: "byAge" | "bySize" | "byAgeAndSize";
  cleanupIntervalMinutes: number;
  optimizeAfterCleanup: boolean;
  deleteBatchSize: number;
  maintenanceIntervalMs: number;
  maxMaintenanceTickMs: number;
  maxDeleteTransactionMs: number;
};

type ArchiveMaintenancePresetId = "safe" | "balanced" | "fast";

const ARCHIVE_MAINTENANCE_PRESETS: Record<ArchiveMaintenancePresetId, Omit<ArchiveSettingsDraft, "autoCleanupEnabled" | "maxDbSizeMb">> = {
  safe: {
    deleteBatchSize: 500,
    maintenanceIntervalMs: 3000,
    maxMaintenanceTickMs: 200,
    maxDeleteTransactionMs: 150,
  },
  balanced: {
    deleteBatchSize: 1000,
    maintenanceIntervalMs: 2000,
    maxMaintenanceTickMs: 300,
    maxDeleteTransactionMs: 150,
  },
  fast: {
    deleteBatchSize: 2500,
    maintenanceIntervalMs: 1000,
    maxMaintenanceTickMs: 800,
    maxDeleteTransactionMs: 300,
  },
};

const MIN_DELETE_BATCH_SIZE = 10;
const MAX_DELETE_BATCH_SIZE = 10_000;
const MIN_MAINTENANCE_INTERVAL_MS = 500;
const MAX_MAINTENANCE_INTERVAL_MS = 60_000;
const MIN_MAX_MAINTENANCE_TICK_MS = 50;
const MAX_MAX_MAINTENANCE_TICK_MS = 2_000;
const MIN_MAX_DELETE_TRANSACTION_MS = 50;
const MAX_MAX_DELETE_TRANSACTION_MS = 1_000;

const DEFAULT_DETAILS_WIDTH = 420;
const MIN_DETAILS_WIDTH = 300;
const MAX_DETAILS_WIDTH = 720;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampArchiveSetting(value: number | null | undefined, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return clamp(Math.round(numeric), min, max);
}

function formatStatusCheckTime(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleTimeString("ru-RU", { hour12: false });
}

function formatDbSizeMb(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(2);
}

function formatRecordsCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return Math.max(0, Math.round(value)).toLocaleString("ru-RU");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("ru-RU", { hour12: false });
}

function normalizeMessageArchiveDraft(
  source: Partial<MessageArchiveSettingsDraft> | null | undefined,
): MessageArchiveSettingsDraft {
  const deleteBatchSize = clampArchiveSetting(
    source?.deleteBatchSize,
    ARCHIVE_MAINTENANCE_PRESETS.safe.deleteBatchSize,
    MIN_DELETE_BATCH_SIZE,
    MAX_DELETE_BATCH_SIZE,
  );
  const maintenanceIntervalMs = clampArchiveSetting(
    source?.maintenanceIntervalMs,
    ARCHIVE_MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
    MIN_MAINTENANCE_INTERVAL_MS,
    MAX_MAINTENANCE_INTERVAL_MS,
  );
  const maxDeleteTransactionMs = clampArchiveSetting(
    source?.maxDeleteTransactionMs,
    ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
    MIN_MAX_DELETE_TRANSACTION_MS,
    MAX_MAX_DELETE_TRANSACTION_MS,
  );
  const maxMaintenanceTickMs = Math.max(
    clampArchiveSetting(
      source?.maxMaintenanceTickMs,
      ARCHIVE_MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
      MIN_MAX_MAINTENANCE_TICK_MS,
      MAX_MAX_MAINTENANCE_TICK_MS,
    ),
    maxDeleteTransactionMs,
  );
  return {
    enabled: source?.enabled !== false,
    retentionDays: Math.max(1, Math.round(source?.retentionDays ?? 90)),
    maxDatabaseSizeMb: Math.max(1, Math.round(source?.maxDatabaseSizeMb ?? 2048)),
    cleanupMode: source?.cleanupMode ?? "byAgeAndSize",
    cleanupIntervalMinutes: Math.max(1, Math.round(source?.cleanupIntervalMinutes ?? 60)),
    optimizeAfterCleanup: source?.optimizeAfterCleanup === true,
    deleteBatchSize,
    maintenanceIntervalMs,
    maxMaintenanceTickMs,
    maxDeleteTransactionMs,
  };
}

export function ArchivePage() {
  const [status, setStatus] = useState<ArchiveStatus>({ enabled: false, queuedSamples: 0 });
  const [lastLoadError, setLastLoadError] = useState<string | null>(null);
  const [lastStatusCheckAt, setLastStatusCheckAt] = useState<number | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<ArchiveRuntimeSettings | null>(null);
  const [eventArchiveStatus, setEventArchiveStatus] = useState<EventArchiveStatus | null>(null);
  const [operatorArchiveStatus, setOperatorArchiveStatus] = useState<OperatorActionArchiveStatus | null>(null);
  const [eventSettingsDraft, setEventSettingsDraft] = useState<MessageArchiveSettingsDraft>(() =>
    normalizeMessageArchiveDraft(null),
  );
  const [operatorSettingsDraft, setOperatorSettingsDraft] = useState<MessageArchiveSettingsDraft>(() =>
    normalizeMessageArchiveDraft(null),
  );
  const [policies, setPolicies] = useState<ArchivePolicy[]>([]);
  const [tagConfigs, setTagConfigs] = useState<ArchiveTagConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [overrideTag, setOverrideTag] = useState<ArchiveTagConfig | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ArchiveSettingsDraft>({
    autoCleanupEnabled: true,
    maxDbSizeMb: 5120,
    deleteBatchSize: ARCHIVE_MAINTENANCE_PRESETS.safe.deleteBatchSize,
    maintenanceIntervalMs: ARCHIVE_MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
    maxMaintenanceTickMs: ARCHIVE_MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
    maxDeleteTransactionMs: ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
  });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ArchiveConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [policyForm] = Form.useForm<PolicyFormState>();
  const [overrideForm] = Form.useForm<OverrideFormState>();

  const [search, setSearch] = useState("");
  const [policyFilter, setPolicyFilter] = useState<number | "all">("all");
  const [driverFilter, setDriverFilter] = useState<"all" | "opcua" | "simulated">("all");
  const [bulkPolicyId, setBulkPolicyId] = useState("0");
  const [policyManageId, setPolicyManageId] = useState("0");
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedTagName, setSelectedTagName] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState<Set<string>>(() => new Set());
  const [detailsPolicyId, setDetailsPolicyId] = useState("0");
  const [detailsWidth, setDetailsWidth] = useState(DEFAULT_DETAILS_WIDTH);
  const [isDetailsResizeActive, setIsDetailsResizeActive] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<ArchiveColumnId, number>>(() => {
    if (typeof window === "undefined") {
      return createDefaultArchiveColumnWidths();
    }
    return parseStoredArchiveColumnWidths(window.localStorage.getItem(ARCHIVE_COLUMNS_WIDTH_STORAGE_KEY));
  });
  const [columnVisibility, setColumnVisibility] = useState<ArchiveColumnVisibility>(() => {
    if (typeof window === "undefined") {
      return createDefaultArchiveColumnVisibility();
    }
    return parseStoredArchiveColumnVisibility(window.localStorage.getItem(ARCHIVE_COLUMN_VISIBILITY_STORAGE_KEY));
  });

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pageSelectCheckboxRef = useRef<HTMLInputElement | null>(null);

  const checkArchiveStatus = async (options?: { silent?: boolean }): Promise<ArchiveStatus | null> => {
    try {
      const nextStatus = await api.getArchiveStatus();
      setStatus(nextStatus);
      setLastLoadError(null);
      setLastStatusCheckAt(Date.now());
      return nextStatus;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Archive status check failed";
      setLastLoadError(errorText);
      setLastStatusCheckAt(Date.now());
      if (!options?.silent) {
        void message.error(errorText);
      }
      return null;
    }
  };

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const nextStatus = await checkArchiveStatus();
      if (!nextStatus) {
        return;
      }
      if (!nextStatus.enabled) {
        setPolicies([]);
        setTagConfigs([]);
        setRuntimeSettings(null);
        setEventArchiveStatus(null);
        setOperatorArchiveStatus(null);
        return;
      }
      const [
        nextPolicies,
        nextTagConfigs,
        nextSettings,
        nextEventArchiveStatus,
        nextOperatorArchiveStatus,
        nextEventArchiveSettings,
        nextOperatorArchiveSettings,
      ] = await Promise.all([
        api.listArchivePolicies(),
        api.listArchiveTagConfigs(),
        api.getArchiveSettings(),
        api.getEventArchiveStatus(),
        api.getOperatorActionArchiveStatus(),
        api.getEventArchiveSettings(),
        api.getOperatorActionArchiveSettings(),
      ]);
      setPolicies(nextPolicies);
      setTagConfigs(nextTagConfigs);
      setRuntimeSettings(nextSettings);
      setEventArchiveStatus(nextEventArchiveStatus);
      setOperatorArchiveStatus(nextOperatorArchiveStatus);
      setSettingsDraft({
        autoCleanupEnabled: nextSettings.autoCleanupEnabled,
        maxDbSizeMb: nextSettings.maxDbSizeMb,
        deleteBatchSize: nextSettings.deleteBatchSize,
        maintenanceIntervalMs: nextSettings.maintenanceIntervalMs,
        maxMaintenanceTickMs: nextSettings.maxMaintenanceTickMs,
        maxDeleteTransactionMs: nextSettings.maxDeleteTransactionMs,
      });
      setEventSettingsDraft(normalizeMessageArchiveDraft(nextEventArchiveSettings));
      setOperatorSettingsDraft(normalizeMessageArchiveDraft(nextOperatorArchiveSettings));
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Archive load failed";
      setLastLoadError(errorText);
      void message.error(errorText);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void checkArchiveStatus({ silent: true });
      void api.getEventArchiveStatus().then(setEventArchiveStatus).catch(() => undefined);
      void api.getOperatorActionArchiveStatus().then(setOperatorArchiveStatus).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (policies.length === 0) {
      setPolicyManageId("0");
      return;
    }
    if (policyManageId === "0") {
      setPolicyManageId(String(policies[0]!.id));
      return;
    }
    const exists = policies.some((item) => String(item.id) === policyManageId);
    if (!exists) {
      setPolicyManageId(String(policies[0]!.id));
    }
  }, [policies, policyManageId]);

  useEffect(() => {
    const existing = new Set(tagConfigs.map((item) => item.tagName));
    setSelectedTagNames((prev) => {
      const next = new Set<string>();
      prev.forEach((name) => {
        if (existing.has(name)) {
          next.add(name);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [tagConfigs]);

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
    setConfirmState({
      title: "Delete Archive Policy",
      message: `Delete policy "${policy.name}"?`,
      submitLabel: "Delete",
      submitVariant: "danger",
      onConfirm: async () => {
        try {
          await api.deleteArchivePolicy(policy.id);
          void message.success("Archive policy deleted");
          await load();
        } catch (error) {
          void message.error(error instanceof Error ? error.message : "Failed to delete archive policy");
        }
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

  const archiveDisabled = !status.enabled;
  const normalizedSearch = search.trim().toLowerCase();

  const searchMatchedTags = useMemo(
    () => (
      normalizedSearch
        ? tagConfigs.filter((item) => item.tagName.toLowerCase().includes(normalizedSearch))
        : []
    ),
    [normalizedSearch, tagConfigs],
  );

  const driverFilterOptions = useMemo(() => {
    const hasOpcUa = tagConfigs.some((tagConfig) => {
      const sourceType = (tagConfig.sourceType ?? "").toLowerCase();
      const driverType = (tagConfig.driverType ?? "").toLowerCase();
      return sourceType === "opcua" || driverType === "opcua";
    });
    const hasSimulated = tagConfigs.some((tagConfig) => {
      const sourceType = (tagConfig.sourceType ?? "").toLowerCase();
      const driverType = (tagConfig.driverType ?? "").toLowerCase();
      return sourceType === "simulated" || driverType === "simulated";
    });
    const options: Array<{ value: "all" | "opcua" | "simulated"; label: string }> = [
      { value: "all", label: "All drivers" },
    ];
    if (hasOpcUa) {
      options.push({ value: "opcua", label: "OPC UA" });
    }
    if (hasSimulated) {
      options.push({ value: "simulated", label: "Simulation" });
    }
    return options;
  }, [tagConfigs]);

  useEffect(() => {
    if (driverFilter === "all") {
      return;
    }
    const exists = driverFilterOptions.some((option) => option.value === driverFilter);
    if (!exists) {
      setDriverFilter("all");
    }
  }, [driverFilter, driverFilterOptions]);

  const filteredTags = useMemo(() => {
    return tagConfigs.filter((tagConfig) => {
      if (normalizedSearch && !tagConfig.tagName.toLowerCase().includes(normalizedSearch)) {
        return false;
      }
      if (policyFilter !== "all" && (tagConfig.policyId ?? 0) !== policyFilter) {
        return false;
      }
      if (driverFilter !== "all") {
        const sourceType = (tagConfig.sourceType ?? "").toLowerCase();
        const driverType = (tagConfig.driverType ?? "").toLowerCase();
        if (driverFilter === "opcua" && sourceType !== "opcua" && driverType !== "opcua") {
          return false;
        }
        if (driverFilter === "simulated" && sourceType !== "simulated" && driverType !== "simulated") {
          return false;
        }
      }
      return true;
    });
  }, [driverFilter, normalizedSearch, policyFilter, tagConfigs]);

  useEffect(() => {
    if (filteredTags.length === 0) {
      setSelectedTagName("");
      return;
    }
    const exists = filteredTags.some((item) => item.tagName === selectedTagName);
    if (!exists) {
      setSelectedTagName(filteredTags[0]!.tagName);
    }
  }, [filteredTags, selectedTagName]);

  const selectedTag = useMemo(
    () => filteredTags.find((item) => item.tagName === selectedTagName) ?? null,
    [filteredTags, selectedTagName],
  );

  useEffect(() => {
    if (!selectedTag) {
      setDetailsPolicyId("0");
      return;
    }
    setDetailsPolicyId(String(selectedTag.policyId ?? 0));
  }, [selectedTag]);

  const totalRows = filteredTags.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const pageRows = useMemo(
    () => filteredTags.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredTags, pageSize, safePage],
  );
  const selectedCount = selectedTagNames.size;
  const selectedInFilteredCount = useMemo(
    () => filteredTags.reduce((acc, item) => (selectedTagNames.has(item.tagName) ? acc + 1 : acc), 0),
    [filteredTags, selectedTagNames],
  );
  const selectedInPageCount = useMemo(
    () => pageRows.reduce((acc, item) => (selectedTagNames.has(item.tagName) ? acc + 1 : acc), 0),
    [pageRows, selectedTagNames],
  );
  const pageAllSelected = pageRows.length > 0 && selectedInPageCount === pageRows.length;
  const pagePartiallySelected = selectedInPageCount > 0 && !pageAllSelected;

  const selectedTags = useMemo(
    () => tagConfigs.filter((item) => selectedTagNames.has(item.tagName)),
    [selectedTagNames, tagConfigs],
  );

  useEffect(() => {
    if (!pageSelectCheckboxRef.current) {
      return;
    }
    pageSelectCheckboxRef.current.indeterminate = pagePartiallySelected;
  }, [pagePartiallySelected]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ARCHIVE_COLUMNS_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ARCHIVE_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  const visibleColumns = useMemo(() => {
    const next = ARCHIVE_COLUMNS.filter((column) => columnVisibility[column.id] !== false);
    return next.length > 0 ? next : ARCHIVE_COLUMNS.filter((column) => column.id === "select" || column.id === "name");
  }, [columnVisibility]);

  const archiveGridTemplateColumns = useMemo(
    () => visibleColumns.map((column) => `${columnWidths[column.id] ?? column.defaultWidth}px`).join(" "),
    [columnWidths, visibleColumns],
  );

  const toggleTagSelection = (tagName: string): void => {
    setSelectedTagNames((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  };

  const selectAllFiltered = (): void => {
    setSelectedTagNames(new Set(filteredTags.map((item) => item.tagName)));
  };

  const selectCurrentPage = (): void => {
    setSelectedTagNames((prev) => {
      const next = new Set(prev);
      pageRows.forEach((item) => next.add(item.tagName));
      return next;
    });
  };

  const clearSelected = (): void => {
    setSelectedTagNames(new Set());
  };

  const toggleCurrentPageSelection = (): void => {
    if (pageRows.length === 0) {
      return;
    }
    setSelectedTagNames((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) {
        pageRows.forEach((item) => next.delete(item.tagName));
      } else {
        pageRows.forEach((item) => next.add(item.tagName));
      }
      return next;
    });
  };

  const applyPolicyToTags = async (target: ArchiveTagConfig[], sourceLabel: string): Promise<void> => {
    if (archiveDisabled) {
      return;
    }
    if (target.length === 0) {
      void message.warning(`No ${sourceLabel} tags`);
      return;
    }
    const parsedPolicy = bulkPolicyId === "0" ? 0 : Number.parseInt(bulkPolicyId, 10);
    if (!Number.isFinite(parsedPolicy)) {
      void message.error("Invalid policy selected");
      return;
    }
    const policyId = parsedPolicy === 0 ? null : parsedPolicy;
    const policyLabel = policyId === null ? "No policy" : (policies.find((item) => item.id === policyId)?.name ?? `ID ${policyId}`);
    setConfirmState({
      title: "Assign Archive Policy",
      message: `Apply policy "${policyLabel}" to ${target.length} ${sourceLabel} tags?`,
      submitLabel: "Apply",
      submitVariant: "primary",
      onConfirm: async () => {
        try {
          await Promise.all(target.map((item) => api.assignArchiveTagPolicy(item.tagName, policyId)));
          void message.success(`Policy applied to ${target.length} tags`);
          await load();
        } catch (error) {
          void message.error(error instanceof Error ? error.message : "Failed to apply policy");
        }
      },
    });
  };

  const clearOverridesForTags = async (target: ArchiveTagConfig[], sourceLabel: string): Promise<void> => {
    if (archiveDisabled) {
      return;
    }
    const withOverrides = target.filter((item) => Boolean(item.override));
    if (withOverrides.length === 0) {
      void message.warning(`No overrides in ${sourceLabel} tags`);
      return;
    }
    setConfirmState({
      title: "Clear Archive Overrides",
      message: `Clear overrides for ${withOverrides.length} ${sourceLabel} tags?`,
      submitLabel: "Clear",
      submitVariant: "danger",
      onConfirm: async () => {
        try {
          await Promise.all(withOverrides.map((item) => api.deleteArchiveTagOverride(item.tagName)));
          void message.success(`Overrides cleared for ${withOverrides.length} tags`);
          await load();
        } catch (error) {
          void message.error(error instanceof Error ? error.message : "Failed to clear overrides");
        }
      },
    });
  };

  const runConfirmAction = async (): Promise<void> => {
    if (!confirmState || confirmBusy) {
      return;
    }
    setConfirmBusy(true);
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const assignPolicyToSelectedTag = async (): Promise<void> => {
    if (!selectedTag) {
      return;
    }
    const parsedPolicy = detailsPolicyId === "0" ? 0 : Number.parseInt(detailsPolicyId, 10);
    if (!Number.isFinite(parsedPolicy)) {
      void message.error("Invalid policy selected");
      return;
    }
    await api.assignArchiveTagPolicy(selectedTag.tagName, parsedPolicy === 0 ? null : parsedPolicy);
    void message.success("Policy updated");
    await load();
  };

  const selectedManagePolicy = policies.find((item) => String(item.id) === policyManageId) ?? null;

  const startColumnResize = (
    event: ReactMouseEvent<HTMLSpanElement>,
    columnId: ArchiveColumnId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const column = ARCHIVE_COLUMNS.find((item) => item.id === columnId);
    if (!column) {
      return;
    }
    const startX = event.clientX;
    const startWidth = columnWidths[columnId] ?? column.defaultWidth;

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(column.minWidth, startWidth + delta);
      setColumnWidths((prev) => ({
        ...prev,
        [columnId]: next,
      }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDetailsResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailsWidth;
    setIsDetailsResizeActive(true);

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      setDetailsWidth(clamp(startWidth + delta, MIN_DETAILS_WIDTH, MAX_DETAILS_WIDTH));
    };

    const onUp = () => {
      setIsDetailsResizeActive(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetWidths = () => {
    setDetailsWidth(DEFAULT_DETAILS_WIDTH);
    setColumnWidths(createDefaultArchiveColumnWidths());
  };

  const policySelectOptions = [
    { label: "No policy", value: "0" },
    ...policies.map((policy) => ({ label: policy.name, value: String(policy.id) })),
  ];
  const openSettings = (): void => {
    const source = runtimeSettings ?? {
      autoCleanupEnabled: true,
      maxDbSizeMb: 5120,
      deleteBatchSize: ARCHIVE_MAINTENANCE_PRESETS.safe.deleteBatchSize,
      maintenanceIntervalMs: ARCHIVE_MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
      maxMaintenanceTickMs: ARCHIVE_MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
      maxDeleteTransactionMs: ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
    };
    setSettingsDraft({
      autoCleanupEnabled: source.autoCleanupEnabled,
      maxDbSizeMb: source.maxDbSizeMb,
      deleteBatchSize: source.deleteBatchSize,
      maintenanceIntervalMs: source.maintenanceIntervalMs,
      maxMaintenanceTickMs: source.maxMaintenanceTickMs,
      maxDeleteTransactionMs: source.maxDeleteTransactionMs,
    });
    setEventSettingsDraft(normalizeMessageArchiveDraft(eventArchiveStatus?.settings));
    setOperatorSettingsDraft(normalizeMessageArchiveDraft(operatorArchiveStatus?.settings));
    setSettingsModalOpen(true);
  };

  const saveSettings = async (): Promise<void> => {
    setSettingsBusy(true);
    try {
      const deleteBatchSize = clampArchiveSetting(
        settingsDraft.deleteBatchSize,
        ARCHIVE_MAINTENANCE_PRESETS.safe.deleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      );
      const maintenanceIntervalMs = clampArchiveSetting(
        settingsDraft.maintenanceIntervalMs,
        ARCHIVE_MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      const maxDeleteTransactionMs = clampArchiveSetting(
        settingsDraft.maxDeleteTransactionMs,
        ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
        MIN_MAX_DELETE_TRANSACTION_MS,
        MAX_MAX_DELETE_TRANSACTION_MS,
      );
      const maxMaintenanceTickMsRaw = clampArchiveSetting(
        settingsDraft.maxMaintenanceTickMs,
        ARCHIVE_MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
        MIN_MAX_MAINTENANCE_TICK_MS,
        MAX_MAX_MAINTENANCE_TICK_MS,
      );
      const maxMaintenanceTickMs = Math.max(maxMaintenanceTickMsRaw, maxDeleteTransactionMs);
      const payload: ArchiveSettingsDraft = {
        autoCleanupEnabled: settingsDraft.autoCleanupEnabled,
        maxDbSizeMb: settingsDraft.maxDbSizeMb && settingsDraft.maxDbSizeMb > 0 ? Math.round(settingsDraft.maxDbSizeMb) : null,
        deleteBatchSize,
        maintenanceIntervalMs,
        maxMaintenanceTickMs,
        maxDeleteTransactionMs,
      };
      const eventPayload: EventArchiveSettings = {
        ...eventSettingsDraft,
        deleteBatchSize: clampArchiveSetting(
          eventSettingsDraft.deleteBatchSize,
          ARCHIVE_MAINTENANCE_PRESETS.safe.deleteBatchSize,
          MIN_DELETE_BATCH_SIZE,
          MAX_DELETE_BATCH_SIZE,
        ),
        maintenanceIntervalMs: clampArchiveSetting(
          eventSettingsDraft.maintenanceIntervalMs,
          ARCHIVE_MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
          MIN_MAINTENANCE_INTERVAL_MS,
          MAX_MAINTENANCE_INTERVAL_MS,
        ),
        maxDeleteTransactionMs: clampArchiveSetting(
          eventSettingsDraft.maxDeleteTransactionMs,
          ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
          MIN_MAX_DELETE_TRANSACTION_MS,
          MAX_MAX_DELETE_TRANSACTION_MS,
        ),
        maxMaintenanceTickMs: Math.max(
          clampArchiveSetting(
            eventSettingsDraft.maxMaintenanceTickMs,
            ARCHIVE_MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
            MIN_MAX_MAINTENANCE_TICK_MS,
            MAX_MAX_MAINTENANCE_TICK_MS,
          ),
          clampArchiveSetting(
            eventSettingsDraft.maxDeleteTransactionMs,
            ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
            MIN_MAX_DELETE_TRANSACTION_MS,
            MAX_MAX_DELETE_TRANSACTION_MS,
          ),
        ),
      };
      const operatorPayload: OperatorActionArchiveSettings = {
        ...operatorSettingsDraft,
        deleteBatchSize: clampArchiveSetting(
          operatorSettingsDraft.deleteBatchSize,
          ARCHIVE_MAINTENANCE_PRESETS.safe.deleteBatchSize,
          MIN_DELETE_BATCH_SIZE,
          MAX_DELETE_BATCH_SIZE,
        ),
        maintenanceIntervalMs: clampArchiveSetting(
          operatorSettingsDraft.maintenanceIntervalMs,
          ARCHIVE_MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
          MIN_MAINTENANCE_INTERVAL_MS,
          MAX_MAINTENANCE_INTERVAL_MS,
        ),
        maxDeleteTransactionMs: clampArchiveSetting(
          operatorSettingsDraft.maxDeleteTransactionMs,
          ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
          MIN_MAX_DELETE_TRANSACTION_MS,
          MAX_MAX_DELETE_TRANSACTION_MS,
        ),
        maxMaintenanceTickMs: Math.max(
          clampArchiveSetting(
            operatorSettingsDraft.maxMaintenanceTickMs,
            ARCHIVE_MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
            MIN_MAX_MAINTENANCE_TICK_MS,
            MAX_MAX_MAINTENANCE_TICK_MS,
          ),
          clampArchiveSetting(
            operatorSettingsDraft.maxDeleteTransactionMs,
            ARCHIVE_MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
            MIN_MAX_DELETE_TRANSACTION_MS,
            MAX_MAX_DELETE_TRANSACTION_MS,
          ),
        ),
      };
      const [saved, savedEventSettings, savedOperatorSettings] = await Promise.all([
        api.updateArchiveSettings(payload),
        api.updateEventArchiveSettings(eventPayload),
        api.updateOperatorActionArchiveSettings(operatorPayload),
      ]);
      setRuntimeSettings(saved);
      setSettingsDraft({
        autoCleanupEnabled: saved.autoCleanupEnabled,
        maxDbSizeMb: saved.maxDbSizeMb,
        deleteBatchSize: saved.deleteBatchSize,
        maintenanceIntervalMs: saved.maintenanceIntervalMs,
        maxMaintenanceTickMs: saved.maxMaintenanceTickMs,
        maxDeleteTransactionMs: saved.maxDeleteTransactionMs,
      });
      setEventSettingsDraft(normalizeMessageArchiveDraft(savedEventSettings));
      setOperatorSettingsDraft(normalizeMessageArchiveDraft(savedOperatorSettings));
      setSettingsModalOpen(false);
      void message.success("Archive settings saved");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to save archive settings");
    } finally {
      setSettingsBusy(false);
    }
  };

  const openPurgePreviewConfirm = async (): Promise<void> => {
    setSettingsBusy(true);
    try {
      const preview = await api.previewArchivePurge();
      const whereText = preview.tables.join(", ");
      const oldest = preview.oldestSampleTime ? new Date(preview.oldestSampleTime).toLocaleString("ru-RU") : "-";
      const newest = preview.newestSampleTime ? new Date(preview.newestSampleTime).toLocaleString("ru-RU") : "-";
      setConfirmState({
        title: "Clear Archive Database",
        submitLabel: "Delete Data",
        submitVariant: "danger",
        message:
          `Scope: ${preview.scope}\n`
          + `Where: ${whereText}\n`
          + `Records to delete: ${preview.samplesCount.toLocaleString("ru-RU")}\n`
          + `Estimated size to delete: ${preview.totalSizeMb.toFixed(2)} MB\n`
          + `Time range: ${oldest} .. ${newest}`,
        onConfirm: async () => {
          const result = await api.runArchivePurge();
          void message.success(
            `Archive data cleared: ${result.clearedSamples.toLocaleString("ru-RU")} records, ${result.clearedTotalSizeMb.toFixed(2)} MB`,
          );
          await load();
        },
      });
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to preview archive purge");
    } finally {
      setSettingsBusy(false);
    }
  };
  const archiveStatusView = useMemo(() => {
    const checkTime = formatStatusCheckTime(lastStatusCheckAt);
    const details = [
      `DB: ${formatDbSizeMb(status.dbSizeMb)} MB`,
      `Limit: ${formatDbSizeMb(status.maxDbSizeMb)} MB`,
      `Start: ${formatDbSizeMb(status.startThresholdMb)} MB`,
      `Stop: ${formatDbSizeMb(status.stopThresholdMb)} MB`,
      `Records: ${formatRecordsCount(status.recordsTotal ?? status.recordsCount)}`,
      `Deleted(batch): ${formatRecordsCount(status.recordsDeletedInLastBatch)}`,
      `Deleted(run): ${formatRecordsCount(status.totalRecordsDeletedThisRun)}`,
      `Last batch: ${typeof status.lastBatchDurationMs === "number" ? `${Math.max(0, Math.round(status.lastBatchDurationMs))} ms` : "-"}`,
      `Next run: ${formatDateTime(status.nextRunAt)}`,
      status.pauseReason ? `Pause: ${status.pauseReason}` : null,
    ].filter(Boolean).join(" | ");
    const maintenanceState = status.status ?? (status.maintenanceRunning ? "pruning" : "scheduled");
    if (loading) {
      return { tone: "loading", text: `Archive status: checking... | last check ${checkTime}`, details };
    }
    if (lastLoadError) {
      return { tone: "error", text: `Archive status: connection error - ${lastLoadError} | last check ${checkTime}`, details };
    }
    if (!status.enabled) {
      return { tone: "warning", text: `Archive status: disabled${status.reason ? ` - ${status.reason}` : ""} | last check ${checkTime}`, details };
    }
    if (maintenanceState === "pruning" || maintenanceState === "compacting" || maintenanceState === "cooling_down") {
      return { tone: "loading", text: `Archive status: ${maintenanceState} | queue ${status.queuedSamples} | last check ${checkTime}`, details };
    }
    if (maintenanceState === "paused") {
      return { tone: "warning", text: `Archive status: paused | queue ${status.queuedSamples} | last check ${checkTime}`, details };
    }
    if (maintenanceState === "error") {
      return { tone: "error", text: `Archive status: error | queue ${status.queuedSamples} | last check ${checkTime}`, details };
    }
    return { tone: "ok", text: `Archive status: ${maintenanceState} | queue ${status.queuedSamples} | last check ${checkTime}`, details };
  }, [
    lastLoadError,
    lastStatusCheckAt,
    loading,
    status.dbSizeMb,
    status.enabled,
    status.lastBatchDurationMs,
    status.maxDbSizeMb,
    status.maintenanceRunning,
    status.nextRunAt,
    status.pauseReason,
    status.queuedSamples,
    status.reason,
    status.recordsCount,
    status.recordsDeletedInLastBatch,
    status.recordsTotal,
    status.startThresholdMb,
    status.status,
    status.stopThresholdMb,
    status.totalRecordsDeletedThisRun,
  ]);

  return (
    <div className="screen-editor-window-content screen-editor-tags-window screen-editor-archive-window route-page-fill">
      <div className="screen-editor-tags-window__toolbar">
        <WorkbenchButton onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing" : "Refresh"}
        </WorkbenchButton>
        <WorkbenchButton
          variant="primary"
          disabled={archiveDisabled}
          onClick={async () => {
            const result = await api.runArchiveMaintenance();
            void message.success(`Deleted samples: ${result.deletedSamples}`);
            await load();
          }}
        >
          Run Maintenance
        </WorkbenchButton>
        <WorkbenchButton variant="primary" onClick={openCreatePolicy} disabled={archiveDisabled}>Add Policy</WorkbenchButton>
        <WorkbenchButton onClick={() => selectedManagePolicy && openEditPolicy(selectedManagePolicy)} disabled={!selectedManagePolicy || archiveDisabled}>Edit Policy</WorkbenchButton>
        <WorkbenchButton variant="danger" onClick={() => selectedManagePolicy && deletePolicy(selectedManagePolicy)} disabled={!selectedManagePolicy || archiveDisabled}>Delete Policy</WorkbenchButton>
        <WorkbenchButton onClick={resetWidths}>Reset Widths</WorkbenchButton>
        <WorkbenchButton onClick={() => setColumnsPanelOpen((open) => !open)}>Columns</WorkbenchButton>
        <WorkbenchButton onClick={openSettings} disabled={archiveDisabled}>Settings</WorkbenchButton>

        <select className="workbench-select screen-editor-tags-window__toolbar-select" value={policyManageId} onChange={(event) => setPolicyManageId(event.target.value)}>
          <option value="0">Policy...</option>
          {policies.map((policy) => (
            <option key={policy.id} value={String(policy.id)}>
              {policy.name}
            </option>
          ))}
        </select>

        <div className="screen-editor-tags-window__toolbar-meta">
          Total: {tagConfigs.length} | Filtered: {filteredTags.length} | Selected: {selectedCount} | Queue: {status.queuedSamples}
        </div>
      </div>

      <div className="screen-editor-tags-window__toolbar screen-editor-archive-window__search-row">
        <input
          className="workbench-input screen-editor-tags-window__toolbar-input"
          placeholder="Search tags"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={policyFilter === "all" ? "all" : String(policyFilter)}
          onChange={(event) => setPolicyFilter(event.target.value === "all" ? "all" : Number.parseInt(event.target.value, 10))}
        >
          <option value="all">All policies</option>
          <option value="0">No policy</option>
          {policies.map((policy) => (
            <option key={policy.id} value={String(policy.id)}>
              {policy.name}
            </option>
          ))}
        </select>
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={driverFilter}
          onChange={(event) => {
            setDriverFilter(event.target.value as "all" | "opcua" | "simulated");
            setPage(1);
          }}
        >
          {driverFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <WorkbenchButton
          onClick={() => {
            setSearch("");
            setPolicyFilter("all");
            setDriverFilter("all");
            setPage(1);
          }}
          disabled={search === "" && policyFilter === "all" && driverFilter === "all"}
        >
          Clear
        </WorkbenchButton>
        <WorkbenchButton onClick={selectCurrentPage} disabled={pageRows.length === 0}>Select Page</WorkbenchButton>
        <WorkbenchButton onClick={selectAllFiltered} disabled={filteredTags.length === 0}>Select Filtered</WorkbenchButton>
        <WorkbenchButton onClick={clearSelected} disabled={selectedCount === 0}>Clear Selected</WorkbenchButton>
      </div>

      <div className="screen-editor-tags-window__toolbar screen-editor-archive-window__group-toolbar">
        <select className="workbench-select screen-editor-tags-window__toolbar-select" value={bulkPolicyId} onChange={(event) => setBulkPolicyId(event.target.value)}>
          {policySelectOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <WorkbenchButton variant="primary" disabled={archiveDisabled || searchMatchedTags.length === 0} onClick={() => void applyPolicyToTags(searchMatchedTags, "found")}>
          Assign Policy To Found
        </WorkbenchButton>
        <WorkbenchButton variant="primary" disabled={archiveDisabled || selectedTags.length === 0} onClick={() => void applyPolicyToTags(selectedTags, "selected")}>
          Assign Policy To Selected
        </WorkbenchButton>
        <WorkbenchButton variant="danger" disabled={archiveDisabled || searchMatchedTags.length === 0} onClick={() => void clearOverridesForTags(searchMatchedTags, "found")}>
          Clear Overrides In Found
        </WorkbenchButton>
        <WorkbenchButton variant="danger" disabled={archiveDisabled || selectedTags.length === 0} onClick={() => void clearOverridesForTags(selectedTags, "selected")}>
          Clear Overrides In Selected
        </WorkbenchButton>
        <div className="screen-editor-tags-window__toolbar-meta">
          Found: {searchMatchedTags.length} | Selected in filtered: {selectedInFilteredCount}
        </div>
      </div>

      {columnsPanelOpen ? (
        <div className="screen-editor-tags-columns-panel">
          {ARCHIVE_COLUMNS.map((column) => (
            <label key={column.id} className="screen-editor-tags-column-toggle">
              <input
                type="checkbox"
                checked={columnVisibility[column.id] !== false}
                disabled={column.id === "name" || column.id === "select"}
                onChange={(event) =>
                  setColumnVisibility((prev) => ({
                    ...prev,
                    [column.id]: event.target.checked,
                    select: true,
                    name: true,
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
            <div className="screen-editor-tags-row screen-editor-tags-row--header" style={{ gridTemplateColumns: archiveGridTemplateColumns }}>
              {visibleColumns.map((column) => (
                <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell">
                  {column.id === "select" ? (
                    <input
                      ref={pageSelectCheckboxRef}
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={() => toggleCurrentPageSelection()}
                      aria-label="Select current page"
                    />
                  ) : (
                    <span>{column.title}</span>
                  )}
                  {column.id !== "select" ? (
                    <span
                      className="screen-editor-tags-column-resize-handle"
                      onMouseDown={(event) => startColumnResize(event, column.id)}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            {pageRows.map((row) => {
              const selected = selectedTag?.tagName === row.tagName;
              const rowCells: Record<ArchiveColumnId, string> = {
                select: selectedTagNames.has(row.tagName) ? "selected" : "",
                name: row.tagName,
                policy: row.policyName ?? "No policy",
                mode: row.mode ?? "-",
                period: row.periodMs === null ? "-" : `${row.periodMs} ms`,
                retention: row.retentionDays === null ? "-" : `${row.retentionDays} d`,
                override: row.override ? "Yes" : "No",
              };
              return (
                <div
                  key={row.tagName}
                  className={["screen-editor-tags-row", selected ? "screen-editor-tags-row--selected" : ""].filter(Boolean).join(" ")}
                  style={{ gridTemplateColumns: archiveGridTemplateColumns }}
                  onClick={() => setSelectedTagName(row.tagName)}
                >
                  {visibleColumns.map((column) => {
                    const value = rowCells[column.id];
                    if (column.id === "select") {
                      return (
                        <div key={column.id} className="screen-editor-tags-cell" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedTagNames.has(row.tagName)}
                            onChange={() => toggleTagSelection(row.tagName)}
                            aria-label={`Select ${row.tagName}`}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={column.id} className="screen-editor-tags-cell" title={value}>
                        {value}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {pageRows.length === 0 ? <div className="screen-editor-empty-state">No tags match the filters</div> : null}
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
            {selectedTag ? (
              <>
                <div className="screen-editor-tag-editor__kv"><span>Name</span><strong>{selectedTag.tagName}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Policy</span><strong>{selectedTag.policyName ?? "No policy"}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Mode</span><strong>{selectedTag.mode ?? "-"}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Period</span><strong>{selectedTag.periodMs === null ? "-" : `${selectedTag.periodMs} ms`}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Deadband</span><strong>{selectedTag.deadband === null ? "-" : selectedTag.deadband}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Retention</span><strong>{selectedTag.retentionDays === null ? "-" : `${selectedTag.retentionDays} d`}</strong></div>
                <div className="screen-editor-tag-editor__kv"><span>Override</span><strong>{selectedTag.override ? "Yes" : "No"}</strong></div>

                <label className="workbench-field" style={{ marginTop: 8 }}>
                  <span className="workbench-field__label">Assign Policy</span>
                  <select className="workbench-select" value={detailsPolicyId} onChange={(event) => setDetailsPolicyId(event.target.value)}>
                    {policySelectOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <div className="screen-editor-tag-editor-actions">
                  <WorkbenchButton variant="primary" disabled={archiveDisabled} onClick={() => void assignPolicyToSelectedTag()}>
                    Save Policy
                  </WorkbenchButton>
                  <WorkbenchButton disabled={archiveDisabled} onClick={() => openOverride(selectedTag)}>
                    {selectedTag.override ? "Edit Override" : "Set Override"}
                  </WorkbenchButton>
                  <WorkbenchButton
                    variant="danger"
                    disabled={archiveDisabled || !selectedTag.override}
                    onClick={() => void clearOverride(selectedTag)}
                  >
                    Clear Override
                  </WorkbenchButton>
                </div>
              </>
            ) : (
              <div className="screen-editor-empty-state">Select a tag</div>
            )}

            {archiveDisabled && status.reason ? <div className="screen-editor-tag-editor__hint">{status.reason}</div> : null}
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
        <div className={`screen-editor-archive-window__status-wrap screen-editor-archive-window__status--${archiveStatusView.tone}`}>
          <span className="screen-editor-archive-window__status">{archiveStatusView.text}</span>
          <span className="screen-editor-archive-window__status-details">{archiveStatusView.details}</span>
        </div>
      </div>

      <ArchiveWorkbenchDialog
        id="archive-confirm-dialog"
        title={confirmState?.title ?? "Confirm"}
        open={Boolean(confirmState)}
        defaultRect={{ x: 0, y: 0, width: 520, height: 240 }}
        zIndex={2100}
        onClose={() => {
          if (!confirmBusy) {
            setConfirmState(null);
          }
        }}
        onSubmit={() => void runConfirmAction()}
        submitLabel={confirmBusy ? "Working..." : (confirmState?.submitLabel ?? "OK")}
        submitVariant={confirmState?.submitVariant ?? "primary"}
        submitDisabled={confirmBusy}
        cancelDisabled={confirmBusy}
      >
        <div className="archive-workbench-confirm-text">{confirmState?.message}</div>
      </ArchiveWorkbenchDialog>

      <ArchiveWorkbenchDialog
        id="archive-settings-dialog"
        title="Archive Settings"
        open={settingsModalOpen}
        defaultRect={{ x: 0, y: 0, width: 700, height: 520 }}
        zIndex={2000}
        onClose={() => {
          if (!settingsBusy) {
            setSettingsModalOpen(false);
          }
        }}
        onSubmit={() => void saveSettings()}
        submitLabel={settingsBusy ? "Saving..." : "Save Settings"}
        submitDisabled={settingsBusy}
        cancelDisabled={settingsBusy}
      >
        <div className="archive-workbench-settings">
          <label className="workbench-field">
            <span className="workbench-field__label">Auto Cleanup Enabled</span>
            <label className="screen-editor-tags-checkbox-field">
              <input
                type="checkbox"
                checked={settingsDraft.autoCleanupEnabled}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, autoCleanupEnabled: event.target.checked }))}
              />
              <span>Automatically apply overflow protection on maintenance cycle</span>
            </label>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Max Database Size (MB)</span>
            <InputNumber
              min={1}
              value={settingsDraft.maxDbSizeMb ?? null}
              onChange={(value) => setSettingsDraft((prev) => ({ ...prev, maxDbSizeMb: value === null ? null : Number(value) }))}
              style={{ width: 220 }}
            />
            <span className="screen-editor-tag-editor__hint">
              Pruning starts only above start threshold and stops below stop threshold (hysteresis is automatic).
            </span>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Maintenance Preset</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <WorkbenchButton
                onClick={() => setSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.safe }))}
                disabled={settingsBusy}
              >
                Safe
              </WorkbenchButton>
              <WorkbenchButton
                onClick={() => setSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.balanced }))}
                disabled={settingsBusy}
              >
                Balanced
              </WorkbenchButton>
              <WorkbenchButton
                onClick={() => setSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.fast }))}
                disabled={settingsBusy}
              >
                Fast
              </WorkbenchButton>
            </div>
            <span className="screen-editor-tag-editor__hint">
              Safe is recommended for live runtime workloads.
            </span>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Delete Batch Size (records)</span>
            <InputNumber
              min={MIN_DELETE_BATCH_SIZE}
              max={MAX_DELETE_BATCH_SIZE}
              value={settingsDraft.deleteBatchSize}
              onChange={(value) => setSettingsDraft((prev) => ({ ...prev, deleteBatchSize: Number(value ?? prev.deleteBatchSize) }))}
              style={{ width: 220 }}
            />
            <span className="screen-editor-tag-editor__hint">
              Smaller batch reduces DB pressure and UI lag, but cleanup takes longer.
            </span>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Maintenance Interval (ms)</span>
            <InputNumber
              min={MIN_MAINTENANCE_INTERVAL_MS}
              max={MAX_MAINTENANCE_INTERVAL_MS}
              value={settingsDraft.maintenanceIntervalMs}
              onChange={(value) => setSettingsDraft((prev) => ({ ...prev, maintenanceIntervalMs: Number(value ?? prev.maintenanceIntervalMs) }))}
              style={{ width: 220 }}
            />
            <span className="screen-editor-tag-editor__hint">
              Larger interval keeps runtime smoother, but cleanup reacts slower.
            </span>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Max Maintenance Tick (ms)</span>
            <InputNumber
              min={MIN_MAX_MAINTENANCE_TICK_MS}
              max={MAX_MAX_MAINTENANCE_TICK_MS}
              value={settingsDraft.maxMaintenanceTickMs}
              onChange={(value) => setSettingsDraft((prev) => ({ ...prev, maxMaintenanceTickMs: Number(value ?? prev.maxMaintenanceTickMs) }))}
              style={{ width: 220 }}
            />
            <span className="screen-editor-tag-editor__hint">
              Tick budget caps total background archive work per cycle. It must be greater than or equal to transaction timeout.
            </span>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Max Delete Transaction (ms)</span>
            <InputNumber
              min={MIN_MAX_DELETE_TRANSACTION_MS}
              max={MAX_MAX_DELETE_TRANSACTION_MS}
              value={settingsDraft.maxDeleteTransactionMs}
              onChange={(value) => setSettingsDraft((prev) => ({ ...prev, maxDeleteTransactionMs: Number(value ?? prev.maxDeleteTransactionMs) }))}
              style={{ width: 220 }}
            />
            <span className="screen-editor-tag-editor__hint">
              Transaction timeout protects runtime by aborting long blocking delete batches.
            </span>
          </label>

          <div className="screen-editor-tag-editor">
            <div className="screen-editor-tag-editor__title">Maintenance Status</div>
            <div className="screen-editor-tag-editor__kv"><span>Status</span><strong>{status.status ?? (status.maintenanceRunning ? "pruning" : "scheduled")}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>DB Size</span><strong>{formatDbSizeMb(status.dbSizeMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Max DB</span><strong>{formatDbSizeMb(status.maxDbSizeMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Start threshold</span><strong>{formatDbSizeMb(status.startThresholdMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Stop threshold</span><strong>{formatDbSizeMb(status.stopThresholdMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Records</span><strong>{formatRecordsCount(status.recordsTotal ?? status.recordsCount)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Deleted last batch</span><strong>{formatRecordsCount(status.recordsDeletedInLastBatch)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Deleted in run</span><strong>{formatRecordsCount(status.totalRecordsDeletedThisRun)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Last batch duration</span><strong>{typeof status.lastBatchDurationMs === "number" ? `${Math.max(0, Math.round(status.lastBatchDurationMs))} ms` : "-"}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Next run</span><strong>{formatDateTime(status.nextRunAt)}</strong></div>
            {status.pauseReason ? <div className="screen-editor-tag-editor__hint">Pause reason: {status.pauseReason}</div> : null}
          </div>

          <div className="screen-editor-tag-editor">
            <div className="screen-editor-tag-editor__title">Event Archive Maintenance</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <WorkbenchButton onClick={() => setEventSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.safe }))} disabled={settingsBusy}>
                Safe
              </WorkbenchButton>
              <WorkbenchButton onClick={() => setEventSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.balanced }))} disabled={settingsBusy}>
                Balanced
              </WorkbenchButton>
              <WorkbenchButton onClick={() => setEventSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.fast }))} disabled={settingsBusy}>
                Fast
              </WorkbenchButton>
            </div>
            <label className="workbench-field">
              <span className="workbench-field__label">Delete Batch Size</span>
              <InputNumber min={MIN_DELETE_BATCH_SIZE} max={MAX_DELETE_BATCH_SIZE} value={eventSettingsDraft.deleteBatchSize} onChange={(value) => setEventSettingsDraft((prev) => ({ ...prev, deleteBatchSize: Number(value ?? prev.deleteBatchSize) }))} style={{ width: 220 }} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Maintenance Interval (ms)</span>
              <InputNumber min={MIN_MAINTENANCE_INTERVAL_MS} max={MAX_MAINTENANCE_INTERVAL_MS} value={eventSettingsDraft.maintenanceIntervalMs} onChange={(value) => setEventSettingsDraft((prev) => ({ ...prev, maintenanceIntervalMs: Number(value ?? prev.maintenanceIntervalMs) }))} style={{ width: 220 }} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Max Maintenance Tick (ms)</span>
              <InputNumber min={MIN_MAX_MAINTENANCE_TICK_MS} max={MAX_MAX_MAINTENANCE_TICK_MS} value={eventSettingsDraft.maxMaintenanceTickMs} onChange={(value) => setEventSettingsDraft((prev) => ({ ...prev, maxMaintenanceTickMs: Number(value ?? prev.maxMaintenanceTickMs) }))} style={{ width: 220 }} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Max Delete Transaction (ms)</span>
              <InputNumber min={MIN_MAX_DELETE_TRANSACTION_MS} max={MAX_MAX_DELETE_TRANSACTION_MS} value={eventSettingsDraft.maxDeleteTransactionMs} onChange={(value) => setEventSettingsDraft((prev) => ({ ...prev, maxDeleteTransactionMs: Number(value ?? prev.maxDeleteTransactionMs) }))} style={{ width: 220 }} />
            </label>
            <div className="screen-editor-tag-editor__kv"><span>Status</span><strong>{eventArchiveStatus?.status ?? "-"}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>DB Size</span><strong>{formatDbSizeMb(eventArchiveStatus?.dbSizeMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Records</span><strong>{formatRecordsCount(eventArchiveStatus?.recordsCount)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Oldest</span><strong>{formatDateTime(eventArchiveStatus?.oldestRecordAt)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Newest</span><strong>{formatDateTime(eventArchiveStatus?.newestRecordAt)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Max DB</span><strong>{formatDbSizeMb(eventArchiveStatus?.maxDatabaseSizeMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Start threshold</span><strong>{formatDbSizeMb(eventArchiveStatus?.startThresholdMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Stop threshold</span><strong>{formatDbSizeMb(eventArchiveStatus?.stopThresholdMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Deleted last batch</span><strong>{formatRecordsCount(eventArchiveStatus?.recordsDeletedInLastBatch)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Deleted in run</span><strong>{formatRecordsCount(eventArchiveStatus?.totalRecordsDeletedThisRun)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Last batch duration</span><strong>{typeof eventArchiveStatus?.lastBatchDurationMs === "number" ? `${Math.max(0, Math.round(eventArchiveStatus.lastBatchDurationMs))} ms` : "-"}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Next run</span><strong>{formatDateTime(eventArchiveStatus?.nextRunAt)}</strong></div>
            {eventArchiveStatus?.statusDetail ? <div className="screen-editor-tag-editor__hint">Maintenance detail: {eventArchiveStatus.statusDetail}</div> : null}
            {eventArchiveStatus?.pauseReason ? <div className="screen-editor-tag-editor__hint">Pause reason: {eventArchiveStatus.pauseReason}</div> : null}
            <div className="screen-editor-tag-editor__hint">Manual optimize runs safe ANALYZE only (no VACUUM FULL in runtime maintenance).</div>
          </div>

          <div className="screen-editor-tag-editor">
            <div className="screen-editor-tag-editor__title">Operator Action Archive Maintenance</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <WorkbenchButton onClick={() => setOperatorSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.safe }))} disabled={settingsBusy}>
                Safe
              </WorkbenchButton>
              <WorkbenchButton onClick={() => setOperatorSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.balanced }))} disabled={settingsBusy}>
                Balanced
              </WorkbenchButton>
              <WorkbenchButton onClick={() => setOperatorSettingsDraft((prev) => ({ ...prev, ...ARCHIVE_MAINTENANCE_PRESETS.fast }))} disabled={settingsBusy}>
                Fast
              </WorkbenchButton>
            </div>
            <label className="workbench-field">
              <span className="workbench-field__label">Delete Batch Size</span>
              <InputNumber min={MIN_DELETE_BATCH_SIZE} max={MAX_DELETE_BATCH_SIZE} value={operatorSettingsDraft.deleteBatchSize} onChange={(value) => setOperatorSettingsDraft((prev) => ({ ...prev, deleteBatchSize: Number(value ?? prev.deleteBatchSize) }))} style={{ width: 220 }} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Maintenance Interval (ms)</span>
              <InputNumber min={MIN_MAINTENANCE_INTERVAL_MS} max={MAX_MAINTENANCE_INTERVAL_MS} value={operatorSettingsDraft.maintenanceIntervalMs} onChange={(value) => setOperatorSettingsDraft((prev) => ({ ...prev, maintenanceIntervalMs: Number(value ?? prev.maintenanceIntervalMs) }))} style={{ width: 220 }} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Max Maintenance Tick (ms)</span>
              <InputNumber min={MIN_MAX_MAINTENANCE_TICK_MS} max={MAX_MAX_MAINTENANCE_TICK_MS} value={operatorSettingsDraft.maxMaintenanceTickMs} onChange={(value) => setOperatorSettingsDraft((prev) => ({ ...prev, maxMaintenanceTickMs: Number(value ?? prev.maxMaintenanceTickMs) }))} style={{ width: 220 }} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Max Delete Transaction (ms)</span>
              <InputNumber min={MIN_MAX_DELETE_TRANSACTION_MS} max={MAX_MAX_DELETE_TRANSACTION_MS} value={operatorSettingsDraft.maxDeleteTransactionMs} onChange={(value) => setOperatorSettingsDraft((prev) => ({ ...prev, maxDeleteTransactionMs: Number(value ?? prev.maxDeleteTransactionMs) }))} style={{ width: 220 }} />
            </label>
            <div className="screen-editor-tag-editor__kv"><span>Status</span><strong>{operatorArchiveStatus?.status ?? "-"}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>DB Size</span><strong>{formatDbSizeMb(operatorArchiveStatus?.dbSizeMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Records</span><strong>{formatRecordsCount(operatorArchiveStatus?.recordsCount)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Oldest</span><strong>{formatDateTime(operatorArchiveStatus?.oldestRecordAt)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Newest</span><strong>{formatDateTime(operatorArchiveStatus?.newestRecordAt)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Max DB</span><strong>{formatDbSizeMb(operatorArchiveStatus?.maxDatabaseSizeMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Start threshold</span><strong>{formatDbSizeMb(operatorArchiveStatus?.startThresholdMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Stop threshold</span><strong>{formatDbSizeMb(operatorArchiveStatus?.stopThresholdMb)} MB</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Deleted last batch</span><strong>{formatRecordsCount(operatorArchiveStatus?.recordsDeletedInLastBatch)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Deleted in run</span><strong>{formatRecordsCount(operatorArchiveStatus?.totalRecordsDeletedThisRun)}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Last batch duration</span><strong>{typeof operatorArchiveStatus?.lastBatchDurationMs === "number" ? `${Math.max(0, Math.round(operatorArchiveStatus.lastBatchDurationMs))} ms` : "-"}</strong></div>
            <div className="screen-editor-tag-editor__kv"><span>Next run</span><strong>{formatDateTime(operatorArchiveStatus?.nextRunAt)}</strong></div>
            {operatorArchiveStatus?.statusDetail ? <div className="screen-editor-tag-editor__hint">Maintenance detail: {operatorArchiveStatus.statusDetail}</div> : null}
            {operatorArchiveStatus?.pauseReason ? <div className="screen-editor-tag-editor__hint">Pause reason: {operatorArchiveStatus.pauseReason}</div> : null}
          </div>

          <div className="archive-workbench-settings__danger-zone">
            <div className="screen-editor-tag-editor__title">Danger Zone</div>
            <span className="screen-editor-tag-editor__hint">
              Clear all archive data tables (samples, aggregates, events, alarms).
            </span>
            <WorkbenchButton variant="danger" onClick={() => void openPurgePreviewConfirm()} disabled={settingsBusy}>
              Clear Archive Database...
            </WorkbenchButton>
          </div>
        </div>
      </ArchiveWorkbenchDialog>

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
              <InputNumber min={0} step={0.01} precision={2} style={{ width: 130 }} />
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
              <InputNumber min={0} step={0.01} precision={2} style={{ width: 130 }} />
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
