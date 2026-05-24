import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HmiObject, MacroDefinition, MacroRunResult, MacroTrigger } from "@web-scada/shared";
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  LeftOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { message, Modal, Select } from "antd";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import { WorkbenchButton, WorkbenchResizeHandle } from "../../../components/workbench";
import { WorkbenchWindow } from "../../../components/workbench/windows/workbench-window";
import { macroApiDocumentation, macroExamples } from "../../../hmi/editor/macro-api-doc";
import { useScadaStore } from "../../../store/scada-store";

type MacroWithExtras = MacroDefinition & {
  options?: Record<string, unknown>;
};

type MacroDraft = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  language: "javascript-lite";
  code: string;
  triggers?: unknown[];
  options?: Record<string, unknown>;
};

type TriggerType = MacroTrigger["type"];

type TriggerDraft = {
  type: TriggerType;
  intervalMs: string;
  screenKey: string;
  objectId: string;
  tag: string;
  condition: string;
};

type MacroConsoleEntry = {
  id: string;
  ts: string;
  level: "info" | "success" | "warn" | "error";
  text: string;
};

function formatTimestamp(date = new Date()): string {
  return date.toLocaleTimeString();
}

function toDraft(macro: MacroWithExtras): MacroDraft {
  const cloned = structuredClone(macro) as MacroWithExtras;
  return {
    id: cloned.id,
    name: cloned.name ?? "",
    description: cloned.description ?? "",
    enabled: cloned.enabled ?? true,
    language: "javascript-lite",
    code: cloned.code ?? "",
    triggers: (cloned.triggers as unknown[]) ?? [],
    options: cloned.options,
  };
}

function parseErrorText(error: unknown): string {
  if (error instanceof Error) {
    const details = (error as { details?: unknown }).details;
    if (details && typeof details === "object") {
      const errors = (details as { errors?: unknown }).errors;
      if (Array.isArray(errors)) {
        const detailText = errors
          .map((item) => String(item).trim())
          .filter(Boolean)
          .join("; ");
        if (detailText) {
          return `${error.message}: ${detailText}`;
        }
      }
    }
    return error.message;
  }
  return String(error);
}

function macroValidationErrors(macro: MacroDefinition | null | undefined): string[] {
  if (!macro || macro.validation?.status !== "error") {
    return [];
  }
  return (macro.validation.errors ?? []).filter((item) => item.trim().length > 0);
}

