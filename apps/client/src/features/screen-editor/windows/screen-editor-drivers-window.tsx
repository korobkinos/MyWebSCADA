import { useEffect, useMemo, useRef, useState } from "react";
import type { DriverStatus, OpcUaDriverConfig, ScadaProject, SimulatedDriverConfig } from "@web-scada/shared";
import { InputNumber, message, Modal } from "antd";
import { api, type DriverMacroImpact, type OpcUaDriverImpactResponse } from "../../../services/api";
import { useScadaStore } from "../../../store/scada-store";
import {
  WorkbenchButton,
  WorkbenchCollapsibleSection,
  WorkbenchSection,
  WorkbenchTabs,
  type WorkbenchTabItem,
} from "../../../components/workbench";

type ScreenEditorDriversWindowProps = {
  drivers?: DriverStatus[];
};

type DriversTab = "opcua" | "simulation";

const OPC_SECURITY_POLICIES: Array<NonNullable<OpcUaDriverConfig["securityPolicy"]>> = ["None", "Basic256Sha256"];
const OPC_SECURITY_MODES: Array<NonNullable<OpcUaDriverConfig["securityMode"]>> = ["None", "Sign", "SignAndEncrypt"];
const OPC_READ_MODES: Array<NonNullable<OpcUaDriverConfig["readMode"]>> = ["polling", "subscription"];
const OPC_CLOCK_WARNING_HELP_TEXT =
  "OPC UA clock mismatch detected. Synchronize PLC/OPC UA server clock and SCADA server clock. Connection will continue.";

