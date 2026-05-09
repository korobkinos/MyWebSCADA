import { useEffect, useMemo, useRef, useState } from "react";
import type { HmiObject, HmiScreen, MacroDefinition, MacroTrigger, ScadaProject, TagDefinition } from "@web-scada/shared";
import { LeftOutlined, RightOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Card, Divider, Form, Input, InputNumber, List, Modal, Select, Space, Switch, Tabs, Tag, Typography, message } from "antd";
import { macroApiDocumentation, macroExamples, type MacroApiDocItem } from "./macro-api-doc";
import { ResizableDockPanel } from "../../components/resizable-dock-panel";
import { useDockLayout } from "../../hooks/use-dock-layout";

type MacroLogLevel = "info" | "warn" | "error";

type MacroLogEntry = {
  ts: string;
  level: MacroLogLevel;
  message: string;
};

type Props = {
  project: ScadaProject;
  currentScreen?: HmiScreen;
  onProjectChange: (next: ScadaProject) => void;
  onRunMacro: (
    macroId: string,
    args?: Record<string, unknown>,
    options?: { allowDisabledForTest?: boolean },
  ) => Promise<{ ok: boolean; status?: "ok" | "skipped"; reason?: "disabled" }>;
  onSaveMacro?: (
    macroId: string,
    payload: {
      name: string;
      description?: string;
      enabled: boolean;
      language: "javascript-lite";
      code: string;
      triggers?: unknown[];
    },
  ) => Promise<MacroDefinition>;
};

type TriggerDraft = {
  type: "interval";
  intervalMs?: number;
};

type MacroReference = {
  macroId: string;
  macroName?: string;
  sourceType: "objectAction" | "screenTrigger" | "globalTrigger";
  screenKey?: string;
  screenName?: string;
  objectId?: string;
  objectName?: string;
  objectType?: string;
  path: string;
  details?: string;
};