function createMacroId(prefix = "macro"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createUniqueMacroName(macros: MacroWithExtras[], baseName: string): string {
  const taken = new Set(macros.map((macro) => macro.name.trim().toLowerCase()));
  if (!taken.has(baseName.trim().toLowerCase())) {
    return baseName;
  }
  let index = 2;
  while (taken.has(`${baseName} ${index}`.trim().toLowerCase())) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

function walkObjects(objects: HmiObject[], visitor: (obj: HmiObject) => void): void {
  for (const object of objects) {
    visitor(object);
    if (object.type === "group") {
      walkObjects(object.objects, visitor);
    }
  }
}

function formatTrigger(trigger: MacroTrigger): string {
  if (trigger.type === "interval") {
    return `interval: ${trigger.intervalMs} ms`;
  }
  if (trigger.type === "onScreenOpen") {
    return `onScreenOpen: ${trigger.screenKey}`;
  }
  if (trigger.type === "onScreenClose") {
    return `onScreenClose: ${trigger.screenKey}`;
  }
  if (trigger.type === "onButtonClick") {
    return `onButtonClick: ${trigger.objectId}${trigger.screenKey ? ` (${trigger.screenKey})` : ""}`;
  }
  if (trigger.type === "onTagChange") {
    return `onTagChange: ${trigger.tag}`;
  }
  return `onCondition: ${trigger.condition}`;
}

export function ScreenEditorMacrosWindow() {
  const project = useScadaStore((s) => s.project);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const macros = useScadaStore((s) => s.macros);
  const loadMacros = useScadaStore((s) => s.loadMacros);
  const updateMacro = useScadaStore((s) => s.updateMacro);
  const runMacro = useScadaStore((s) => s.runMacro);
  const saveProject = useScadaStore((s) => s.saveProject);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);

  const [search, setSearch] = useState("");
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);
  const [draftMacro, setDraftMacro] = useState<MacroDraft | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [triggerDraft, setTriggerDraft] = useState<TriggerDraft>({
    type: "interval",
    intervalMs: "1000",
    screenKey: "",
    objectId: "",
    tag: "",
    condition: "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<MacroRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastSaveAt, setLastSaveAt] = useState<string | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<MacroConsoleEntry[]>([]);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [helpWindowRect, setHelpWindowRect] = useState({ x: 320, y: 72, width: 860, height: 680 });
  const [helpWindowZIndex, setHelpWindowZIndex] = useState<number>(1200);
  const listPanelRef = useRef<ImperativePanelHandle | null>(null);
  const consolePanelRef = useRef<ImperativePanelHandle | null>(null);

  const macroSource = useMemo(
    () => ((project?.macros as MacroWithExtras[] | undefined) ?? (macros as MacroWithExtras[])),
    [macros, project?.macros],
  );

  const filteredMacros = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return macroSource;
    }
    return macroSource.filter((macro) => {
      const name = macro.name?.toLowerCase() ?? "";
      const description = macro.description?.toLowerCase() ?? "";
      const id = macro.id?.toLowerCase() ?? "";
      const language = macro.language?.toLowerCase() ?? "";
      return name.includes(query) || description.includes(query) || id.includes(query) || language.includes(query);
    });
  }, [macroSource, search]);

  const appendConsole = useCallback((level: MacroConsoleEntry["level"], text: string) => {
    setConsoleEntries((prev) => [
      ...prev.slice(-99),
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ts: formatTimestamp(),
        level,
        text,
      },
    ]);
  }, []);

  const selectMacro = useCallback((macro: MacroWithExtras) => {
    const nextDraft = toDraft(macro);
    setSelectedMacroId(macro.id);
    setDraftMacro(nextDraft);
    setDirty(false);
    setRunResult(null);
    setRunError(null);
  }, []);

  const refreshMacros = useCallback(async (silent = false) => {
    try {
      await loadMacros();
      appendConsole("info", "Macros list refreshed");
      if (!silent) {
        void message.success("Macros refreshed");
      }
    } catch (error) {
      const text = parseErrorText(error);
      appendConsole("error", `Refresh failed: ${text}`);
      if (!silent) {
        void message.error(text || "Failed to refresh macros");
      }
    }
  }, [appendConsole, loadMacros]);

  useEffect(() => {
    if (macroSource.length === 0) {
      setSelectedMacroId(null);
      setDraftMacro(null);
      setDirty(false);
      return;
    }
    const firstMacro = macroSource[0];
    if (!firstMacro) {
      return;
    }
    if (!selectedMacroId) {
      selectMacro(firstMacro);
      return;
    }
    const selected = macroSource.find((macro) => macro.id === selectedMacroId);
    if (!selected) {
      selectMacro(firstMacro);
    }
  }, [macroSource, selectMacro, selectedMacroId]);

  const selectedMacro = useMemo(
    () => macroSource.find((macro) => macro.id === selectedMacroId) ?? null,
    [macroSource, selectedMacroId],
  );
  const selectedMacroErrors = useMemo(() => macroValidationErrors(selectedMacro), [selectedMacro]);
  const selectedMacroInvalid = selectedMacroErrors.length > 0;
  const screenOptions = useMemo(
    () => (project?.screens ?? []).map((screen) => ({ label: `${screen.name} (${screen.id})`, value: screen.id })),
    [project?.screens],
  );
  const buttonOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = [];
    for (const screen of project?.screens ?? []) {
      walkObjects(screen.objects, (obj) => {
        if (obj.type === "button" || obj.type === "image" || obj.type === "stateImage") {
          options.push({
            label: `${screen.name}: ${obj.name?.trim() || obj.id} (${obj.id})`,
            value: obj.id,
          });
        }
      });
    }
    return options;
  }, [project?.screens]);

  const updateDraft = useCallback((patch: Partial<MacroDraft>) => {
    setDraftMacro((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const addTrigger = useCallback(() => {
    if (!draftMacro) {
      return;
    }
    let trigger: MacroTrigger | null = null;
    if (triggerDraft.type === "interval") {
      const intervalMs = Number(triggerDraft.intervalMs);
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        void message.error("Interval must be > 0");
        return;
      }
      trigger = { type: "interval", intervalMs };
    }
    if (triggerDraft.type === "onScreenOpen") {
      if (!triggerDraft.screenKey.trim()) {
        void message.error("Screen is required");
        return;
      }
      trigger = { type: "onScreenOpen", screenKey: triggerDraft.screenKey.trim() };
    }
    if (triggerDraft.type === "onScreenClose") {
      if (!triggerDraft.screenKey.trim()) {
        void message.error("Screen is required");
        return;
      }
      trigger = { type: "onScreenClose", screenKey: triggerDraft.screenKey.trim() };
    }
    if (triggerDraft.type === "onButtonClick") {
      if (!triggerDraft.objectId.trim()) {
        void message.error("Object id is required");
        return;
      }
      trigger = {
        type: "onButtonClick",
        objectId: triggerDraft.objectId.trim(),
        screenKey: triggerDraft.screenKey.trim() || undefined,
      };
    }
    if (triggerDraft.type === "onTagChange") {
      if (!triggerDraft.tag.trim()) {
        void message.error("Tag name is required");
        return;
      }
      trigger = { type: "onTagChange", tag: triggerDraft.tag.trim() };
    }
    if (triggerDraft.type === "onCondition") {
      if (!triggerDraft.condition.trim()) {
        void message.error("Condition is required");
        return;
      }
      trigger = { type: "onCondition", condition: triggerDraft.condition.trim() };
    }
    if (!trigger) {
      return;
    }
    updateDraft({ triggers: [...((draftMacro.triggers as MacroTrigger[] | undefined) ?? []), trigger] });
  }, [draftMacro, triggerDraft, updateDraft]);

  const removeTrigger = useCallback((index: number) => {
    if (!draftMacro) {
      return;
    }
    const next = [...((draftMacro.triggers as MacroTrigger[] | undefined) ?? [])];
    next.splice(index, 1);
    updateDraft({ triggers: next });
  }, [draftMacro, updateDraft]);

  const hideListPanel = useCallback(() => {
    listPanelRef.current?.collapse();
  }, []);

  const showListPanel = useCallback(() => {
    listPanelRef.current?.expand();
  }, []);

  const hideConsolePanel = useCallback(() => {
    consolePanelRef.current?.collapse();
  }, []);

  const showConsolePanel = useCallback(() => {
    consolePanelRef.current?.expand();
  }, []);

  const onSaveMacro = useCallback(async () => {
    if (!project || !selectedMacro || !draftMacro) {
      return;
    }

    const name = draftMacro.name.trim();
    if (!name) {
      void message.error("Macro name is required");
      appendConsole("error", "Save failed: macro name is empty");
      return;
    }

    setSaving(true);
    appendConsole("info", `Saving macro ${selectedMacro.id}...`);

    try {
      const payload = {
        name,
        description: draftMacro.description || undefined,
        enabled: draftMacro.enabled,
        language: "javascript-lite" as const,
        code: draftMacro.code,
        triggers: draftMacro.triggers,
        options: draftMacro.options,
      };
      const existsInBackendList = macros.some((macro) => macro.id === selectedMacro.id);
      if (!existsInBackendList) {
        const localUpdated: MacroWithExtras = {
          id: selectedMacro.id,
          name,
          description: draftMacro.description || undefined,
          enabled: draftMacro.enabled,
          language: "javascript-lite",
          code: draftMacro.code,
          triggers: (draftMacro.triggers as MacroTrigger[] | undefined) ?? [],
          options: draftMacro.options,
        };
        const nextMacros = macroSource.map((macro) => (macro.id === selectedMacro.id ? localUpdated : macro));
        updateProjectJson({
          ...project,
          macros: nextMacros,
        });
        selectMacro(localUpdated);
        setDirty(false);
        const ts = formatTimestamp();
        setLastSaveAt(ts);
        appendConsole("success", `Macro saved locally: ${localUpdated.name}`);
        void message.success("Macro saved locally. Click Save Project to persist");
        return;
      }
      const updated = await updateMacro(selectedMacro.id, payload);
      await loadMacros();

      const updatedMacro = {
        ...(updated as MacroWithExtras),
        options: (updated as MacroWithExtras).options ?? draftMacro.options,
      };
      selectMacro(updatedMacro);
      setDirty(false);
      const ts = formatTimestamp();
      setLastSaveAt(ts);
      appendConsole("success", `Macro saved: ${updated.name}`);
      if ((updated as MacroDefinition).validation?.status === "error") {
        const details = macroValidationErrors(updated as MacroDefinition).join("; ");
        appendConsole("warn", `Validation error: ${details || "Macro is invalid"}`);
        void message.warning(`Macro saved with validation errors: ${details || "Unknown error"}`);
      }
      void message.success("Macro saved");
    } catch (error) {
      const text = parseErrorText(error);
      appendConsole("error", `Save failed: ${text}`);
      void message.error(text || "Failed to save macro");
    } finally {
      setSaving(false);
    }
  }, [appendConsole, draftMacro, loadMacros, macroSource, macros, project, selectMacro, selectedMacro, updateMacro, updateProjectJson]);

  const onRunMacro = useCallback(async () => {
    if (!selectedMacro) {
      return;
    }
    if (selectedMacroInvalid) {
      const text = selectedMacroErrors.join("; ") || "Macro is invalid";
      setRunError(text);
      appendConsole("warn", `Run skipped: ${text}`);
      void message.warning(`Macro is invalid: ${text}`);
      return;
    }
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    const started = performance.now();
    appendConsole("info", `Run test: ${selectedMacro.id}`);

    try {
      const result = await runMacro(
        selectedMacro.id,
        {},
        {
          allowDisabledForTest: true,
          context: { source: "workbench-editor", screenId: currentScreenId ?? undefined },
        },
      );
      setRunResult(result);
      const elapsed = Math.round(performance.now() - started);
      if (result.status === "skipped") {
        appendConsole("warn", `Run skipped (${elapsed} ms): ${result.reason ?? "unknown"}`);
        void message.warning(`Macro skipped (${result.reason ?? "unknown"})`);
      } else {
        appendConsole("success", `Run completed (${elapsed} ms)`);
        void message.success("Macro executed");
      }
    } catch (error) {
      const text = parseErrorText(error);
      setRunError(text);
      appendConsole("error", `Run failed: ${text}`);
      void message.error(text || "Macro run failed");
    } finally {
      setRunning(false);
    }
  }, [appendConsole, currentScreenId, runMacro, selectedMacro, selectedMacroErrors, selectedMacroInvalid]);

  const onAddMacro = useCallback(() => {
    if (!project) {
      return;
    }
    const existingIds = new Set(macroSource.map((macro) => macro.id));
    let id = createMacroId();
    while (existingIds.has(id)) {
      id = createMacroId();
    }
    const name = createUniqueMacroName(macroSource, "New macro");
    const created: MacroWithExtras = {
      id,
      name,
      description: "",
      enabled: true,
      language: "javascript-lite",
      code: "// New macro\n",
      triggers: [],
    };
    const nextMacros = [...macroSource, created];
    updateProjectJson({
      ...project,
      macros: nextMacros,
    });
    setSelectedMacroId(created.id);
    setDraftMacro(toDraft(created));
    setDirty(true);
    setRunResult(null);
    setRunError(null);
    appendConsole("success", `Macro created: ${created.name} (${created.id})`);
    void message.success("Macro created");
  }, [appendConsole, macroSource, project, updateProjectJson]);

  const onDuplicateMacro = useCallback(() => {
    if (!project || !selectedMacro) {
      return;
    }
    const existingIds = new Set(macroSource.map((macro) => macro.id));
    let id = createMacroId();
    while (existingIds.has(id)) {
      id = createMacroId();
    }
    const baseName = `${selectedMacro.name || "Macro"} Copy`;
    const duplicate = structuredClone(selectedMacro) as MacroWithExtras;
    duplicate.id = id;
    duplicate.name = createUniqueMacroName(macroSource, baseName);
    const nextMacros = [...macroSource, duplicate];
    updateProjectJson({
      ...project,
      macros: nextMacros,
    });
    setSelectedMacroId(duplicate.id);
    setDraftMacro(toDraft(duplicate));
    setDirty(true);
    setRunResult(null);
    setRunError(null);
    appendConsole("success", `Macro duplicated: ${duplicate.name} (${duplicate.id})`);
    void message.success("Macro duplicated");
  }, [appendConsole, macroSource, project, selectedMacro, updateProjectJson]);

  const confirmDeleteMacro = useCallback(() => {
    if (!project || !selectedMacroId) {
      return;
    }
    const deleteIndex = macroSource.findIndex((macro) => macro.id === selectedMacroId);
    if (deleteIndex < 0) {
      void message.error("Selected macro not found");
      return;
    }
    const deleted = macroSource[deleteIndex];
    if (!deleted) {
      return;
    }
    const nextMacros = macroSource.filter((macro) => macro.id !== selectedMacroId);
    updateProjectJson({
      ...project,
      macros: nextMacros,
    });
    const nextSelected = nextMacros[deleteIndex] ?? nextMacros[deleteIndex - 1] ?? null;
    if (nextSelected) {
      setSelectedMacroId(nextSelected.id);
      setDraftMacro(toDraft(nextSelected));
    } else {
      setSelectedMacroId(null);
      setDraftMacro(null);
    }
    setDirty(true);
    setRunResult(null);
    setRunError(null);
    appendConsole("warn", `Macro deleted: ${deleted.name} (${deleted.id})`);
    void message.success("Macro deleted");
  }, [appendConsole, macroSource, project, selectedMacroId, updateProjectJson]);

  const onDeleteMacro = useCallback(() => {
    if (!selectedMacroId) {
      return;
    }
    setDeleteConfirmOpen(true);
  }, [selectedMacroId]);

  const openHelpWindow = useCallback(() => {
    setHelpOpen(true);
    setHelpWindowZIndex((prev) => prev + 1);
  }, []);

  if (!project) {
    return (
      <div className="screen-editor-window-content screen-editor-macros-window">
        <div className="screen-editor-empty-state">Project is not loaded</div>
      </div>
    );
  }

  return (
    <div className="screen-editor-window-content screen-editor-macros-window">
      <div className="screen-editor-macros-window__toolbar">
        <input
          className="workbench-input"
          value={search}
          placeholder="Search macros"
          onChange={(event) => setSearch(event.target.value)}
        />
        <WorkbenchButton icon={<PlusOutlined />} title="Add Macro" onClick={onAddMacro} />
        <WorkbenchButton
          icon={<CopyOutlined />}
          title="Duplicate Macro"
          onClick={onDuplicateMacro}
          disabled={!selectedMacro}
        />
        <WorkbenchButton
          icon={<DeleteOutlined />}
          title="Delete Macro"
          onClick={onDeleteMacro}
          disabled={!selectedMacroId}
        />
        <WorkbenchButton
          variant="primary"
          icon={<SaveOutlined />}
          title={saving ? "Saving..." : "Save Macro"}
          onClick={() => void onSaveMacro()}
          disabled={!draftMacro || saving}
        />
        <WorkbenchButton
          icon={<PlayCircleOutlined />}
          title={running ? "Running..." : "Run/Test Macro"}
          onClick={() => void onRunMacro()}
          disabled={!selectedMacro || running || selectedMacroInvalid}
        />
        <WorkbenchButton
          icon={listCollapsed ? <UnorderedListOutlined /> : <LeftOutlined />}
          title={listCollapsed ? "Show macros list" : "Hide macros list"}
          onClick={() => (listCollapsed ? showListPanel() : hideListPanel())}
        />
        <WorkbenchButton
          icon={consoleCollapsed ? <UpOutlined /> : <DownOutlined />}
          title={consoleCollapsed ? "Show log" : "Hide log"}
          onClick={() => (consoleCollapsed ? showConsolePanel() : hideConsolePanel())}
        />
        <WorkbenchButton icon={<ReloadOutlined />} title="Refresh macros" onClick={() => void refreshMacros()} />
        <WorkbenchButton icon={<SaveOutlined />} title="Save Project" onClick={() => void saveProject()} />
        <WorkbenchButton icon={<QuestionCircleOutlined />} title="Macro help" onClick={openHelpWindow} />
        <WorkbenchButton icon={<SettingOutlined />} title="Macro options are preserved automatically" disabled />
      </div>

      <PanelGroup direction="vertical" autoSaveId="screen-editor-macros-window:v" className="screen-editor-macros-layout">
        <Panel id="macros-main" order={1} defaultSize={82} minSize={35}>
          <PanelGroup direction="horizontal" autoSaveId="screen-editor-macros-window:h" className="screen-editor-macros-window__body">
            <Panel
              ref={listPanelRef}
              id="macros-list"
              order={1}
              defaultSize={24}
              minSize={16}
              maxSize={45}
              collapsible
              collapsedSize={0}
              onCollapse={() => setListCollapsed(true)}
              onExpand={() => setListCollapsed(false)}
            >
              <div className="screen-editor-macros-window__list">
                {filteredMacros.map((macro) => {
                  const selected = macro.id === selectedMacroId;
                  const enabled = macro.enabled ?? true;
                  const errors = macroValidationErrors(macro);
                  const invalid = errors.length > 0;
                  return (
                    <div
                      key={macro.id}
                      className={[
                        "screen-editor-macro-row",
                        selected ? "screen-editor-macro-row--selected" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => selectMacro(macro)}
                    >
                      <div className="screen-editor-macro-row__name" title={macro.name}>{macro.name}</div>
                      <div className="screen-editor-macro-row__meta">
                        <span className={[
                          "screen-editor-macro-badge",
                          enabled ? "screen-editor-macro-badge--enabled" : "screen-editor-macro-badge--disabled",
                        ].join(" ")}
                        >
                          {enabled ? "enabled" : "disabled"}
                        </span>
                        {invalid ? (
                          <span
                            className="screen-editor-macro-badge"
                            style={{ background: "rgba(255,77,79,0.2)", borderColor: "#ff4d4f", color: "#ffccc7" }}
                            title={errors.join("\n")}
                          >
                            ERROR
                          </span>
                        ) : null}
                        {" "}
                        <span>{macro.language ?? "javascript-lite"}</span>
                      </div>
                    </div>
                  );
                })}
                {filteredMacros.length === 0 ? <div className="screen-editor-empty-state">No macros</div> : null}
              </div>
            </Panel>

            <WorkbenchResizeHandle orientation="vertical" className="screen-editor-macros-panel-handle" />

            <Panel id="macros-editor" order={2} minSize={55}>
              <div className="screen-editor-macros-window__editor">
                {!draftMacro ? (
                  <div className="screen-editor-empty-state">Select macro</div>
                ) : (
                  <div className="screen-editor-tag-editor">
                    <label className="workbench-field">
                      <span className="workbench-field__label">Name</span>
                      <input className="workbench-input" value={draftMacro.name} onChange={(event) => updateDraft({ name: event.target.value })} />
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Description</span>
                      <textarea
                        className="workbench-input screen-editor-macro-textarea"
                        value={draftMacro.description}
                        onChange={(event) => updateDraft({ description: event.target.value })}
                      />
                    </label>
                    <label className="screen-editor-tags-checkbox-field">
                      <input type="checkbox" checked={draftMacro.enabled} onChange={(event) => updateDraft({ enabled: event.target.checked })} />
                      <span>Enabled</span>
                    </label>
                    {selectedMacroErrors.length > 0 ? (
                      <div className="screen-editor-drivers-warning" style={{ margin: 0 }}>
                        {selectedMacroErrors.map((item, index) => (
                          <div key={`${item}_${index}`}>{item}</div>
                        ))}
                      </div>
                    ) : null}
                    <label className="workbench-field">
                      <span className="workbench-field__label">Code</span>
                      <textarea
                        className="screen-editor-macro-code"
                        value={draftMacro.code}
                        onChange={(event) => updateDraft({ code: event.target.value })}
                      />
                    </label>
                    <div className="screen-editor-macro-help">
                      API: <code>readTag</code>, <code>writeTag</code>, <code>pulseTag</code>, <code>toggleTag</code>, <code>getVar</code>, <code>setVar</code>, <code>openScreen</code>, <code>openPopup</code>, <code>closePopup</code>.
                    </div>
                    <div className="screen-editor-macro-triggers">
                      <div className="screen-editor-macro-triggers__title">Triggers</div>
                      <div className="screen-editor-macro-triggers__builder">
                        <div className="screen-editor-macro-triggers__builder-row">
                          <Select
                            size="small"
                            className="screen-editor-macro-triggers__type"
                            value={triggerDraft.type}
                            options={[
                              { value: "interval", label: "interval" },
                              { value: "onScreenOpen", label: "onScreenOpen" },
                              { value: "onScreenClose", label: "onScreenClose" },
                              { value: "onButtonClick", label: "onButtonClick" },
                              { value: "onTagChange", label: "onTagChange" },
                              { value: "onCondition", label: "onCondition" },
                            ]}
                            onChange={(value) => setTriggerDraft((prev) => ({ ...prev, type: value as TriggerType }))}
                          />
                        </div>
                        <div className="screen-editor-macro-triggers__builder-row">
                          {triggerDraft.type === "interval" ? (
                            <input
                              className="workbench-input screen-editor-macro-triggers__input"
                              type="number"
                              min={1}
                              placeholder="Interval ms"
                              value={triggerDraft.intervalMs}
                              onChange={(event) => setTriggerDraft((prev) => ({ ...prev, intervalMs: event.target.value }))}
                            />
                          ) : null}
                          {triggerDraft.type === "onScreenOpen" || triggerDraft.type === "onScreenClose" || triggerDraft.type === "onButtonClick" ? (
                            <Select
                              size="small"
                              showSearch
                              allowClear
                              className="screen-editor-macro-triggers__select"
                              placeholder="Screen"
                              value={triggerDraft.screenKey || undefined}
                              options={screenOptions}
                              onChange={(value) => setTriggerDraft((prev) => ({ ...prev, screenKey: value ?? "" }))}
                            />
                          ) : null}
                          {triggerDraft.type === "onButtonClick" ? (
                            <Select
                              size="small"
                              showSearch
                              className="screen-editor-macro-triggers__select"
                              placeholder="Object id"
                              value={triggerDraft.objectId || undefined}
                              options={buttonOptions}
                              onChange={(value) => setTriggerDraft((prev) => ({ ...prev, objectId: String(value ?? "") }))}
                            />
                          ) : null}
                          {triggerDraft.type === "onTagChange" ? (
                            <input
                              className="workbench-input screen-editor-macro-triggers__input"
                              placeholder="Tag name"
                              value={triggerDraft.tag}
                              onChange={(event) => setTriggerDraft((prev) => ({ ...prev, tag: event.target.value }))}
                            />
                          ) : null}
                          {triggerDraft.type === "onCondition" ? (
                            <input
                              className="workbench-input screen-editor-macro-triggers__input"
                              placeholder="Condition expression"
                              value={triggerDraft.condition}
                              onChange={(event) => setTriggerDraft((prev) => ({ ...prev, condition: event.target.value }))}
                            />
                          ) : null}
                          <WorkbenchButton
                            className="screen-editor-macro-triggers__add-btn"
                            icon={<PlusOutlined />}
                            title="Add trigger"
                            onClick={addTrigger}
                          />
                        </div>
                      </div>
                      <div className="screen-editor-macro-triggers__list">
                        {((draftMacro.triggers as MacroTrigger[] | undefined) ?? []).map((trigger, index) => (
                          <div key={`${trigger.type}_${index}`} className="screen-editor-macro-triggers__row">
                            <span>{formatTrigger(trigger)}</span>
                            <WorkbenchButton
                              icon={<DeleteOutlined />}
                              title="Delete trigger"
                              onClick={() => removeTrigger(index)}
                            />
                          </div>
                        ))}
                        {((draftMacro.triggers as MacroTrigger[] | undefined) ?? []).length === 0 ? (
                          <div className="screen-editor-empty-state">No triggers</div>
                        ) : null}
                      </div>
                      {draftMacro.options ? (
                        <div className="screen-editor-macro-help">Macro options are preserved automatically on save.</div>
                      ) : null}
                    </div>
                    <div className="screen-editor-macros-window__status">
                      <span>{dirty ? "Unsaved changes" : "Saved"}</span>
                      {lastSaveAt ? <span>Last save: {lastSaveAt}</span> : null}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <WorkbenchResizeHandle orientation="horizontal" className="screen-editor-macros-panel-handle" />

        <Panel
          ref={consolePanelRef}
          id="macros-console"
          order={2}
          defaultSize={18}
          minSize={10}
          maxSize={45}
          collapsible
          collapsedSize={0}
          onCollapse={() => setConsoleCollapsed(true)}
          onExpand={() => setConsoleCollapsed(false)}
        >
          <div className="screen-editor-macros-window__console-panel">
            <div className="screen-editor-macros-window__console-header">
              <span>Console</span>
              <div className="screen-editor-macros-window__console-actions">
                <WorkbenchButton icon={<DeleteOutlined />} title="Clear log" onClick={() => setConsoleEntries([])} />
              </div>
            </div>
            <div className="screen-editor-macros-window__console">
              {runResult ? <div>[{formatTimestamp()}] run-result: {JSON.stringify(runResult)}</div> : null}
              {runError ? <div>[{formatTimestamp()}] run-error: {runError}</div> : null}
              {consoleEntries.length === 0 ? <div>No logs yet</div> : null}
              {consoleEntries.map((entry) => (
                <div key={entry.id}>[{entry.ts}] [{entry.level}] {entry.text}</div>
              ))}
            </div>
          </div>
        </Panel>
      </PanelGroup>

      <Modal
        title="Delete macro?"
        open={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <WorkbenchButton onClick={() => setDeleteConfirmOpen(false)}>Cancel</WorkbenchButton>
            <WorkbenchButton
              variant="danger"
              onClick={() => {
                confirmDeleteMacro();
                setDeleteConfirmOpen(false);
              }}
            >
              Delete
            </WorkbenchButton>
          </div>
        }
      >
        <div>
          Delete &quot;{selectedMacro?.name ?? "selected macro"}&quot;?
        </div>
      </Modal>

      {helpOpen && typeof document !== "undefined"
        ? createPortal(
          <div className="screen-editor-macro-help-window-layer" onMouseDown={(event) => event.stopPropagation()}>
            <WorkbenchWindow
              id="screenEditorMacroHelp"
              title="Macro Help & Syntax"
              rect={helpWindowRect}
              zIndex={helpWindowZIndex}
              minWidth={560}
              minHeight={360}
              onClose={() => setHelpOpen(false)}
              onFocus={() => setHelpWindowZIndex((prev) => prev + 1)}
              onMove={(x, y) => setHelpWindowRect((prev) => ({ ...prev, x: Math.max(0, x), y: Math.max(0, y) }))}
              onResize={(nextRect) => setHelpWindowRect(nextRect)}
            >
              <div className="screen-editor-macro-help-modal">
                <div className="screen-editor-macro-help-modal__block">
                  <div className="screen-editor-macro-help-modal__title">Quick Syntax</div>
                  <pre>{`const value = Number(readTag("Tag.Name") ?? 0);
if (value > 10) {
  await writeTag("Tag.Alarm", true);
}`}</pre>
                </div>
                <div className="screen-editor-macro-help-modal__block">
                  <div className="screen-editor-macro-help-modal__title">API Functions</div>
                  <div className="screen-editor-macro-help-modal__api-list">
                    {macroApiDocumentation.map((item) => (
                      <div key={item.name} className="screen-editor-macro-help-modal__api-item">
                        <div className="screen-editor-macro-help-modal__api-meta">
                          <span>{item.category}</span>
                        </div>
                        <code>{item.signature}</code>
                        <div className="screen-editor-macro-help-modal__api-desc">{item.description}</div>
                        <pre>{item.example}</pre>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="screen-editor-macro-help-modal__block">
                  <div className="screen-editor-macro-help-modal__title">Examples</div>
                  {macroExamples.slice(0, 3).map((example) => (
                    <div key={example.id} className="screen-editor-macro-help-modal__example">
                      <strong>{example.title}</strong>
                      <pre>{example.code}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </WorkbenchWindow>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