function createDriverId(prefix: "opcua" | "sim"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultOpcUaDriver(): OpcUaDriverConfig {
  return {
    id: createDriverId("opcua"),
    type: "opcua",
    enabled: true,
    name: "OPC UA Driver",
    endpointUrl: "opc.tcp://127.0.0.1:4840",
    securityPolicy: "None",
    securityMode: "None",
    readMode: "subscription",
    publishingIntervalMs: 250,
    samplingIntervalMs: 250,
    queueSize: 1,
    discardOldest: true,
    subscriptionBatchSize: 100,
    connectTimeoutMs: 5000,
    operationTimeoutMs: 5000,
    sessionTimeoutMs: 60000,
    keepAliveIntervalMs: 5000,
    timeoutMs: 5000,
    reconnectMs: 5000,
    username: "",
    password: "",
  };
}

function withOpcUaTimingDefaults(config: OpcUaDriverConfig): OpcUaDriverConfig {
  const legacyTimeout = config.timeoutMs ?? 5000;
  return {
    ...config,
    readMode: config.readMode ?? "subscription",
    publishingIntervalMs: config.publishingIntervalMs ?? 250,
    samplingIntervalMs: config.samplingIntervalMs ?? 250,
    queueSize: config.queueSize ?? 1,
    discardOldest: config.discardOldest ?? true,
    subscriptionBatchSize: config.subscriptionBatchSize ?? 100,
    connectTimeoutMs: config.connectTimeoutMs ?? legacyTimeout,
    operationTimeoutMs: config.operationTimeoutMs ?? legacyTimeout,
    sessionTimeoutMs: config.sessionTimeoutMs ?? 60000,
    keepAliveIntervalMs: config.keepAliveIntervalMs ?? 5000,
    reconnectMs: config.reconnectMs ?? 5000,
  };
}

function defaultSimulationDriver(): SimulatedDriverConfig {
  return {
    id: createDriverId("sim"),
    type: "simulated",
    enabled: true,
    name: "Simulation Driver",
    updateIntervalMs: 1000,
    schedulerTickMs: 100,
    defaultVariationMode: "perTagSeed",
  };
}

function isOpcUaClockWarning(messageText: string | undefined): boolean {
  if (!messageText) {
    return false;
  }
  const normalized = messageText.toLowerCase();
  return (
    normalized.includes("node-opcua-w33")
    || normalized.includes("clock discrepancy")
    || normalized.includes("time discrepancy")
    || normalized.includes("server token creation date exposes time discrepancy")
  );
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toInputNumberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toOptionalInputNumber(value: number | string | null): number | undefined {
  if (value == null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

function isDriverStatusLike(value: unknown): value is DriverStatus {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DriverStatus>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.type === "string"
    && typeof candidate.health === "string"
    && typeof candidate.updatedAt === "number"
  );
}

function readDriverStatusFromError(error: unknown): DriverStatus | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return null;
  }
  const status = (details as { status?: unknown }).status;
  return isDriverStatusLike(status) ? status : null;
}

function upsertProjectDriver(
  project: ScadaProject,
  driver: OpcUaDriverConfig | SimulatedDriverConfig,
  previousId?: string,
): ScadaProject {
  const targetId = previousId?.trim() || driver.id;
  const index = project.drivers.findIndex((item) => item.id === targetId);
  if (index < 0) {
    return {
      ...project,
      drivers: [...project.drivers, driver],
    };
  }

  const nextDrivers = [...project.drivers];
  nextDrivers[index] = driver;
  return {
    ...project,
    drivers: nextDrivers,
  };
}

function formatStatusBadge(status: DriverStatus | null): { label: string; className: string } {
  if (!status) {
    return { label: "Unknown", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--disconnected" };
  }
  const health = status.health;
  if (health === "running") {
    return { label: "Connected", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--connected" };
  }
  if (health === "starting") {
    return { label: "Connecting", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--connecting" };
  }
  if (health === "reconnecting") {
    return { label: "Reconnecting", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--reconnecting" };
  }
  if (health === "error") {
    return { label: "Error", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--error" };
  }
  return { label: "Disconnected", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--disconnected" };
}

function renderAffectedMacroPreview(affected: DriverMacroImpact[]): string {
  if (affected.length === 0) {
    return "None";
  }
  return affected
    .slice(0, 10)
    .map((item) => `${item.macroName} [${item.referencedTags.join(", ")}]`)
    .join("\n");
}

function formatTimestamp(value: number | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function ScreenEditorDriversWindow({ drivers = [] }: ScreenEditorDriversWindowProps) {
  const project = useScadaStore((s) => s.project);
  const runtimeDrivers = useScadaStore((s) => s.drivers);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadTags = useScadaStore((s) => s.loadTags);
  const loadMacros = useScadaStore((s) => s.loadMacros);

  const [activeTab, setActiveTab] = useState<DriversTab>("opcua");
  const [selectedOpcUaDriverId, setSelectedOpcUaDriverId] = useState("");
  const [opcUaDraft, setOpcUaDraft] = useState<OpcUaDriverConfig | null>(null);
  const [selectedSimulationDriverId, setSelectedSimulationDriverId] = useState("");
  const [simulationDraft, setSimulationDraft] = useState<SimulatedDriverConfig | null>(null);
  const [statusOverride, setStatusOverride] = useState<DriverStatus | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "save" | "test" | "connect" | "disconnect" | "refresh" | "delete-tags" | "delete-driver">("");
  const [driverIdError, setDriverIdError] = useState("");
  const [impactPreview, setImpactPreview] = useState<OpcUaDriverImpactResponse | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [deleteTagsModalOpen, setDeleteTagsModalOpen] = useState(false);
  const [deleteDriverModalOpen, setDeleteDriverModalOpen] = useState(false);
  const [deleteDriverWithTags, setDeleteDriverWithTags] = useState(false);
  const [statusStale, setStatusStale] = useState(false);
  const [statusRefreshError, setStatusRefreshError] = useState("");
  const pollErrorShownRef = useRef(false);

  const driverStatuses = drivers.length > 0 ? drivers : runtimeDrivers;
  const statusById = useMemo(() => new Map(driverStatuses.map((item) => [item.id, item])), [driverStatuses]);

  const opcUaDrivers = useMemo(
    () => (project?.drivers ?? []).filter((item): item is OpcUaDriverConfig => item.type === "opcua"),
    [project?.drivers],
  );

  const simulationDrivers = useMemo(
    () => (project?.drivers ?? []).filter((item): item is SimulatedDriverConfig => item.type === "simulated"),
    [project?.drivers],
  );

  const selectedOpcUaDriver = useMemo(
    () => opcUaDrivers.find((item) => item.id === selectedOpcUaDriverId) ?? opcUaDrivers[0] ?? null,
    [opcUaDrivers, selectedOpcUaDriverId],
  );

  const selectedSimulationDriver = useMemo(
    () => simulationDrivers.find((item) => item.id === selectedSimulationDriverId) ?? simulationDrivers[0] ?? null,
    [selectedSimulationDriverId, simulationDrivers],
  );

  const linkedTagCountByDriverId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tag of project?.tags ?? []) {
      if (tag.sourceType !== "opcua" || !tag.driverId) {
        continue;
      }
      counts.set(tag.driverId, (counts.get(tag.driverId) ?? 0) + 1);
    }
    return counts;
  }, [project?.tags]);

  const duplicateOpcUaDriverIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const driver of opcUaDrivers) {
      const id = driver.id.trim();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
  }, [opcUaDrivers]);

  const simulatedTagsCount = useMemo(
    () => (project?.tags ?? []).filter((tag) => tag.sourceType === "simulated").length,
    [project?.tags],
  );
  const simulationStatus = useMemo(
    () => (selectedSimulationDriver ? statusById.get(selectedSimulationDriver.id) ?? null : null),
    [selectedSimulationDriver, statusById],
  );

  const currentOpcStatus = useMemo(() => {
    if (!selectedOpcUaDriver) {
      return null;
    }
    if (statusOverride && statusOverride.id === selectedOpcUaDriver.id) {
      return statusOverride;
    }
    return statusById.get(selectedOpcUaDriver.id) ?? null;
  }, [selectedOpcUaDriver, statusById, statusOverride]);

  useEffect(() => {
    if (!selectedOpcUaDriver) {
      setSelectedOpcUaDriverId("");
      setOpcUaDraft(null);
      return;
    }
    if (selectedOpcUaDriverId !== selectedOpcUaDriver.id) {
      setSelectedOpcUaDriverId(selectedOpcUaDriver.id);
    }
    setOpcUaDraft(withOpcUaTimingDefaults({ ...selectedOpcUaDriver }));
    setDriverIdError("");
  }, [selectedOpcUaDriver, selectedOpcUaDriverId]);

  useEffect(() => {
    pollErrorShownRef.current = false;
    setStatusStale(false);
    setStatusRefreshError("");
  }, [selectedOpcUaDriver?.id]);

  useEffect(() => {
    if (!selectedSimulationDriver) {
      setSelectedSimulationDriverId("");
      setSimulationDraft(null);
      return;
    }
    if (selectedSimulationDriverId !== selectedSimulationDriver.id) {
      setSelectedSimulationDriverId(selectedSimulationDriver.id);
    }
    setSimulationDraft({ ...selectedSimulationDriver });
  }, [selectedSimulationDriver, selectedSimulationDriverId]);

  useEffect(() => {
    if (activeTab !== "opcua" || !selectedOpcUaDriver?.id) {
      return;
    }
    let disposed = false;
    let inFlightController: AbortController | null = null;
    let pollingInFlight = false;
    const runPoll = (): void => {
      if (busyAction === "connect" || busyAction === "disconnect") {
        return;
      }
      if (pollingInFlight) {
        return;
      }
      const controller = new AbortController();
      inFlightController = controller;
      pollingInFlight = true;
      void api.getOpcUaStatus(selectedOpcUaDriver.id, { signal: controller.signal })
        .then((response) => {
          if (disposed || controller.signal.aborted) {
            return;
          }
          if (response.status) {
            setStatusOverride(response.status);
          }
          setStatusStale(false);
          setStatusRefreshError("");
          pollErrorShownRef.current = false;
        })
        .catch((error) => {
          if (disposed || controller.signal.aborted) {
            return;
          }
          const text = error instanceof Error ? error.message : "Failed to refresh OPC UA status";
          setStatusStale(true);
          setStatusRefreshError(text);
          if (!pollErrorShownRef.current) {
            pollErrorShownRef.current = true;
            void message.warning(`Status refresh failed: ${text}`);
          }
        })
        .finally(() => {
          if (inFlightController === controller) {
            inFlightController = null;
          }
          pollingInFlight = false;
        });
    };

    runPoll();
    const timer = setInterval(runPoll, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      inFlightController?.abort();
    };
  }, [activeTab, selectedOpcUaDriver?.id, busyAction]);

  const refreshStatus = async (driverId?: string, setBusy = true): Promise<void> => {
    if (setBusy) {
      setBusyAction("refresh");
    }
    try {
      await loadDrivers();
      if (driverId) {
        const statusResponse = await api.getOpcUaStatus(driverId);
        if (statusResponse.status) {
          setStatusOverride(statusResponse.status);
        }
      }
      setStatusStale(false);
      setStatusRefreshError("");
      pollErrorShownRef.current = false;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to refresh driver status";
      setStatusStale(true);
      setStatusRefreshError(text);
      void message.error(text);
    } finally {
      if (setBusy) {
        setBusyAction("");
      }
    }
  };

  const saveOpcUaConfig = async (): Promise<void> => {
    if (!project || !opcUaDraft || !selectedOpcUaDriver) {
      return;
    }
    setBusyAction("save");
    setDriverIdError("");
    try {
      const normalizedId = opcUaDraft.id.trim();
      if (!normalizedId) {
        setDriverIdError("Driver id is required");
        return;
      }
      const isDuplicateId = opcUaDrivers.some((driver) => driver.id === normalizedId && driver.id !== selectedOpcUaDriver.id);
      if (isDuplicateId) {
        setDriverIdError(`Driver id "${normalizedId}" already exists`);
        return;
      }
      const normalized: OpcUaDriverConfig = {
        ...withOpcUaTimingDefaults(opcUaDraft),
        id: normalizedId,
        type: "opcua",
        enabled: Boolean(opcUaDraft.enabled),
        endpointUrl: opcUaDraft.endpointUrl.trim(),
        name: normalizeOptionalText(opcUaDraft.name),
        username: normalizeOptionalText(opcUaDraft.username),
        password: normalizeOptionalText(opcUaDraft.password),
      };
      if (!normalized.endpointUrl) {
        void message.warning("Endpoint URL is required");
        return;
      }

      let nextProject = upsertProjectDriver(project, normalized, selectedOpcUaDriver.id);
      if (selectedOpcUaDriver.id !== normalized.id) {
        nextProject = {
          ...nextProject,
          tags: nextProject.tags.map((tag) => (
            tag.sourceType === "opcua" && tag.driverId === selectedOpcUaDriver.id
              ? { ...tag, driverId: normalized.id }
              : tag
          )),
        };
      }
      updateProjectJson(nextProject);
      await saveProject();
      await Promise.all([loadProject(), loadDrivers(), loadTags(), loadMacros()]);
      await refreshStatus(normalized.id, false);
      setSelectedOpcUaDriverId(normalized.id);
      void message.success("OPC UA driver saved");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to save OPC UA config");
    } finally {
      setBusyAction("");
    }
  };

  const connectOpcUa = async (): Promise<void> => {
    if (!selectedOpcUaDriver) {
      return;
    }
    setBusyAction("connect");
    setStatusOverride({
      id: selectedOpcUaDriver.id,
      type: "opcua",
      health: "starting",
      message: "Connecting OPC UA",
      updatedAt: Date.now(),
      endpointUrl: selectedOpcUaDriver.endpointUrl,
    });
    try {
      const payload = opcUaDraft && opcUaDraft.id === selectedOpcUaDriver.id ? { config: opcUaDraft } : { driverId: selectedOpcUaDriver.id };
      const response = await api.opcUaConnect(payload);
      if (response.status) {
        setStatusOverride(response.status);
      }
      await refreshStatus(selectedOpcUaDriver.id, false);
      void message.success("OPC UA connected");
    } catch (error) {
      const statusFromError = readDriverStatusFromError(error);
      if (statusFromError) {
        setStatusOverride(statusFromError);
      }
      await refreshStatus(selectedOpcUaDriver.id, false);
      void message.error(error instanceof Error ? error.message : "OPC UA connect failed");
    } finally {
      setBusyAction("");
    }
  };

  const disconnectOpcUa = async (): Promise<void> => {
    if (!selectedOpcUaDriver) {
      return;
    }
    setBusyAction("disconnect");
    setStatusOverride({
      id: selectedOpcUaDriver.id,
      type: "opcua",
      health: "stopped",
      message: "Disconnected by user",
      updatedAt: Date.now(),
      endpointUrl: selectedOpcUaDriver.endpointUrl,
      lastDisconnectedAt: Date.now(),
    });
    try {
      const response = await api.opcUaDisconnect(selectedOpcUaDriver.id);
      if (response.status) {
        setStatusOverride(response.status);
      }
      setOpcUaDraft((prev) => (prev ? { ...prev, enabled: false } : prev));
      await loadProject();
      await refreshStatus(selectedOpcUaDriver.id, false);
      void message.success("OPC UA disconnected");
    } catch (error) {
      await refreshStatus(selectedOpcUaDriver.id, false);
      void message.error(error instanceof Error ? error.message : "OPC UA disconnect failed");
    } finally {
      setBusyAction("");
    }
  };

  const testOpcUa = async (): Promise<void> => {
    if (!opcUaDraft) {
      return;
    }
    setBusyAction("test");
    try {
      await api.opcUaTest({
        ...opcUaDraft,
        endpointUrl: opcUaDraft.endpointUrl.trim(),
        username: normalizeOptionalText(opcUaDraft.username),
        password: normalizeOptionalText(opcUaDraft.password),
      });
      void message.success("OPC UA test successful");
    } catch (error) {
      const text = error instanceof Error ? error.message : "OPC UA test failed";
      if (isOpcUaClockWarning(text)) {
        void message.warning("OPC UA server/client clocks differ. Check PLC/server/VM time and timezone.");
      } else {
        void message.error(text);
      }
    } finally {
      setBusyAction("");
    }
  };

  const saveSimulationConfig = async (): Promise<void> => {
    if (!project || !simulationDraft) {
      return;
    }
    setBusyAction("save");
    try {
      const normalized: SimulatedDriverConfig = {
        ...simulationDraft,
        type: "simulated",
        enabled: Boolean(simulationDraft.enabled),
        name: normalizeOptionalText(simulationDraft.name),
        updateIntervalMs: typeof simulationDraft.updateIntervalMs === "number" ? Math.max(100, Math.round(simulationDraft.updateIntervalMs)) : undefined,
        schedulerTickMs: typeof simulationDraft.schedulerTickMs === "number" ? Math.max(50, Math.round(simulationDraft.schedulerTickMs)) : undefined,
        globalSeed: typeof simulationDraft.globalSeed === "number" ? Math.round(simulationDraft.globalSeed) : undefined,
      };
      updateProjectJson(upsertProjectDriver(project, normalized));
      await saveProject();
      await loadDrivers();
      void message.success("Simulation driver saved");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to save simulation config");
    } finally {
      setBusyAction("");
    }
  };

  const addOpcUaDriver = async (): Promise<void> => {
    if (!project) {
      return;
    }
    const existingIds = new Set(project.drivers.map((driver) => driver.id));
    const driver = defaultOpcUaDriver();
    while (existingIds.has(driver.id)) {
      driver.id = createDriverId("opcua");
    }
    updateProjectJson(upsertProjectDriver(project, driver));
    setSelectedOpcUaDriverId(driver.id);
    setOpcUaDraft(driver);
    try {
      await saveProject();
      await Promise.all([loadProject(), loadDrivers()]);
      void message.success("OPC UA driver created");
    } catch {
      // ignore
    }
  };

  const duplicateOpcUaDriver = async (): Promise<void> => {
    if (!project || !selectedOpcUaDriver) {
      return;
    }
    const existingIds = new Set(project.drivers.map((driver) => driver.id));
    let nextId = `${selectedOpcUaDriver.id}_copy`;
    while (!nextId.trim() || existingIds.has(nextId)) {
      nextId = createDriverId("opcua");
    }
    const duplicate: OpcUaDriverConfig = {
      ...selectedOpcUaDriver,
      id: nextId,
      name: `${selectedOpcUaDriver.name ?? selectedOpcUaDriver.id} Copy`,
      enabled: false,
    };
    updateProjectJson(upsertProjectDriver(project, duplicate));
    setSelectedOpcUaDriverId(duplicate.id);
    setOpcUaDraft(duplicate);
    try {
      await saveProject();
      await Promise.all([loadProject(), loadDrivers()]);
      void message.success("OPC UA driver duplicated");
    } catch {
      // ignore
    }
  };

  const addSimulationDriver = async (): Promise<void> => {
    if (!project) {
      return;
    }
    const driver = defaultSimulationDriver();
    updateProjectJson(upsertProjectDriver(project, driver));
    setSelectedSimulationDriverId(driver.id);
    setSimulationDraft(driver);
    try {
      await saveProject();
      void message.success("Simulation driver created");
    } catch {
      // ignore
    }
  };

  const loadImpactPreview = async (driverId: string): Promise<OpcUaDriverImpactResponse | null> => {
    setImpactLoading(true);
    try {
      const impact = await api.getOpcUaDriverImpact(driverId);
      setImpactPreview(impact);
      return impact;
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to get impact preview");
      return null;
    } finally {
      setImpactLoading(false);
    }
  };

  const openDeleteTagsConfirm = async (): Promise<void> => {
    if (!selectedOpcUaDriver) {
      return;
    }
    const impact = await loadImpactPreview(selectedOpcUaDriver.id);
    if (!impact) {
      return;
    }
    setDeleteTagsModalOpen(true);
  };

  const confirmDeleteTags = async (): Promise<void> => {
    if (!selectedOpcUaDriver) {
      return;
    }
    setBusyAction("delete-tags");
    try {
      const response = await api.deleteOpcUaTagsByDriver(selectedOpcUaDriver.id);
      setDeleteTagsModalOpen(false);
      await Promise.all([loadProject(), loadTags(), loadDrivers(), loadMacros()]);
      void message.success(`Deleted ${response.deletedTags} OPC UA tags`);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to delete OPC UA tags");
    } finally {
      setBusyAction("");
    }
  };

  const openDeleteDriverConfirm = async (): Promise<void> => {
    if (!selectedOpcUaDriver) {
      return;
    }
    const impact = await loadImpactPreview(selectedOpcUaDriver.id);
    if (!impact) {
      return;
    }
    setDeleteDriverWithTags(false);
    setDeleteDriverModalOpen(true);
  };

  const confirmDeleteDriver = async (): Promise<void> => {
    if (!selectedOpcUaDriver) {
      return;
    }
    if (!deleteDriverWithTags && (impactPreview?.tagCount ?? 0) > 0) {
      void message.warning("This driver has linked tags. Enable 'Also delete linked tags' or delete tags first.");
      return;
    }
    setBusyAction("delete-driver");
    try {
      await api.deleteOpcUaDriver(selectedOpcUaDriver.id, { deleteTags: deleteDriverWithTags });
      setDeleteDriverModalOpen(false);
      await Promise.all([loadProject(), loadTags(), loadDrivers(), loadMacros()]);
      const remaining = (project?.drivers ?? []).filter((driver) => driver.type === "opcua" && driver.id !== selectedOpcUaDriver.id);
      setSelectedOpcUaDriverId(remaining[0]?.id ?? "");
      void message.success("OPC UA driver deleted");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to delete OPC UA driver");
    } finally {
      setBusyAction("");
    }
  };

  if (!project) {
    return <div className="screen-editor-window-content">Project is not loaded</div>;
  }

  const tabItems: WorkbenchTabItem[] = [
    { id: "opcua", title: "OPC UA", active: activeTab === "opcua", onClick: () => setActiveTab("opcua") },
    { id: "simulation", title: "Simulation", active: activeTab === "simulation", onClick: () => setActiveTab("simulation") },
  ];

  const statusBadge = formatStatusBadge(currentOpcStatus);
  const selectedLinkedTags = selectedOpcUaDriver ? (linkedTagCountByDriverId.get(selectedOpcUaDriver.id) ?? 0) : 0;
  const hasClockWarning = Boolean(currentOpcStatus?.clockWarning) || isOpcUaClockWarning(currentOpcStatus?.message);
  const clockWarningText = hasClockWarning
    ? (currentOpcStatus?.clockWarning ?? currentOpcStatus?.message ?? OPC_CLOCK_WARNING_HELP_TEXT)
    : undefined;
  return (
    <div className="screen-editor-window-content screen-editor-drivers-window">
      <WorkbenchTabs items={tabItems} className="screen-editor-drivers-tabs" />

      {activeTab === "opcua" ? (
        <div className="screen-editor-drivers-body">
          <aside className="screen-editor-drivers-list">
            {opcUaDrivers.length === 0 ? <div className="screen-editor-drivers-note">No OPC UA drivers configured yet.</div> : null}
            {opcUaDrivers.map((driver) => {
              const selected = driver.id === selectedOpcUaDriver?.id;
              const status = statusById.get(driver.id) ?? null;
              const badge = formatStatusBadge(status);
              const linkedTags = linkedTagCountByDriverId.get(driver.id) ?? 0;
              const hasMissingStatus = !statusById.has(driver.id);
              const hasDuplicateId = duplicateOpcUaDriverIds.has(driver.id.trim());
              return (
                <button
                  key={driver.id}
                  type="button"
                  className={selected ? "screen-editor-driver-card screen-editor-driver-card--selected" : "screen-editor-driver-card"}
                  onClick={() => setSelectedOpcUaDriverId(driver.id)}
                >
                  <div className="screen-editor-driver-card__name">{driver.name ?? driver.id}</div>
                  <div className="screen-editor-driver-card__meta">{driver.id}</div>
                  <div className="screen-editor-driver-card__meta" title={driver.endpointUrl}>{driver.endpointUrl}</div>
                  <div className="screen-editor-driver-card__status">
                    <span className={badge.className}>{badge.label}</span>
                    <span>{driver.enabled ? "enabled" : "disabled"}</span>
                    <span>tags: {linkedTags}</span>
                  </div>
                  {hasMissingStatus || hasDuplicateId ? (
                    <div className="screen-editor-driver-card__warning">
                      {hasDuplicateId ? "Duplicate driver id" : "Runtime status missing"}
                    </div>
                  ) : null}
                </button>
              );
            })}
            <div className="screen-editor-driver-actions">
              <WorkbenchButton onClick={() => void addOpcUaDriver()}>Add OPC UA Driver</WorkbenchButton>
              <WorkbenchButton onClick={() => void duplicateOpcUaDriver()} disabled={!selectedOpcUaDriver}>Duplicate</WorkbenchButton>
            </div>
          </aside>

          <main className="screen-editor-drivers-editor">
            {opcUaDraft ? (
              <>
                <WorkbenchCollapsibleSection title="Connection" storageKey="drivers.opcua.connection">
                  <div className="screen-editor-drivers-form">
                    <label className="screen-editor-settings-field">
                      <span>Driver Name</span>
                      <input
                        className="workbench-input"
                        value={opcUaDraft.name ?? ""}
                        onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Driver ID</span>
                      <input
                        className="workbench-input"
                        value={opcUaDraft.id}
                        onChange={(event) => {
                          setDriverIdError("");
                          setOpcUaDraft((prev) => (prev ? { ...prev, id: event.target.value } : prev));
                        }}
                      />
                    </label>
                    {driverIdError ? <div className="screen-editor-drivers-warning">{driverIdError}</div> : null}
                    <label className="screen-editor-settings-field">
                      <span>Endpoint URL</span>
                      <input
                        className="workbench-input"
                        value={opcUaDraft.endpointUrl}
                        onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, endpointUrl: event.target.value } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-check">
                      <input
                        type="checkbox"
                        checked={opcUaDraft.enabled}
                        onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, enabled: event.target.checked } : prev))}
                      />
                      <span>Auto connect on runtime start</span>
                    </label>
                  </div>
                </WorkbenchCollapsibleSection>

                <WorkbenchCollapsibleSection title="Security" storageKey="drivers.opcua.security">
                  <div className="screen-editor-drivers-form">
                    <label className="screen-editor-settings-field">
                      <span>Security Policy</span>
                      <select
                        className="workbench-select"
                        value={opcUaDraft.securityPolicy ?? "None"}
                        onChange={(event) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, securityPolicy: event.target.value as OpcUaDriverConfig["securityPolicy"] }
                          : prev))}
                      >
                        {OPC_SECURITY_POLICIES.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Security Mode</span>
                      <select
                        className="workbench-select"
                        value={opcUaDraft.securityMode ?? "None"}
                        onChange={(event) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, securityMode: event.target.value as OpcUaDriverConfig["securityMode"] }
                          : prev))}
                      >
                        {OPC_SECURITY_MODES.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Username</span>
                      <input
                        className="workbench-input"
                        value={opcUaDraft.username ?? ""}
                        onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, username: event.target.value } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Password</span>
                      <input
                        className="workbench-input"
                        type="password"
                        value={opcUaDraft.password ?? ""}
                        onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, password: event.target.value } : prev))}
                      />
                    </label>
                  </div>
                </WorkbenchCollapsibleSection>

                <WorkbenchCollapsibleSection title="Read Mode / Subscription" storageKey="drivers.opcua.read-mode">
                  <div className="screen-editor-drivers-form screen-editor-drivers-form--two-columns">
                    <label className="screen-editor-settings-field">
                      <span>Read Mode</span>
                      <select
                        className="workbench-select"
                        value={opcUaDraft.readMode ?? "subscription"}
                        onChange={(event) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, readMode: event.target.value as OpcUaDriverConfig["readMode"] }
                          : prev))}
                      >
                        {OPC_READ_MODES.map((item) => (
                          <option key={item} value={item}>{item === "subscription" ? "Subscription" : "Polling"}</option>
                        ))}
                      </select>
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Publishing Interval (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={1}
                        value={toInputNumberValue(opcUaDraft.publishingIntervalMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, publishingIntervalMs: toOptionalInputNumber(value) }
                          : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Sampling Interval (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={1}
                        value={toInputNumberValue(opcUaDraft.samplingIntervalMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, samplingIntervalMs: toOptionalInputNumber(value) }
                          : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Queue Size</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={1}
                        value={toInputNumberValue(opcUaDraft.queueSize)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, queueSize: toOptionalInputNumber(value) }
                          : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Subscription Batch Size</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={1}
                        value={toInputNumberValue(opcUaDraft.subscriptionBatchSize)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, subscriptionBatchSize: toOptionalInputNumber(value) }
                          : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-check">
                      <input
                        type="checkbox"
                        checked={opcUaDraft.discardOldest ?? true}
                        onChange={(event) => setOpcUaDraft((prev) => (prev
                          ? { ...prev, discardOldest: event.target.checked }
                          : prev))}
                      />
                      <span>Discard Oldest</span>
                    </label>
                  </div>
                  <div className="screen-editor-drivers-note">
                    Subscription mode is recommended for many OPC UA tags. Polling is fallback.
                  </div>
                </WorkbenchCollapsibleSection>

                <WorkbenchCollapsibleSection title="Timing" storageKey="drivers.opcua.timing">
                  <div className="screen-editor-drivers-form screen-editor-drivers-form--two-columns">
                    <label className="screen-editor-settings-field">
                      <span>Connect Timeout (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={100}
                        value={toInputNumberValue(opcUaDraft.connectTimeoutMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev ? { ...prev, connectTimeoutMs: toOptionalInputNumber(value) } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Operation Timeout (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={100}
                        value={toInputNumberValue(opcUaDraft.operationTimeoutMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev ? { ...prev, operationTimeoutMs: toOptionalInputNumber(value) } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Session Timeout (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={1000}
                        value={toInputNumberValue(opcUaDraft.sessionTimeoutMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev ? { ...prev, sessionTimeoutMs: toOptionalInputNumber(value) } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Keep Alive (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={500}
                        value={toInputNumberValue(opcUaDraft.keepAliveIntervalMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev ? { ...prev, keepAliveIntervalMs: toOptionalInputNumber(value) } : prev))}
                      />
                    </label>
                    <label className="screen-editor-settings-field">
                      <span>Reconnect (ms)</span>
                      <InputNumber
                        className="screen-editor-settings-input-number"
                        min={100}
                        value={toInputNumberValue(opcUaDraft.reconnectMs)}
                        onChange={(value) => setOpcUaDraft((prev) => (prev ? { ...prev, reconnectMs: toOptionalInputNumber(value) } : prev))}
                      />
                    </label>
                  </div>
                  <div className="screen-editor-drivers-note">
                    Session timeout should be significantly higher than operation timeout. Recommended: 60000 ms.
                  </div>
                  <div className="screen-editor-drivers-note">
                    Recommended OPC UA timing: Connect 5000 ms, Operation 5000 ms, Session 60000 ms, Keep Alive 5000 ms, Reconnect 5000-10000 ms.
                  </div>
                </WorkbenchCollapsibleSection>

                <WorkbenchCollapsibleSection title="Actions" storageKey="drivers.opcua.actions">
                  <div className="screen-editor-driver-actions">
                    <WorkbenchButton variant="primary" disabled={!opcUaDraft || busyAction !== ""} onClick={() => void saveOpcUaConfig()}>
                      {busyAction === "save" ? "Saving..." : "Save"}
                    </WorkbenchButton>
                    <WorkbenchButton disabled={!opcUaDraft || busyAction !== ""} onClick={() => void testOpcUa()}>
                      {busyAction === "test" ? "Testing..." : "Test Connection"}
                    </WorkbenchButton>
                    <WorkbenchButton disabled={!opcUaDraft || busyAction !== ""} onClick={() => void connectOpcUa()}>
                      {busyAction === "connect" ? "Connecting..." : "Connect"}
                    </WorkbenchButton>
                    <WorkbenchButton disabled={!opcUaDraft || busyAction !== ""} onClick={() => void disconnectOpcUa()}>
                      {busyAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
                    </WorkbenchButton>
                    <WorkbenchButton disabled={!opcUaDraft || busyAction !== ""} onClick={() => void refreshStatus(opcUaDraft?.id)}>
                      {busyAction === "refresh" ? "Refreshing..." : "Refresh Status"}
                    </WorkbenchButton>
                    <WorkbenchButton variant="danger" disabled={!selectedOpcUaDriver || busyAction !== ""} onClick={() => void openDeleteTagsConfirm()}>
                      Delete All Tags For Driver
                    </WorkbenchButton>
                    <WorkbenchButton variant="danger" disabled={!selectedOpcUaDriver || busyAction !== ""} onClick={() => void openDeleteDriverConfirm()}>
                      Delete Driver
                    </WorkbenchButton>
                  </div>
                </WorkbenchCollapsibleSection>

                <WorkbenchCollapsibleSection title="Status / Diagnostics" storageKey="drivers.opcua.diagnostics">
                  <div className="screen-editor-drivers-status-card screen-editor-drivers-status-card--in-section">
                    <div className="screen-editor-drivers-status-line">
                      <span>Status</span>
                      <span>
                        <span className={statusBadge.className}>{statusBadge.label}</span>
                        {currentOpcStatus?.health === "running" && hasClockWarning ? (
                          <span className="screen-editor-driver-status-badge screen-editor-driver-status-badge--reconnecting">Warning</span>
                        ) : null}
                      </span>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Current message</span>
                      <strong>{currentOpcStatus?.message ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Linked tags</span>
                      <strong>{selectedLinkedTags}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Endpoint</span>
                      <strong>{currentOpcStatus?.endpointUrl ?? selectedOpcUaDriver?.endpointUrl ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Read mode</span>
                      <strong>{currentOpcStatus?.readMode ?? selectedOpcUaDriver?.readMode ?? "subscription"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Subscription state</span>
                      <strong>{currentOpcStatus?.subscriptionState ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Subscription active</span>
                      <strong>{currentOpcStatus?.subscriptionActive ? "Yes" : "No"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Subscribed tags</span>
                      <strong>{currentOpcStatus?.subscribedTagCount ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last notification</span>
                      <strong>{formatTimestamp(currentOpcStatus?.lastSubscriptionUpdateAt)}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Subscription error</span>
                      <strong>{currentOpcStatus?.subscriptionError ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last updated</span>
                      <strong>{formatTimestamp(currentOpcStatus?.updatedAt)}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last connected</span>
                      <strong>{formatTimestamp(currentOpcStatus?.lastConnectedAt)}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last disconnected</span>
                      <strong>{formatTimestamp(currentOpcStatus?.lastDisconnectedAt)}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Reconnect attempt</span>
                      <strong>{currentOpcStatus?.reconnectAttempt ?? 0}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Polling</span>
                      <strong>{currentOpcStatus?.pollingSkipped ? "Skipped" : "Active"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last poll</span>
                      <strong>{formatTimestamp(currentOpcStatus?.lastPollAt)}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last poll duration</span>
                      <strong>{typeof currentOpcStatus?.lastPollDurationMs === "number" ? `${currentOpcStatus.lastPollDurationMs} ms` : "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last poll tags</span>
                      <strong>{currentOpcStatus?.lastPollTagCount ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last poll batches</span>
                      <strong>{currentOpcStatus?.lastPollBatchCount ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Polling skip reason</span>
                      <strong>{currentOpcStatus?.pollingSkipReason ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last error</span>
                      <strong>{currentOpcStatus?.lastError ?? "-"}</strong>
                    </div>
                    <div className="screen-editor-drivers-status-line">
                      <span>Last error at</span>
                      <strong>{formatTimestamp(currentOpcStatus?.lastErrorAt)}</strong>
                    </div>
                    {statusStale ? <div className="screen-editor-drivers-warning">Status may be stale: {statusRefreshError || "polling request failed"}</div> : null}
                    {currentOpcStatus?.message ? <div className="screen-editor-drivers-note">{currentOpcStatus.message}</div> : null}
                    {clockWarningText ? (
                      <div className="screen-editor-drivers-warning">
                        <div><strong>Clock mismatch detected. Synchronize OPC UA server and SCADA server time. This warning should not force reconnect, but it can affect secure channel stability.</strong></div>
                        <div>Details: {clockWarningText}</div>
                      </div>
                    ) : null}
                  </div>
                </WorkbenchCollapsibleSection>
              </>
            ) : (
              <div className="screen-editor-drivers-note">No OPC UA driver selected.</div>
            )}
          </main>
        </div>
      ) : null}

      {activeTab === "simulation" ? (
        <div className="screen-editor-drivers-panel">
          <WorkbenchSection title="Global Simulation">
            <div className="screen-editor-drivers-form">
              <label className="screen-editor-settings-field">
                <span>Simulation Driver</span>
                <div className="screen-editor-drivers-row">
                  <select
                    className="workbench-select"
                    value={selectedSimulationDriver?.id ?? ""}
                    onChange={(event) => setSelectedSimulationDriverId(event.target.value)}
                    disabled={simulationDrivers.length === 0}
                  >
                    {simulationDrivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>{driver.name ?? driver.id}</option>
                    ))}
                  </select>
                  <WorkbenchButton onClick={() => void addSimulationDriver()}>Add</WorkbenchButton>
                </div>
              </label>

              {simulationDraft ? (
                <>
                  <label className="screen-editor-settings-check">
                    <input
                      type="checkbox"
                      checked={simulationDraft.enabled}
                      onChange={(event) => setSimulationDraft((prev) => (prev ? { ...prev, enabled: event.target.checked } : prev))}
                    />
                    <span>Enable Simulation Driver</span>
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Driver Name</span>
                    <input
                      className="workbench-input"
                      value={simulationDraft.name ?? ""}
                      onChange={(event) => setSimulationDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Update Interval (ms)</span>
                    <InputNumber
                      className="screen-editor-settings-input-number"
                      min={100}
                      value={toInputNumberValue(simulationDraft.updateIntervalMs)}
                      onChange={(value) => setSimulationDraft((prev) => (prev ? { ...prev, updateIntervalMs: toOptionalInputNumber(value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Scheduler Tick (ms)</span>
                    <InputNumber
                      className="screen-editor-settings-input-number"
                      min={50}
                      value={toInputNumberValue(simulationDraft.schedulerTickMs)}
                      onChange={(value) => setSimulationDraft((prev) => (prev ? { ...prev, schedulerTickMs: toOptionalInputNumber(value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Global Seed</span>
                    <InputNumber
                      className="screen-editor-settings-input-number"
                      value={toInputNumberValue(simulationDraft.globalSeed)}
                      onChange={(value) => setSimulationDraft((prev) => (prev ? { ...prev, globalSeed: toOptionalInputNumber(value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Default Variation</span>
                    <select
                      className="workbench-select"
                      value={simulationDraft.defaultVariationMode ?? "perTagSeed"}
                      onChange={(event) =>
                        setSimulationDraft((prev) => (prev
                          ? {
                            ...prev,
                            defaultVariationMode: event.target.value as NonNullable<SimulatedDriverConfig["defaultVariationMode"]>,
                          }
                          : prev))}
                    >
                      <option value="perTagSeed">Per-tag Seed</option>
                      <option value="same">Same</option>
                      <option value="perTagPhase">Per-tag Phase</option>
                      <option value="perTagOffset">Per-tag Offset</option>
                      <option value="perTagNoise">Per-tag Noise</option>
                    </select>
                  </label>
                </>
              ) : (
                <div className="screen-editor-drivers-note">No simulation driver configured yet.</div>
              )}
            </div>
            <div className="screen-editor-drivers-actions">
              <WorkbenchButton variant="primary" disabled={!simulationDraft || busyAction !== ""} onClick={() => void saveSimulationConfig()}>
                {busyAction === "save" ? "Saving..." : "Save Simulation Settings"}
              </WorkbenchButton>
            </div>
            <div className="screen-editor-drivers-status-card">
              <div className="screen-editor-drivers-status-line">
                <span>Status</span>
                <strong>{simulationStatus?.health ?? "stopped"}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Simulated Tags</span>
                <strong>{simulatedTagsCount}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Simulation Groups</span>
                <strong>{simulationStatus?.simulationGroupCount ?? 0}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Last Tick Duration</span>
                <strong>
                  {typeof simulationStatus?.simulationLastTickDurationMs === "number"
                    ? `${simulationStatus.simulationLastTickDurationMs} ms`
                    : "-"}
                </strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Last Batch Size</span>
                <strong>{simulationStatus?.simulationLastBatchSize ?? 0}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Generated Updates</span>
                <strong>{simulationStatus?.simulationGeneratedUpdates ?? 0}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Dropped Updates</span>
                <strong>{simulationStatus?.simulationDroppedUpdates ?? 0}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Tags per Group</span>
                <strong>{(simulationStatus?.simulationTagsPerGroup ?? []).join(", ") || "-"}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Last Error</span>
                <strong>{simulationStatus?.simulationLastError ?? "-"}</strong>
              </div>
              <div className="screen-editor-drivers-note">
                Per-tag simulation behavior is configured only in Tags window for tags with Source Type = Simulated.
              </div>
            </div>
          </WorkbenchSection>
        </div>
      ) : null}

      <Modal
        title="Delete OPC UA tags"
        open={deleteTagsModalOpen}
        onCancel={() => setDeleteTagsModalOpen(false)}
        onOk={() => void confirmDeleteTags()}
        okText={busyAction === "delete-tags" ? "Deleting..." : "Delete Tags"}
        okButtonProps={{ danger: true, disabled: busyAction !== "" || impactLoading }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div>Driver: <strong>{selectedOpcUaDriver?.name ?? selectedOpcUaDriver?.id}</strong> ({selectedOpcUaDriver?.id ?? "-"})</div>
          <div>Linked tags: <strong>{impactPreview?.tagCount ?? 0}</strong></div>
          <div>Affected macros: <strong>{impactPreview?.affectedMacroCount ?? 0}</strong></div>
          <div>Dynamic tag macros: <strong>{impactPreview?.dynamicMacroCount ?? 0}</strong></div>
          <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
            Tags preview: {(impactPreview?.tagNamesPreview ?? []).length > 0 ? `\n${(impactPreview?.tagNamesPreview ?? []).join("\n")}` : "\nNone"}
          </div>
          <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
            Affected macros preview:{"\n"}
            {renderAffectedMacroPreview(impactPreview?.affectedMacros ?? [])}
          </div>
          <div className="screen-editor-drivers-warning">
            Affected macros will be marked invalid and excluded from runtime execution.
          </div>
        </div>
      </Modal>

      <Modal
        title="Delete OPC UA driver"
        open={deleteDriverModalOpen}
        onCancel={() => setDeleteDriverModalOpen(false)}
        onOk={() => void confirmDeleteDriver()}
        okText={busyAction === "delete-driver" ? "Deleting..." : "Delete Driver"}
        okButtonProps={{
          danger: true,
          disabled: busyAction !== "" || impactLoading || ((impactPreview?.tagCount ?? 0) > 0 && !deleteDriverWithTags),
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div>Driver: <strong>{selectedOpcUaDriver?.name ?? selectedOpcUaDriver?.id}</strong> ({selectedOpcUaDriver?.id ?? "-"})</div>
          <div>Linked tags: <strong>{impactPreview?.tagCount ?? 0}</strong></div>
          <label className="screen-editor-settings-check">
            <input
              type="checkbox"
              checked={deleteDriverWithTags}
              onChange={(event) => setDeleteDriverWithTags(event.target.checked)}
            />
            <span>Also delete all linked tags</span>
          </label>
          {deleteDriverWithTags ? (
            <>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                Tags preview: {(impactPreview?.tagNamesPreview ?? []).length > 0 ? `\n${(impactPreview?.tagNamesPreview ?? []).join("\n")}` : "\nNone"}
              </div>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                Affected macros preview:{"\n"}
                {renderAffectedMacroPreview(impactPreview?.affectedMacros ?? [])}
              </div>
              <div className="screen-editor-drivers-warning">
                Affected macros will be marked invalid and excluded from runtime execution.
              </div>
            </>
          ) : (
            <div className="screen-editor-drivers-note">
              If linked tags exist, deletion is blocked unless "Also delete all linked tags" is enabled.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