const macroDockDefaults = [
  { id: "macros.list", side: "left", hidden: false, size: 360, lastVisibleSize: 360 },
  { id: "macros.help", side: "right", hidden: false, size: 360, lastVisibleSize: 360 },
  { id: "macros.logs", side: "bottom", hidden: false, size: 140, lastVisibleSize: 140 },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createMacroId(): string {
  return `macro_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultMacro(): MacroDefinition {
  return {
    id: createMacroId(),
    name: "New macro",
    description: "",
    language: "javascript-lite",
    code: "// readTag(\"Boiler.Pressure\");\n// writeTag(\"Burner_1.StartCmd\", true);",
    enabled: true,
    triggers: [],
  };
}

function buildTriggerFromDraft(draft: TriggerDraft): MacroTrigger | null {
  if (!draft.intervalMs || draft.intervalMs <= 0) {
    return null;
  }
  return { type: "interval", intervalMs: draft.intervalMs };
}

function inferObjectCandidates(screen?: HmiScreen): HmiObject[] {
  if (!screen) {
    return [];
  }
  return screen.objects;
}

function insertAtCursor(textArea: HTMLTextAreaElement, text: string): { value: string; cursor: number } {
  const start = textArea.selectionStart ?? 0;
  const end = textArea.selectionEnd ?? 0;
  const value = textArea.value;
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const cursor = start + text.length;
  return { value: next, cursor };
}

function uniqueCategories(items: MacroApiDocItem[]): string[] {
  return [...new Set(items.map((item) => item.category))];
}

function formatTrigger(trigger: MacroTrigger): string {
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
  if (trigger.type === "onCondition") {
    return `onCondition: ${trigger.condition}`;
  }
  return `interval: ${trigger.intervalMs} ms`;
}

function walkObjects(objects: HmiObject[], visitor: (obj: HmiObject) => void): void {
  for (const object of objects) {
    visitor(object);
    if (object.type === "group") {
      walkObjects(object.objects, visitor);
    }
  }
}

function findMacroReferences(project: ScadaProject, macroId: string): MacroReference[] {
  const macro = (project.macros ?? []).find((item) => item.id === macroId);
  const refs: MacroReference[] = [];
  const screens = project.screens ?? [];

  for (const screen of screens) {
    walkObjects(screen.objects, (object) => {
      if (
        (object.type === "button" || object.type === "image" || object.type === "stateImage") &&
        object.action?.type === "runMacro" &&
        object.action.macroId === macroId
      ) {
        refs.push({
          macroId,
          macroName: macro?.name,
          sourceType: "objectAction",
          screenKey: screen.id,
          screenName: screen.name,
          objectId: object.id,
          objectName: object.name,
          objectType: object.type,
          path: `screens.${screen.id}.objects.${object.id}.action`,
          details: "RuntimeAction.runMacro",
        });
      }
    });
  }

  return refs;
}

export function MacroWorkbench({ project, currentScreen, onProjectChange, onRunMacro, onSaveMacro }: Props) {
  const [selectedId, setSelectedId] = useState<string>(() => project.macros?.[0]?.id ?? "");
  const [logs, setLogs] = useState<MacroLogEntry[]>([]);
  const [helpCategory, setHelpCategory] = useState<string>("Quick Start");
  const [triggerDraft, setTriggerDraft] = useState<TriggerDraft>({ type: "interval", intervalMs: 1000 });
  const [newLwAddress, setNewLwAddress] = useState<number>(10);
  const [newLwValue, setNewLwValue] = useState<number>(0);
  const [newVarName, setNewVarName] = useState<string>("Var1");
  const [newVarType, setNewVarType] = useState<"BOOL" | "INT" | "DINT" | "REAL" | "STRING">("REAL");
  const [usageMacroId, setUsageMacroId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const codeRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const dockLayout = useDockLayout(macroDockDefaults.map((item) => ({ ...item })), { autoSaveMs: 900 });

  const macros = project.macros ?? [];
  const selectedMacro = macros.find((macro) => macro.id === selectedId) ?? null;

  const objectCandidates = useMemo(() => inferObjectCandidates(currentScreen), [currentScreen]);
  const popupScreens = useMemo(() => project.screens.filter((screen) => screen.kind === "popup"), [project.screens]);
  const normalScreens = useMemo(() => project.screens.filter((screen) => screen.kind === "screen"), [project.screens]);
  const categories = useMemo(() => ["Quick Start", ...uniqueCategories(macroApiDocumentation), "События запуска макросов", "Примеры макросов", "Ошибки и отладка"], []);
  const usageRows = useMemo(
    () => (usageMacroId ? findMacroReferences(project, usageMacroId) : []),
    [project, usageMacroId],
  );
  const listPanel = dockLayout.getPanelState("macros.list") ?? macroDockDefaults[0];
  const helpPanelState = dockLayout.getPanelState("macros.help") ?? macroDockDefaults[1];
  const logsPanel = dockLayout.getPanelState("macros.logs") ?? macroDockDefaults[2];
  const applyDockState = (panelId: string, next: { hidden: boolean; size: number; lastVisibleSize: number }) => {
    dockLayout.setPanelState(panelId, (prev) => ({
      ...prev,
      hidden: next.hidden,
      size: next.size,
      lastVisibleSize: next.lastVisibleSize,
    }));
  };

  // Warn about unsaved changes when closing tab / navigating away
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Modern browsers ignore custom message, but we need to set this for the dialog to appear
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const appendLog = (level: MacroLogLevel, text: string): void => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { ts, level, message: text }].slice(-300));
  };

  const mutateMacro = (patch: Partial<MacroDefinition>): void => {
    if (!selectedMacro) {
      return;
    }
    setDirty(true);
    setSaveError(null);
    onProjectChange({
      ...project,
      macros: macros.map((macro) => (macro.id === selectedMacro.id ? { ...macro, ...patch } : macro)),
    });
  };

  const insertCode = (snippet: string): void => {
    const editor = codeRef.current;
    if (!selectedMacro || !editor) {
      return;
    }
    const { value, cursor } = insertAtCursor(editor, snippet);
    mutateMacro({ code: value });
    requestAnimationFrame(() => {
      editor.focus();
      editor.selectionStart = cursor;
      editor.selectionEnd = cursor;
    });
  };

  const addMacro = (): void => {
    const created = defaultMacro();
    onProjectChange({
      ...project,
      macros: [...macros, created],
    });
    setSelectedId(created.id);
    appendLog("info", `Macro created: ${created.id}`);
  };

  const removeMacro = (macroId: string): void => {
    const refs = findMacroReferences(project, macroId);
    if (refs.length > 0) {
      setUsageMacroId(macroId);
      void message.warning("Macro is in use. Clear references before delete.");
      return;
    }
    const next = macros.filter((macro) => macro.id !== macroId);
    onProjectChange({
      ...project,
      macros: next,
    });
    if (selectedId === macroId) {
      setSelectedId(next[0]?.id ?? "");
    }
    appendLog("warn", `Macro removed: ${macroId}`);
  };

  const checkSyntax = (): void => {
    if (!selectedMacro) {
      return;
    }
    try {
      // eslint-disable-next-line no-new-func
      new Function("api", "args", selectedMacro.code);
      appendLog("info", "Check Syntax: OK");
      void message.success("Syntax OK");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      appendLog("error", `Check Syntax: ${text}`);
      void message.error(text);
    }
  };

  const runTest = async (): Promise<void> => {
    if (!selectedMacro) {
      return;
    }
    let allowDisabledForTest = false;
    if ((selectedMacro.enabled ?? true) === false) {
      allowDisabledForTest = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: "Macro is disabled",
          content: "Run test anyway?",
          okText: "Run test",
          cancelText: "Cancel",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!allowDisabledForTest) {
        appendLog("warn", "Run Test cancelled for disabled macro");
        return;
      }
    }
    const started = performance.now();
    appendLog("info", `Run Test -> ${selectedMacro.id}`);
    try {
      const result = await onRunMacro(selectedMacro.id, undefined, { allowDisabledForTest });
      const elapsed = Math.round(performance.now() - started);
      if (result.status === "skipped") {
        appendLog("warn", `Run Test skipped (${elapsed} ms): macro disabled`);
        void message.warning("Macro is disabled and was not executed");
        return;
      }
      appendLog("info", `Run Test OK (${elapsed} ms)`);
      void message.success("Macro executed");
    } catch (error) {
      const elapsed = Math.round(performance.now() - started);
      const text = error instanceof Error ? error.message : String(error);
      appendLog("error", `Run Test FAIL (${elapsed} ms): ${text}`);
      void message.error(text);
    }
  };

  const save = async (): Promise<void> => {
    if (!selectedMacro || !onSaveMacro) {
      if (!onSaveMacro) {
        appendLog("warn", "Save not available: onSaveMacro callback not provided");
        void message.warning("Save function is not available");
      }
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      console.debug("[Macro Save] Saving macro", { id: selectedMacro.id, name: selectedMacro.name, enabled: selectedMacro.enabled });

      const updated = await onSaveMacro(selectedMacro.id, {
        name: selectedMacro.name,
        description: selectedMacro.description,
        enabled: selectedMacro.enabled ?? true,
        language: selectedMacro.language,
        code: selectedMacro.code,
        triggers: selectedMacro.triggers,
      });

      console.debug("[Macro Save] Save successful", { id: updated.id, name: updated.name });

      // Update local project state with server response
      onProjectChange({
        ...project,
        macros: macros.map((m) => (m.id === updated.id ? updated : m)),
      });

      setDirty(false);
      appendLog("info", `Macro saved: ${updated.name} (enabled=${updated.enabled})`);
      void message.success("Macro saved successfully");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error("[Macro Save] Save failed", error);
      // Provide a more helpful message for auth errors
      const isAuthError = text.toLowerCase().includes("auth") || text.includes("401") || text.includes("403");
      const displayText = isAuthError
        ? "Engineer authentication required. Please log in as engineer first."
        : text;
      setSaveError(displayText);
      appendLog("error", `Save FAILED: ${displayText}`);
      void message.error(`Macro was not saved: ${displayText}`);
    } finally {
      setSaving(false);
    }
  };

  const addTrigger = (): void => {
    if (!selectedMacro) {
      return;
    }
    const built = buildTriggerFromDraft(triggerDraft);
    if (!built) {
      void message.warning("Fill trigger fields");
      return;
    }
    mutateMacro({ triggers: [...(selectedMacro.triggers ?? []), built] });
    appendLog("info", `Trigger added: ${formatTrigger(built)}`);
  };

  const removeTrigger = (index: number): void => {
    if (!selectedMacro) {
      return;
    }
    const next = [...(selectedMacro.triggers ?? [])];
    next.splice(index, 1);
    mutateMacro({ triggers: next });
  };

  const addLw = (): void => {
    const values = { ...(project.lwStore?.values ?? {}) };
    values[newLwAddress] = newLwValue;
    onProjectChange({
      ...project,
      lwStore: {
        ...(project.lwStore ?? {}),
        values,
      },
    });
    appendLog("info", `LW${newLwAddress} updated`);
  };

  const removeLw = (address: number): void => {
    const values = { ...(project.lwStore?.values ?? {}) };
    delete values[address];
    onProjectChange({
      ...project,
      lwStore: {
        ...(project.lwStore ?? {}),
        values,
      },
    });
  };

  const addNamedVar = (): void => {
    const name = newVarName.trim();
    if (!name) {
      return;
    }
    const exists = (project.variables ?? []).some((item) => item.name === name);
    if (exists) {
      void message.warning("Variable already exists");
      return;
    }
    const initial = newVarType === "BOOL" ? false : newVarType === "STRING" ? "" : 0;
    onProjectChange({
      ...project,
      variables: [
        ...(project.variables ?? []),
        {
          id: `var_${Math.random().toString(36).slice(2, 8)}`,
          name,
          dataType: newVarType,
          initialValue: initial,
          currentValue: initial,
          persistent: false,
          writable: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
  };

  const removeNamedVar = (name: string): void => {
    onProjectChange({
      ...project,
      variables: (project.variables ?? []).filter((item) => item.name !== name),
    });
  };

  const helpPanel = (
    <Card size="small" title="Help Panel" style={{ height: "100%", overflow: "auto", maxHeight: "100%" }}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select
          className="macro-help-section-select"
          value={helpCategory}
          onChange={setHelpCategory}
          options={categories.map((item) => ({
            label: <span title={item}>{item}</span>,
            value: item,
          }))}
          popupMatchSelectWidth={false}
          getPopupContainer={() => document.body}
          popupClassName="macro-help-section-select-dropdown"
          listHeight={320}
          dropdownStyle={{ maxHeight: 320, overflowY: "auto", zIndex: 4000 }}
        />

        {helpCategory === "Quick Start" ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text>1. Выберите/создайте макрос.</Typography.Text>
            <Typography.Text>2. Добавьте код и trigger `interval`.</Typography.Text>
            <Typography.Text>3. Нажмите Check Syntax, затем Run Test.</Typography.Text>
            <Typography.Text>4. Сохраните проект.</Typography.Text>
          </Space>
        ) : null}

        {helpCategory === "События запуска макросов" ? (
          <List
            size="small"
            dataSource={[
              "interval: периодический автозапуск (работает сейчас)",
              "onButtonClick: запускайте макрос действием RuntimeAction runMacro",
            ]}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
        ) : null}

        {helpCategory === "Примеры макросов" ? (
          <List
            size="small"
            dataSource={macroExamples}
            renderItem={(example) => (
              <List.Item
                actions={[
                  <Button size="small" onClick={() => insertCode(`\n${example.code}\n`)}>
                    Insert Example
                  </Button>,
                ]}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text strong>{example.title}</Typography.Text>
                  <Typography.Text type="secondary">{example.description}</Typography.Text>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{example.code}</pre>
                </Space>
              </List.Item>
            )}
          />
        ) : null}

        {helpCategory !== "Quick Start" && helpCategory !== "События запуска макросов" && helpCategory !== "Примеры макросов" ? (
          <List
            size="small"
            dataSource={macroApiDocumentation.filter((item) => item.category === helpCategory)}
            renderItem={(item) => (
              <List.Item actions={[<Button size="small" onClick={() => insertCode(`${item.name}()`)}>Insert</Button>]}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text strong>{item.signature}</Typography.Text>
                  <Typography.Text type="secondary">{item.description}</Typography.Text>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{item.example}</pre>
                </Space>
              </List.Item>
            )}
          />
        ) : null}
      </Space>
    </Card>
  );

  return (
    <>
    <div ref={workspaceRef} style={{ height: "100%", display: "flex", gap: 10, minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative" }}>
      <ResizableDockPanel
        id="macros.list"
        side="left"
        hidden={listPanel.hidden}
        size={clamp(listPanel.size, 0, 520)}
        lastVisibleSize={listPanel.lastVisibleSize}
        minSize={300}
        maxSize={520}
        autoHideThreshold={80}
        restoreSize={360}
        workspaceRef={workspaceRef}
        restoreTooltip="Show macro list"
        restoreIcon={<RightOutlined />}
        onStateChange={(state) => applyDockState("macros.list", state)}
      >
      <Card size="small" title="Macros" style={{ overflow: "auto", minHeight: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space>
            <Button size="small" onClick={addMacro}>Create</Button>
            <Button size="small" danger disabled={!selectedMacro} onClick={() => selectedMacro && removeMacro(selectedMacro.id)}>Delete</Button>
          </Space>
          <List
            size="small"
            dataSource={macros}
            renderItem={(macro) => (
              <List.Item
                onClick={() => {
                  if (dirty && macro.id !== selectedId) {
                    Modal.confirm({
                      title: "Unsaved changes",
                      content: "Save changes before switching macro?",
                      okText: "Save and switch",
                      cancelText: "Discard",
                      onOk: async () => {
                        await save();
                        setSelectedId(macro.id);
                      },
                      onCancel: () => {
                        setDirty(false);
                        setSaveError(null);
                        setSelectedId(macro.id);
                      },
                    });
                  } else {
                    setSelectedId(macro.id);
                  }
                }}
                className={selectedId === macro.id ? "scada-list-item-selected" : undefined}
                style={{ cursor: "pointer", alignItems: "flex-start" }}
              >
                <div style={{ width: "100%", minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <Typography.Text strong style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>
                      {macro.name}
                    </Typography.Text>
                    <Button
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        setUsageMacroId(macro.id);
                      }}
                    >
                      Usage
                    </Button>
                  </div>
                  <Space size={6} wrap style={{ marginTop: 6 }}>
                    <Tag color={macro.enabled ?? true ? "green" : "default"}>{macro.enabled ?? true ? "EN" : "DIS"}</Tag>
                    <Tag color="blue">{`Used by ${findMacroReferences(project, macro.id).length}`}</Tag>
                  </Space>
                </div>
              </List.Item>
            )}
          />
        </Space>
      </Card>
      </ResizableDockPanel>

      <div ref={centerRef} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0, overflow: "hidden", flex: "1 1 auto", position: "relative" }}>
        <Card size="small" title="Macro Editor" style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selectedMacro ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", minHeight: 0 }}>
              <Space wrap style={{ flex: "0 0 auto" }}>
                <Input style={{ width: 200 }} value={selectedMacro.name} onChange={(e) => mutateMacro({ name: e.target.value })} placeholder="Macro name" />
                <Tag color="blue">javascript-lite</Tag>
                <Switch checked={selectedMacro.enabled ?? true} onChange={(checked) => mutateMacro({ enabled: checked })} checkedChildren="Enabled" unCheckedChildren="Disabled" />
              </Space>

              <div style={{ flex: "1 1 auto", minHeight: 320, overflow: "auto" }}>
                <Input.TextArea
                  ref={(node) => {
                    codeRef.current = node?.resizableTextArea?.textArea ?? null;
                  }}
                  autoSize={false}
                  style={{ height: "100%", minHeight: 320, resize: "vertical", fontFamily: "Consolas, Menlo, Monaco, monospace" }}
                  value={selectedMacro.code}
                  onChange={(e) => mutateMacro({ code: e.target.value })}
                />
              </div>

              <Space wrap style={{ flex: "0 0 auto" }}>
                <Button onClick={checkSyntax}>Check Syntax</Button>
                <Button type="primary" onClick={() => void runTest()}>Run Test</Button>
                <Button type="default" onClick={() => void save()} disabled={!dirty || saving} loading={saving}>
                  {saving ? "Saving..." : dirty ? "Save *" : "Saved"}
                </Button>
                <Button onClick={() => mutateMacro({ enabled: !(selectedMacro.enabled ?? true) })}>{selectedMacro.enabled ?? true ? "Disable" : "Enable"}</Button>
              </Space>
              <Space wrap style={{ flex: "0 0 auto" }}>
                {dirty ? <Tag color="orange">Unsaved changes</Tag> : <Tag color="green">Saved</Tag>}
                {saveError ? <Typography.Text type="danger">Save error: {saveError}</Typography.Text> : null}
              </Space>
            </div>
          ) : (
            <Typography.Text type="secondary">Создайте макрос или выберите существующий.</Typography.Text>
          )}
        </Card>

        <Card size="small" title="Macro Triggers" style={{ flex: "0 0 auto", maxHeight: 200, overflow: "auto" }}>
          {selectedMacro ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Select
                  style={{ width: 180 }}
                  value={triggerDraft.type}
                  onChange={(value) => setTriggerDraft((prev) => ({ ...prev, type: value }))}
                  options={[
                    { label: "interval", value: "interval" },
                  ]}
                />
                <InputNumber
                  min={50}
                  style={{ width: 180 }}
                  value={triggerDraft.intervalMs}
                  placeholder="interval ms"
                  onChange={(value) => setTriggerDraft((prev) => ({ ...prev, intervalMs: Number(value ?? 0) }))}
                />

                <Button onClick={addTrigger}>Add Trigger</Button>
              </Space>

              <List
                size="small"
                dataSource={selectedMacro.triggers ?? []}
                renderItem={(trigger, index) => (
                  <List.Item actions={[<Button size="small" danger onClick={() => removeTrigger(index)}>Delete</Button>]}> {formatTrigger(trigger)} </List.Item>
                )}
              />
            </Space>
          ) : null}
        </Card>

        <ResizableDockPanel
          id="macros.logs"
          side="bottom"
          hidden={logsPanel.hidden}
          size={clamp(logsPanel.size, 0, 360)}
          lastVisibleSize={logsPanel.lastVisibleSize}
          minSize={90}
          maxSize={360}
          autoHideThreshold={50}
          restoreSize={180}
          workspaceRef={centerRef}
          restoreTooltip="Show logs"
          restoreIcon={<UpOutlined />}
          onStateChange={(state) => applyDockState("macros.logs", state)}
        >
          <Card size="small" title="Log Panel" style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <Space style={{ marginBottom: 8, flex: "0 0 auto" }}>
              <Button size="small" onClick={() => setLogs([])}>Clear Log</Button>
            </Space>
            <div style={{ flex: "1 1 auto", overflow: "auto", border: "1px solid #f0f0f0", padding: 8, minHeight: 0 }}>
              {logs.length === 0 ? <Typography.Text type="secondary">No logs yet</Typography.Text> : null}
              {logs.map((entry, index) => (
                <div key={`${entry.ts}_${index}`}>
                  <Typography.Text type={entry.level === "error" ? "danger" : entry.level === "warn" ? "warning" : undefined}>{`[${entry.ts}] [${entry.level}] ${entry.message}`}</Typography.Text>
                </div>
              ))}
            </div>
          </Card>
        </ResizableDockPanel>
      </div>

      <ResizableDockPanel
        id="macros.help"
        side="right"
        hidden={helpPanelState.hidden}
        size={clamp(helpPanelState.size, 0, 650)}
        lastVisibleSize={helpPanelState.lastVisibleSize}
        minSize={280}
        maxSize={650}
        autoHideThreshold={80}
        restoreSize={360}
        workspaceRef={workspaceRef}
        restoreTooltip="Show help panel"
        restoreIcon={<LeftOutlined />}
        onStateChange={(state) => applyDockState("macros.help", state)}
      >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0, overflow: "hidden", height: "100%" }}>
        <div style={{ flex: "0 0 auto", maxHeight: "40%", overflow: "auto" }}>
          {helpPanel}
        </div>

        <Card size="small" title="Insert Helpers" style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
          <Tabs
            size="small"
            items={[
              {
                key: "functions",
                label: "Functions",
                children: (
                  <List
                    size="small"
                    dataSource={macroApiDocumentation}
                    renderItem={(item) => (
                      <List.Item actions={[<Button size="small" onClick={() => insertCode(`${item.name}()`)}>Insert</Button>]}>
                        {item.name}
                      </List.Item>
                    )}
                  />
                ),
              },
              {
                key: "tags",
                label: "Tags",
                children: (
                  <List
                    size="small"
                    dataSource={project.tags}
                    renderItem={(tag: TagDefinition) => (
                      <List.Item
                        actions={[
                          <Button size="small" onClick={() => insertCode(`readTag(\"${tag.name}\")`)}>Read</Button>,
                          <Button size="small" onClick={() => insertCode(`writeTag(\"${tag.name}\", value)`)}>Write</Button>,
                        ]}
                      >
                        {tag.name}
                      </List.Item>
                    )}
                  />
                ),
              },
              {
                key: "variables",
                label: "LW/Vars",
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>LW variables</Typography.Text>
                    <Space>
                      <InputNumber value={newLwAddress} onChange={(value) => setNewLwAddress(Number(value ?? 0))} />
                      <InputNumber value={newLwValue} onChange={(value) => setNewLwValue(Number(value ?? 0))} />
                      <Button size="small" onClick={addLw}>Add/Update LW</Button>
                    </Space>
                    <Typography.Text strong>LW addresses</Typography.Text>
                    <List
                      size="small"
                      dataSource={Object.keys(project.lwStore?.values ?? {}).map((item) => Number(item)).sort((a, b) => a - b)}
                      renderItem={(address) => (
                        <List.Item actions={[<Button size="small" onClick={() => insertCode(`getLW(${address})`)}>get</Button>, <Button size="small" onClick={() => insertCode(`setLW(${address}, value)`)}>set</Button>, <Button size="small" danger onClick={() => removeLw(address)}>del</Button>]}>LW{address}</List.Item>
                      )}
                    />
                    <Divider style={{ margin: "8px 0" }} />
                    <Typography.Text strong>Named variables</Typography.Text>
                    <Space>
                      <Input value={newVarName} onChange={(e) => setNewVarName(e.target.value)} />
                      <Select
                        value={newVarType}
                        style={{ width: 120 }}
                        options={["BOOL", "INT", "DINT", "REAL", "STRING"].map((item) => ({ label: item, value: item }))}
                        onChange={(value) => setNewVarType(value)}
                      />
                      <Button size="small" onClick={addNamedVar}>Add Var</Button>
                    </Space>
                    <List
                      size="small"
                      dataSource={project.variables ?? []}
                      renderItem={(v) => (
                        <List.Item actions={[<Button size="small" onClick={() => insertCode(`getVar(\"${v.name}\")`)}>get</Button>, <Button size="small" onClick={() => insertCode(`setVar(\"${v.name}\", value)`)}>set</Button>, <Button size="small" danger onClick={() => removeNamedVar(v.name)}>del</Button>]}> {v.name} </List.Item>
                      )}
                    />
                  </Space>
                ),
              },
              {
                key: "screens",
                label: "Screens/Popups",
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>Screens</Typography.Text>
                    <List
                      size="small"
                      dataSource={normalScreens}
                      renderItem={(screen) => <List.Item actions={[<Button size="small" onClick={() => insertCode(`openScreen(\"${screen.id}\")`)}>Insert</Button>]}>{screen.name}</List.Item>}
                    />
                    <Divider style={{ margin: "8px 0" }} />
                    <Typography.Text strong>Popups</Typography.Text>
                    <List
                      size="small"
                      dataSource={popupScreens}
                      renderItem={(screen) => <List.Item actions={[<Button size="small" onClick={() => insertCode(`openPopup(\"${screen.id}\")`)}>Insert</Button>]}>{screen.name}</List.Item>}
                    />
                  </Space>
                ),
              },
              {
                key: "objects",
                label: "Objects",
                children: (
                  <List
                    size="small"
                    dataSource={objectCandidates}
                    renderItem={(obj) => (
                      <List.Item actions={[<Button size="small" onClick={() => insertCode(`\"${obj.id}\"`)}>Insert ID</Button>]}> {obj.id} ({obj.type}) </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />
          </div>
        </Card>
      </div>
      </ResizableDockPanel>
    </div>
    <Modal
      title="Macro Usage / References"
      open={Boolean(usageMacroId)}
      onCancel={() => setUsageMacroId(null)}
      footer={null}
      width={820}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          {(project.macros ?? []).find((item) => item.id === usageMacroId)?.name ?? usageMacroId}
        </Typography.Text>
        <List
          size="small"
          dataSource={usageRows}
          locale={{ emptyText: "No references found" }}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" style={{ width: "100%" }} size={0}>
                <Typography.Text strong>
                  {item.screenName ?? item.screenKey ?? "Global"} / {item.objectName ?? item.objectId ?? item.sourceType}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {item.objectType ? `${item.objectType} · ` : ""}{item.path}
                </Typography.Text>
                {item.details ? <Typography.Text type="secondary">{item.details}</Typography.Text> : null}
              </Space>
            </List.Item>
          )}
        />
      </Space>
    </Modal>
    </>
  );
}
