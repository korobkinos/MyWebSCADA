import { useEffect, useMemo, useState } from "react";
import type { DriverStatus, OpcUaDriverConfig, ScadaProject, SimulatedDriverConfig, TagDefinition } from "@web-scada/shared";
import { message } from "antd";
import { api } from "../../../services/api";
import { useScadaStore } from "../../../store/scada-store";
import {
  WorkbenchButton,
  WorkbenchSection,
  WorkbenchTabs,
  type WorkbenchTabItem,
} from "../../../components/workbench";

type ScreenEditorDriversWindowProps = {
  drivers?: DriverStatus[];
};

type DriversTab = "opcua" | "simulation";
type SimTagMode = "manual" | "random" | "ramp" | "toggle";

const OPC_SECURITY_POLICIES: Array<NonNullable<OpcUaDriverConfig["securityPolicy"]>> = ["None", "Basic256Sha256"];
const OPC_SECURITY_MODES: Array<NonNullable<OpcUaDriverConfig["securityMode"]>> = ["None", "Sign", "SignAndEncrypt"];

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
    timeoutMs: 5000,
    reconnectMs: 2000,
    username: "",
    password: "",
  };
}

function defaultSimulationDriver(): SimulatedDriverConfig {
  return {
    id: createDriverId("sim"),
    type: "simulated",
    enabled: true,
    name: "Simulation Driver",
    updateIntervalMs: 1000,
    defaultMode: "ramp",
    defaultMin: 0,
    defaultMax: 100,
    defaultStep: 1,
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

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

function getTagMode(tag: TagDefinition): SimTagMode {
  const pattern = ((tag.address as Record<string, unknown> | undefined)?.pattern as string | undefined) ?? "";
  if (tag.dataType === "BOOL") {
    return pattern === "static" ? "manual" : "toggle";
  }
  if (tag.dataType === "STRING") {
    return "manual";
  }
  if (pattern === "random") {
    return "random";
  }
  if (pattern === "static") {
    return "manual";
  }
  return "ramp";
}

function setTagMode(tag: TagDefinition, mode: SimTagMode): TagDefinition {
  const currentAddress = ((tag.address ?? {}) as Record<string, unknown>);
  let pattern: "toggle" | "sine" | "random" | "static" = "static";

  if (tag.dataType === "BOOL") {
    pattern = mode === "manual" ? "static" : "toggle";
  } else if (tag.dataType === "STRING") {
    pattern = "static";
  } else if (mode === "random") {
    pattern = "random";
  } else if (mode === "manual") {
    pattern = "static";
  } else {
    pattern = "sine";
  }

  return {
    ...tag,
    sourceType: "simulated",
    address: {
      ...currentAddress,
      pattern,
    },
  };
}

function upsertProjectDriver(project: ScadaProject, driver: OpcUaDriverConfig | SimulatedDriverConfig): ScadaProject {
  const index = project.drivers.findIndex((item) => item.id === driver.id);
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

function patchSimulationTag(tag: TagDefinition): TagDefinition {
  const sourceAddress = (tag.address ?? {}) as Record<string, unknown>;
  const normalized: Record<string, unknown> = {
    ...sourceAddress,
  };

  const pattern = normalized.pattern;
  if (pattern !== "toggle" && pattern !== "sine" && pattern !== "random" && pattern !== "static") {
    normalized.pattern = tag.dataType === "BOOL" ? "toggle" : "sine";
  }

  return {
    ...tag,
    sourceType: "simulated",
    address: normalized,
  };
}

function formatStatusBadge(status: DriverStatus | null): { label: string; className: string } {
  const health = status?.health ?? "stopped";
  if (health === "running") {
    return { label: "Connected", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--connected" };
  }
  if (health === "starting" || health === "reconnecting") {
    return { label: "Connecting", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--connecting" };
  }
  if (health === "error") {
    return { label: "Error", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--error" };
  }
  return { label: "Disconnected", className: "screen-editor-driver-status-badge screen-editor-driver-status-badge--disconnected" };
}

export function ScreenEditorDriversWindow({ drivers = [] }: ScreenEditorDriversWindowProps) {
  const project = useScadaStore((s) => s.project);
  const runtimeDrivers = useScadaStore((s) => s.drivers);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);

  const [activeTab, setActiveTab] = useState<DriversTab>("opcua");
  const [selectedOpcUaDriverId, setSelectedOpcUaDriverId] = useState("");
  const [opcUaDraft, setOpcUaDraft] = useState<OpcUaDriverConfig | null>(null);
  const [selectedSimulationDriverId, setSelectedSimulationDriverId] = useState("");
  const [simulationDraft, setSimulationDraft] = useState<SimulatedDriverConfig | null>(null);
  const [selectedSimulationTagName, setSelectedSimulationTagName] = useState("");
  const [simulationTagDraft, setSimulationTagDraft] = useState<TagDefinition | null>(null);
  const [statusOverride, setStatusOverride] = useState<DriverStatus | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "save" | "test" | "connect" | "disconnect" | "refresh">("");

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

  const simulationTags = useMemo(() => {
    const tags = project?.tags ?? [];
    if (!selectedSimulationDriver?.id) {
      return tags.filter((tag) => tag.sourceType === "simulated");
    }
    return tags.filter((tag) => tag.sourceType === "simulated" || tag.driverId === selectedSimulationDriver.id);
  }, [project?.tags, selectedSimulationDriver?.id]);

  const selectedSimulationTag = useMemo(
    () => simulationTags.find((tag) => tag.name === selectedSimulationTagName) ?? simulationTags[0] ?? null,
    [selectedSimulationTagName, simulationTags],
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
    setOpcUaDraft({ ...selectedOpcUaDriver });
  }, [selectedOpcUaDriver, selectedOpcUaDriverId]);

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
    if (!selectedSimulationTag) {
      setSelectedSimulationTagName("");
      setSimulationTagDraft(null);
      return;
    }
    if (selectedSimulationTagName !== selectedSimulationTag.name) {
      setSelectedSimulationTagName(selectedSimulationTag.name);
    }
    setSimulationTagDraft(patchSimulationTag({ ...selectedSimulationTag }));
  }, [selectedSimulationTag, selectedSimulationTagName]);

  const refreshStatus = async (driverId?: string): Promise<void> => {
    setBusyAction("refresh");
    try {
      await loadDrivers();
      if (driverId) {
        const statusResponse = await api.getOpcUaStatus(driverId);
        if (statusResponse.status) {
          setStatusOverride(statusResponse.status);
        }
      }
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to refresh driver status");
    } finally {
      setBusyAction("");
    }
  };

  const saveOpcUaConfig = async (): Promise<void> => {
    if (!project || !opcUaDraft) {
      return;
    }
    setBusyAction("save");
    try {
      const normalized: OpcUaDriverConfig = {
        ...opcUaDraft,
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
      updateProjectJson(upsertProjectDriver(project, normalized));
      await saveProject();
      await refreshStatus(normalized.id);
      void message.success("OPC UA config saved");
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
    try {
      const payload = opcUaDraft && opcUaDraft.id === selectedOpcUaDriver.id ? { config: opcUaDraft } : { driverId: selectedOpcUaDriver.id };
      const response = await api.opcUaConnect(payload);
      if (response.status) {
        setStatusOverride(response.status);
      }
      await refreshStatus(selectedOpcUaDriver.id);
      void message.success("OPC UA connected");
    } catch (error) {
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
    try {
      const response = await api.opcUaDisconnect(selectedOpcUaDriver.id);
      if (response.status) {
        setStatusOverride(response.status);
      }
      await refreshStatus(selectedOpcUaDriver.id);
      void message.success("OPC UA disconnected");
    } catch (error) {
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

  const applySimulationTag = (): void => {
    if (!project || !simulationTagDraft) {
      return;
    }

    const nextTag = patchSimulationTag(simulationTagDraft);
    const nextTags = project.tags.map((tag) => (tag.name === nextTag.name ? nextTag : tag));
    updateProjectJson({
      ...project,
      tags: nextTags,
    });
    void message.success(`Simulation tag updated: ${nextTag.name}`);
  };

  const saveSimulationTag = async (): Promise<void> => {
    if (!simulationTagDraft) {
      return;
    }
    applySimulationTag();
    setBusyAction("save");
    try {
      await saveProject();
      void message.success("Simulation tag settings saved");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to save simulation tag settings");
    } finally {
      setBusyAction("");
    }
  };

  const addOpcUaDriver = async (): Promise<void> => {
    if (!project) {
      return;
    }
    const driver = defaultOpcUaDriver();
    updateProjectJson(upsertProjectDriver(project, driver));
    setSelectedOpcUaDriverId(driver.id);
    setOpcUaDraft(driver);
    try {
      await saveProject();
      void message.success("OPC UA driver created");
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

  if (!project) {
    return <div className="screen-editor-window-content">Project is not loaded</div>;
  }

  const tabItems: WorkbenchTabItem[] = [
    { id: "opcua", title: "OPC UA", active: activeTab === "opcua", onClick: () => setActiveTab("opcua") },
    { id: "simulation", title: "Simulation", active: activeTab === "simulation", onClick: () => setActiveTab("simulation") },
  ];

  const statusBadge = formatStatusBadge(currentOpcStatus);
  const mode = simulationTagDraft ? getTagMode(simulationTagDraft) : "ramp";
  const simAddress = (simulationTagDraft?.address ?? {}) as Record<string, unknown>;
  const isBoolSimTag = simulationTagDraft?.dataType === "BOOL";
  const isStringSimTag = simulationTagDraft?.dataType === "STRING";
  const isNumericSimTag = Boolean(simulationTagDraft && !isBoolSimTag && !isStringSimTag);

  return (
    <div className="screen-editor-window-content screen-editor-drivers-window">
      <WorkbenchTabs items={tabItems} className="screen-editor-drivers-tabs" />

      {activeTab === "opcua" ? (
        <div className="screen-editor-drivers-panel">
          <WorkbenchSection title="OPC UA Connection">
            <div className="screen-editor-drivers-form">
              <label className="screen-editor-settings-field">
                <span>Driver</span>
                <div className="screen-editor-drivers-row">
                  <select
                    className="workbench-select"
                    value={selectedOpcUaDriver?.id ?? ""}
                    onChange={(event) => setSelectedOpcUaDriverId(event.target.value)}
                    disabled={opcUaDrivers.length === 0}
                  >
                    {opcUaDrivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>{driver.name ?? driver.id}</option>
                    ))}
                  </select>
                  <WorkbenchButton onClick={() => void addOpcUaDriver()}>Add</WorkbenchButton>
                </div>
              </label>

              {opcUaDraft ? (
                <>
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
                    <input className="workbench-input" value={opcUaDraft.id} disabled />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Endpoint URL</span>
                    <input
                      className="workbench-input"
                      value={opcUaDraft.endpointUrl}
                      onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, endpointUrl: event.target.value } : prev))}
                    />
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
                    <span>Timeout (ms)</span>
                    <input
                      className="workbench-input"
                      type="number"
                      min={100}
                      value={opcUaDraft.timeoutMs ?? ""}
                      onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, timeoutMs: toOptionalNumber(event.target.value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Reconnect (ms)</span>
                    <input
                      className="workbench-input"
                      type="number"
                      min={100}
                      value={opcUaDraft.reconnectMs ?? ""}
                      onChange={(event) => setOpcUaDraft((prev) => (prev ? { ...prev, reconnectMs: toOptionalNumber(event.target.value) } : prev))}
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
                </>
              ) : (
                <div className="screen-editor-drivers-note">No OPC UA driver configured yet.</div>
              )}
            </div>

            <div className="screen-editor-drivers-actions">
              <WorkbenchButton variant="primary" disabled={!opcUaDraft || busyAction !== ""} onClick={() => void saveOpcUaConfig()}>
                {busyAction === "save" ? "Saving..." : "Save Config"}
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
            </div>

            <div className="screen-editor-drivers-status-card">
              <div className="screen-editor-drivers-status-line">
                <span>Status</span>
                <span className={statusBadge.className}>{statusBadge.label}</span>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Endpoint</span>
                <strong>{opcUaDraft?.endpointUrl || "-"}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Last updated</span>
                <strong>{currentOpcStatus?.updatedAt ? new Date(currentOpcStatus.updatedAt).toLocaleString() : "-"}</strong>
              </div>
              <div className="screen-editor-drivers-status-line">
                <span>Last error</span>
                <strong>{currentOpcStatus?.health === "error" ? (currentOpcStatus.message || "Unknown error") : "-"}</strong>
              </div>
              {currentOpcStatus?.message ? (
                <div className="screen-editor-drivers-note">{currentOpcStatus.message}</div>
              ) : null}
              {isOpcUaClockWarning(currentOpcStatus?.message) ? (
                <div className="screen-editor-drivers-warning">
                  OPC UA server/client clocks differ. Check PLC/server/VM time and timezone.
                </div>
              ) : null}
            </div>
          </WorkbenchSection>
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
                    <input
                      className="workbench-input"
                      type="number"
                      min={100}
                      value={simulationDraft.updateIntervalMs ?? ""}
                      onChange={(event) => setSimulationDraft((prev) => (prev ? { ...prev, updateIntervalMs: toOptionalNumber(event.target.value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Mode</span>
                    <select
                      className="workbench-select"
                      value={simulationDraft.defaultMode ?? "ramp"}
                      onChange={(event) => setSimulationDraft((prev) => (prev
                        ? { ...prev, defaultMode: event.target.value as SimulatedDriverConfig["defaultMode"] }
                        : prev))}
                    >
                      <option value="manual">Manual</option>
                      <option value="random">Random</option>
                      <option value="ramp">Ramp/Oscillation</option>
                    </select>
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Default Analog Min</span>
                    <input
                      className="workbench-input"
                      type="number"
                      value={simulationDraft.defaultMin ?? ""}
                      onChange={(event) => setSimulationDraft((prev) => (prev ? { ...prev, defaultMin: toOptionalNumber(event.target.value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Default Analog Max</span>
                    <input
                      className="workbench-input"
                      type="number"
                      value={simulationDraft.defaultMax ?? ""}
                      onChange={(event) => setSimulationDraft((prev) => (prev ? { ...prev, defaultMax: toOptionalNumber(event.target.value) } : prev))}
                    />
                  </label>
                  <label className="screen-editor-settings-field">
                    <span>Default Step</span>
                    <input
                      className="workbench-input"
                      type="number"
                      value={simulationDraft.defaultStep ?? ""}
                      onChange={(event) => setSimulationDraft((prev) => (prev ? { ...prev, defaultStep: toOptionalNumber(event.target.value) } : prev))}
                    />
                  </label>
                </>
              ) : (
                <div className="screen-editor-drivers-note">No simulation driver configured yet.</div>
              )}
            </div>
            <div className="screen-editor-drivers-actions">
              <WorkbenchButton variant="primary" disabled={!simulationDraft || busyAction !== ""} onClick={() => void saveSimulationConfig()}>
                {busyAction === "save" ? "Saving..." : "Save Simulation"}
              </WorkbenchButton>
            </div>
          </WorkbenchSection>

          <WorkbenchSection title="Per-Tag Simulation">
            <div className="screen-editor-drivers-form">
              <label className="screen-editor-settings-field">
                <span>Simulated Tag</span>
                <select
                  className="workbench-select"
                  value={selectedSimulationTag?.name ?? ""}
                  onChange={(event) => setSelectedSimulationTagName(event.target.value)}
                  disabled={simulationTags.length === 0}
                >
                  {simulationTags.map((tag) => (
                    <option key={tag.name} value={tag.name}>{tag.name}</option>
                  ))}
                </select>
              </label>

              {simulationTagDraft ? (
                <>
                  <label className="screen-editor-settings-field">
                    <span>Data Type</span>
                    <select
                      className="workbench-select"
                      value={simulationTagDraft.dataType}
                      onChange={(event) => setSimulationTagDraft((prev) => (prev ? { ...prev, dataType: event.target.value as TagDefinition["dataType"] } : prev))}
                    >
                      <option value="BOOL">BOOL</option>
                      <option value="INT">INT</option>
                      <option value="UINT">UINT</option>
                      <option value="DINT">DINT</option>
                      <option value="UDINT">UDINT</option>
                      <option value="REAL">REAL</option>
                      <option value="STRING">STRING</option>
                    </select>
                  </label>

                  <label className="screen-editor-settings-field">
                    <span>Mode</span>
                    <select
                      className="workbench-select"
                      value={mode}
                      onChange={(event) => setSimulationTagDraft((prev) => (prev ? setTagMode(prev, event.target.value as SimTagMode) : prev))}
                    >
                      {isBoolSimTag ? <option value="toggle">Toggle/Pulse</option> : null}
                      <option value="manual">Manual Value</option>
                      {isNumericSimTag ? <option value="random">Random Range</option> : null}
                      {isNumericSimTag ? <option value="ramp">Ramp/Oscillation</option> : null}
                    </select>
                  </label>

                  <label className="screen-editor-settings-field">
                    <span>Interval (ms)</span>
                    <input
                      className="workbench-input"
                      type="number"
                      min={50}
                      value={String(simAddress.periodMs ?? simulationTagDraft.scanRateMs ?? "")}
                      onChange={(event) => setSimulationTagDraft((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        const nextValue = toOptionalNumber(event.target.value);
                        return {
                          ...prev,
                          scanRateMs: nextValue,
                          address: {
                            ...(prev.address as Record<string, unknown> ?? {}),
                            periodMs: nextValue,
                          },
                        };
                      })}
                    />
                  </label>

                  {isBoolSimTag ? (
                    <label className="screen-editor-settings-field">
                      <span>Manual Value</span>
                      <select
                        className="workbench-select"
                        value={String(simAddress.value ?? false)}
                        onChange={(event) => setSimulationTagDraft((prev) => (prev
                          ? {
                            ...prev,
                            address: {
                              ...(prev.address as Record<string, unknown> ?? {}),
                              value: event.target.value === "true",
                            },
                          }
                          : prev))}
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    </label>
                  ) : null}

                  {isStringSimTag ? (
                    <label className="screen-editor-settings-field">
                      <span>Manual Value</span>
                      <input
                        className="workbench-input"
                        value={String(simAddress.value ?? "")}
                        onChange={(event) => setSimulationTagDraft((prev) => (prev
                          ? {
                            ...prev,
                            address: {
                              ...(prev.address as Record<string, unknown> ?? {}),
                              value: event.target.value,
                            },
                          }
                          : prev))}
                      />
                    </label>
                  ) : null}

                  {isNumericSimTag ? (
                    <>
                      <label className="screen-editor-settings-field">
                        <span>Min</span>
                        <input
                          className="workbench-input"
                          type="number"
                          value={String(simAddress.min ?? "")}
                          onChange={(event) => setSimulationTagDraft((prev) => (prev
                            ? {
                              ...prev,
                              address: {
                                ...(prev.address as Record<string, unknown> ?? {}),
                                min: toOptionalNumber(event.target.value),
                              },
                            }
                            : prev))}
                        />
                      </label>
                      <label className="screen-editor-settings-field">
                        <span>Max</span>
                        <input
                          className="workbench-input"
                          type="number"
                          value={String(simAddress.max ?? "")}
                          onChange={(event) => setSimulationTagDraft((prev) => (prev
                            ? {
                              ...prev,
                              address: {
                                ...(prev.address as Record<string, unknown> ?? {}),
                                max: toOptionalNumber(event.target.value),
                              },
                            }
                            : prev))}
                        />
                      </label>
                      <label className="screen-editor-settings-field">
                        <span>Step</span>
                        <input
                          className="workbench-input"
                          type="number"
                          value={String(simAddress.step ?? "")}
                          onChange={(event) => setSimulationTagDraft((prev) => (prev
                            ? {
                              ...prev,
                              address: {
                                ...(prev.address as Record<string, unknown> ?? {}),
                                step: toOptionalNumber(event.target.value),
                              },
                            }
                            : prev))}
                        />
                      </label>
                      <label className="screen-editor-settings-field">
                        <span>Initial Value</span>
                        <input
                          className="workbench-input"
                          type="number"
                          value={String(simAddress.value ?? "")}
                          onChange={(event) => setSimulationTagDraft((prev) => (prev
                            ? {
                              ...prev,
                              address: {
                                ...(prev.address as Record<string, unknown> ?? {}),
                                value: toOptionalNumber(event.target.value),
                              },
                            }
                            : prev))}
                        />
                      </label>
                    </>
                  ) : null}
                </>
              ) : (
                <div className="screen-editor-drivers-note">No simulated tags found. Assign `sourceType = simulated` in Tags window.</div>
              )}
            </div>
            <div className="screen-editor-drivers-actions">
              <WorkbenchButton disabled={!simulationTagDraft} onClick={applySimulationTag}>Apply Tag Settings</WorkbenchButton>
              <WorkbenchButton variant="primary" disabled={!simulationTagDraft || busyAction !== ""} onClick={() => void saveSimulationTag()}>
                {busyAction === "save" ? "Saving..." : "Save Tag Settings"}
              </WorkbenchButton>
            </div>
          </WorkbenchSection>
        </div>
      ) : null}
    </div>
  );
}
