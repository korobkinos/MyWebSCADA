import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { HmiObject, MacroDefinition, MacroRunResult, MacroTrigger } from "@web-scada/shared";
import {
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  LeftOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  UnorderedListOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { message, Modal, Select, Tabs } from "antd";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import { WorkbenchButton, WorkbenchResizeHandle } from "../../../components/workbench";
import { WorkbenchWindow } from "../../../components/workbench/windows/workbench-window";
import { MacroCodeEditor, type MacroCodeEditorHandle, buildApiSnippet } from "../../../hmi/editor/macro-code-editor";
import { macroApiDocumentation, macroExamples, macroTemplates } from "../../../hmi/editor/macro-api-doc";
import { showProjectCleanupHint } from "../../../services/cleanup-hint";
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

type HelpTabKey = "quickStart" | "api" | "templates" | "tagsObjects" | "examples";

type HelpObjectCandidate = {
  key: string;
  insertId: string;
  path: string;
  type: string;
  context?: string;
  screenId: string;
  screenName: string;
  source: "screen" | "libraryInstance";
};

type MacroHelpColumnId = "type" | "idTag" | "pathContext" | "source" | "actions";
type MacroHelpColumnConfig = {
  id: MacroHelpColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
};

type MacroHelpRow = {
  key: string;
  type: string;
  idTag: string;
  pathContext: string;
  source: string;
  sourceKey: "projectTags" | "screen" | "libraryInstance";
  objectType: string;
  search: string;
  rowType: "tag" | "object";
};

type TagsObjectsScopeFilter = "all" | "tags" | "screenObjects" | "libraryObjects";
type TagsObjectsSourceFilter = "all" | "projectTags" | "screen" | "libraryInstance";

const MACRO_HELP_COLUMNS: MacroHelpColumnConfig[] = [
  { id: "type", title: "TYPE", defaultWidth: 100, minWidth: 80 },
  { id: "idTag", title: "ID / TAG", defaultWidth: 230, minWidth: 140 },
  { id: "pathContext", title: "PATH / CONTEXT", defaultWidth: 420, minWidth: 220 },
  { id: "source", title: "SOURCE", defaultWidth: 160, minWidth: 110 },
  { id: "actions", title: "ACTIONS", defaultWidth: 150, minWidth: 120 },
];

const MACRO_HELP_COLUMNS_WIDTH_STORAGE_KEY = "screenEditor.macros.helpColumnsWidth";
const MACRO_HELP_PAGE_SIZE_STORAGE_KEY = "screenEditor.macros.helpPageSize";

function createDefaultMacroHelpColumnWidths(): Record<MacroHelpColumnId, number> {
  return MACRO_HELP_COLUMNS.reduce<Record<MacroHelpColumnId, number>>(
    (acc, column) => ({ ...acc, [column.id]: column.defaultWidth }),
    {
      type: 0,
      idTag: 0,
      pathContext: 0,
      source: 0,
      actions: 0,
    },
  );
}

function parseStoredMacroHelpColumnWidths(raw: string | null): Record<MacroHelpColumnId, number> {
  const defaults = createDefaultMacroHelpColumnWidths();
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<MacroHelpColumnId, unknown>>;
    return MACRO_HELP_COLUMNS.reduce<Record<MacroHelpColumnId, number>>((acc, column) => {
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

const practicalMacroExamples: Array<{ id: string; title: string; description: string; code: string }> = [
  {
    id: "practical-start-permission",
    title: "Start command with permissive checks",
    description: "Check interlocks before sending a start command.",
    code: `const ready = readTag("Pump_1.Ready") === true;
const alarm = readTag("Pump_1.Alarm") === true;
if (!ready || alarm) {
  warn("Start blocked", { ready, alarm });
  return;
}
await pulseTag("Pump_1.StartCmd", true, 300, false);`,
  },
  {
    id: "practical-auto-stop-on-fault",
    title: "Auto stop on fault",
    description: "Stop equipment on fault and store fault source.",
    code: `if (readTag("Pump_1.Fault") === true) {
  await writeTag("Pump_1.StopCmd", true);
  setVar("LastFaultSource", "Pump_1");
  error("Pump_1 fault -> StopCmd");
}`,
  },
  {
    id: "practical-hysteresis",
    title: "Temperature hysteresis control",
    description: "Heater control using low/high hysteresis limits.",
    code: `const t = Number(readTag("Tank.Temp") ?? 0);
const low = Number(getVar("TempLow") ?? 58);
const high = Number(getVar("TempHigh") ?? 62);
const heaterOn = readTag("Tank.HeaterOn") === true;
if (!heaterOn && t <= low) await writeTag("Tank.HeaterCmd", true);
if (heaterOn && t >= high) await writeTag("Tank.HeaterCmd", false);`,
  },
  {
    id: "practical-popup-context",
    title: "Open popup for selected equipment",
    description: "Open a reusable popup with tagPrefix and args.",
    code: `const line = Number(getLW(10) ?? 1);
const unit = Number(getLW(11) ?? 1);
const prefix = "LINES.L" + line + ".U" + unit;
openPopup("Popup_UnitControl", {
  title: "Unit L" + line + ".U" + unit,
  tagPrefix: prefix,
  args: { line, unit }
});`,
  },
  {
    id: "practical-quality-fallback",
    title: "Bad quality fallback",
    description: "Fallback behavior when tag quality is not Good.",
    code: `const q = getTagQuality("FlowMeter.Value");
if (q !== "Good") {
  warn("FlowMeter quality:", q);
  setVar("FlowFallbackMode", true);
  return;
}
setVar("FlowFallbackMode", false);`,
  },
  {
    id: "practical-index-calc-flat",
    title: "Index calculation (flat mapping)",
    description: "Map [burner, valve] into a flat index.",
    code: `const burner = Number(getLW(20) ?? 1);      // 1..N
const valve = Number(getLW(10) ?? 1);       // 1..M
const valvesPerBurner = 32;
const index = (burner - 1) * valvesPerBurner + valve;
setLW(9200, index);
setVar("SelectedIndex", index);
log("SelectedIndex =", index);`,
  },
  {
    id: "practical-window-template-popup",
    title: "Window template popup by index",
    description: "Open a template popup by computed index.",
    code: `const index = Number(getVar("SelectedIndex") ?? 1);
const prefix = "VALVES.V" + index;
openPopup("Popup_ValveTemplate", {
  title: "Valve Template #" + index,
  tagPrefix: prefix,
  args: {
    template: "valve-control",
    index,
    prefix
  }
});`,
  },
  {
    id: "practical-prefix-from-index",
    title: "Build prefix from index",
    description: "Build runtime prefix from index and use resolveTag.",
    code: `const index = Number(getVar("SelectedIndex") ?? 1);
const prefix = "UNITS.U" + index;
const runTag = resolveTag(".Run", prefix);
const cmdTag = resolveTag(".StartCmd", prefix);
if (readTag(runTag) !== true) {
  await pulseTag(cmdTag, true, 300, false);
}
log("prefix =", prefix, "runTag =", runTag);`,
  },
  {
    id: "practical-window-template-matrix",
    title: "Popup template matrix (row/col -> prefix)",
    description: "Template popup for matrix equipment by row/col index.",
    code: `const row = Number(getLW(30) ?? 1);
const col = Number(getLW(31) ?? 1);
const cellIndex = (row - 1) * 10 + col;
const prefix = "MATRIX.R" + row + ".C" + col;
openPopup("Popup_CellTemplate", {
  title: "Cell R" + row + " C" + col,
  tagPrefix: prefix,
  args: {
    template: "matrix-cell",
    row,
    col,
    cellIndex
  }
});`,
  },
];

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

function normalizeSnippetForInsert(snippet: string): string {
  return snippet
    .replace(/\$\{(\d+):([^}]+)\}/g, "$2")
    .replace(/\$(\d+)/g, "");
}

function formatObjectTypeLabel(value: string): string {
  if (!value) {
    return "Unknown";
  }
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function ScreenEditorMacrosWindow() {
  const project = useScadaStore((s) => s.project);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const macros = useScadaStore((s) => s.macros);
  const libraries = useScadaStore((s) => s.libraries);
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
  const [helpTab, setHelpTab] = useState<HelpTabKey>("quickStart");
  const [templateQuery, setTemplateQuery] = useState("");
  const [tagsObjectsQuery, setTagsObjectsQuery] = useState("");
  const [helpColumnWidths, setHelpColumnWidths] = useState<Record<MacroHelpColumnId, number>>(() => {
    if (typeof window === "undefined") {
      return createDefaultMacroHelpColumnWidths();
    }
    return parseStoredMacroHelpColumnWidths(window.localStorage.getItem(MACRO_HELP_COLUMNS_WIDTH_STORAGE_KEY));
  });
  const [tagsObjectsPage, setTagsObjectsPage] = useState(1);
  const [tagsObjectsPageSize, setTagsObjectsPageSize] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 100;
    }
    const parsed = Number(window.localStorage.getItem(MACRO_HELP_PAGE_SIZE_STORAGE_KEY) ?? "100");
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 100;
    }
    return parsed;
  });
  const [tagsObjectsScopeFilter, setTagsObjectsScopeFilter] = useState<TagsObjectsScopeFilter>("all");
  const [tagsObjectsSourceFilter, setTagsObjectsSourceFilter] = useState<TagsObjectsSourceFilter>("all");
  const [tagsObjectsTypeFilter, setTagsObjectsTypeFilter] = useState("all");
  const listPanelRef = useRef<ImperativePanelHandle | null>(null);
  const consolePanelRef = useRef<ImperativePanelHandle | null>(null);
  const codeEditorRef = useRef<MacroCodeEditorHandle | null>(null);

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
  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) {
      return macroTemplates;
    }
    return macroTemplates.filter((item) => `${item.title} ${item.description} ${item.code}`.toLowerCase().includes(q));
  }, [templateQuery]);
  const objectCandidates = useMemo<HelpObjectCandidate[]>(() => {
    const screens = project?.screens ?? [];
    if (screens.length === 0) {
      return [];
    }

    const candidates: HelpObjectCandidate[] = [];
    const libraryById = new Map(libraries.map((library) => [library.id, library]));
    const seen = new Set<string>();

    const pushCandidate = (candidate: HelpObjectCandidate) => {
      if (seen.has(candidate.key)) {
        return;
      }
      seen.add(candidate.key);
      candidates.push(candidate);
    };

    const collectLibraryTemplateObjects = (
      instanceObject: Extract<HmiObject, { type: "libraryElementInstance" }>,
      objects: HmiObject[],
      pathPrefix: string,
      screenId: string,
      screenName: string,
    ): void => {
      for (const object of objects) {
        const path = `${pathPrefix}/${object.id}`;
        pushCandidate({
          key: `lib:${instanceObject.id}:${path}`,
          insertId: object.id,
          path,
          type: object.type,
          context: pathPrefix,
          screenId,
          screenName,
          source: "libraryInstance",
        });
        if (object.type === "group") {
          collectLibraryTemplateObjects(instanceObject, object.objects, path, screenId, screenName);
        }
      }
    };

    const collectScreenObjects = (objects: HmiObject[], pathPrefix: string, screenId: string, screenName: string): void => {
      for (const object of objects) {
        const path = `${pathPrefix}/${object.id}`;
        pushCandidate({
          key: `screen:${object.id}:${path}`,
          insertId: object.id,
          path,
          type: object.type,
          screenId,
          screenName,
          source: "screen",
        });
        if (object.type === "group") {
          collectScreenObjects(object.objects, path, screenId, screenName);
        }
        if (object.type === "libraryElementInstance") {
          const sourceLibrary = libraryById.get(object.libraryId);
          const sourceElement = sourceLibrary?.elements.find((element) => element.id === object.elementId);
          if (sourceLibrary && sourceElement) {
            collectLibraryTemplateObjects(
              object,
              sourceElement.objects,
              `${path}[${sourceLibrary.id}:${sourceElement.name}]`,
              screenId,
              screenName,
            );
          }
        }
      }
    };

    for (const screen of screens) {
      collectScreenObjects(screen.objects, screen.id, screen.id, screen.name ?? screen.id);
    }
    return candidates;
  }, [libraries, project?.screens]);
  const tagsObjectsRows = useMemo<MacroHelpRow[]>(() => {
    const rows: MacroHelpRow[] = [];
    for (const tag of project?.tags ?? []) {
      const group = tag.group?.trim() || "-";
      rows.push({
        key: `tag:${tag.name}`,
        type: "Tag",
        idTag: tag.name,
        pathContext: group,
        source: "ProjectTags",
        sourceKey: "projectTags",
        objectType: "tag",
        search: `${tag.name} ${group} projecttags tag`.toLowerCase(),
        rowType: "tag",
      });
    }
    for (const obj of objectCandidates) {
      const screenContext = `${obj.screenName} (${obj.screenId})`;
      const pathContext = `${screenContext} | ${obj.path}${obj.context ? ` | ${obj.context}` : ""}`;
      rows.push({
        key: obj.key,
        type: obj.source === "libraryInstance" ? "Library Object" : "Object",
        idTag: obj.insertId,
        pathContext,
        source: obj.source === "libraryInstance" ? "LibraryInstance" : "Screen",
        sourceKey: obj.source === "libraryInstance" ? "libraryInstance" : "screen",
        objectType: obj.type,
        search: `${obj.insertId} ${obj.path} ${obj.context ?? ""} ${obj.screenId} ${obj.screenName} ${
          obj.source === "libraryInstance" ? "libraryinstance" : "screen"
        } ${obj.type} ${
          obj.source === "libraryInstance" ? "library object" : "object"
        }`.toLowerCase(),
        rowType: "object",
      });
    }
    return rows;
  }, [objectCandidates, project?.tags]);
  const tagsObjectsTypeOptions = useMemo(() => {
    const set = new Set(tagsObjectsRows.map((row) => row.objectType).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tagsObjectsRows]);
  const filteredTagsObjectsRows = useMemo(() => {
    const query = tagsObjectsQuery.trim().toLowerCase();
    return tagsObjectsRows.filter((row) => {
      if (tagsObjectsScopeFilter === "tags" && row.rowType !== "tag") {
        return false;
      }
      if (tagsObjectsScopeFilter === "screenObjects" && !(row.rowType === "object" && row.sourceKey === "screen")) {
        return false;
      }
      if (tagsObjectsScopeFilter === "libraryObjects" && !(row.rowType === "object" && row.sourceKey === "libraryInstance")) {
        return false;
      }
      if (tagsObjectsSourceFilter !== "all" && row.sourceKey !== tagsObjectsSourceFilter) {
        return false;
      }
      if (tagsObjectsTypeFilter !== "all" && row.objectType !== tagsObjectsTypeFilter) {
        return false;
      }
      if (query && !row.search.includes(query)) {
        return false;
      }
      return true;
    });
  }, [tagsObjectsQuery, tagsObjectsRows, tagsObjectsScopeFilter, tagsObjectsSourceFilter, tagsObjectsTypeFilter]);
  const tagsObjectsTotalRows = filteredTagsObjectsRows.length;
  const tagsObjectsTotalPages = Math.max(1, Math.ceil(tagsObjectsTotalRows / tagsObjectsPageSize));
  const tagsObjectsSafePage = Math.min(tagsObjectsPage, tagsObjectsTotalPages);
  const tagsObjectsPageRows = useMemo(
    () => filteredTagsObjectsRows.slice((tagsObjectsSafePage - 1) * tagsObjectsPageSize, tagsObjectsSafePage * tagsObjectsPageSize),
    [filteredTagsObjectsRows, tagsObjectsPageSize, tagsObjectsSafePage],
  );
  const macroHelpGridTemplateColumns = useMemo(
    () => MACRO_HELP_COLUMNS.map((column) => `${helpColumnWidths[column.id] ?? column.defaultWidth}px`).join(" "),
    [helpColumnWidths],
  );
  const exampleRows = useMemo(
    () => [...practicalMacroExamples, ...macroExamples].map((example) => ({
      ...example,
      description: example.description
        .replaceAll("Проверка текущего значения аналогового тега.", "Check current value of an analog tag.")
        .replaceAll("Отправка команды ПУСК.", "Send a start command.")
        .replaceAll("Подача импульса 300 мс с авто-сбросом.", "Send a 300 ms pulse with auto reset.")
        .replaceAll("Открытие универсального popup для выбранного агрегата.", "Open a reusable popup for selected equipment.")
        .replaceAll("Выбор активного насоса через LW10.", "Select active pump via LW10.")
        .replaceAll("Сохранение этапа операции между запусками.", "Persist operation step between runs.")
        .replaceAll("Безопасная работа с .Tag внутри popup по prefix.", "Use .Tag safely in popup context with prefix.")
        .replaceAll("Пример вычисления и записи индекса.", "Compute and store index value.")
        .replaceAll("Один popup для разных клапанов.", "Use one popup template for different valves.")
        .replaceAll("Переключение префикса через internal variable.", "Switch prefix via internal variable.")
        .replaceAll("Инкремент internal var и LW.", "Increment internal var and LW register.")
        .replaceAll("Лог и var при плохом качестве.", "Log and set var on bad quality."),
      code: example.code,
    })),
    [],
  );

  const updateDraft = useCallback((patch: Partial<MacroDraft>) => {
    setDraftMacro((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const insertCode = useCallback((snippet: string) => {
    if (!draftMacro) {
      return;
    }
    const editor = codeEditorRef.current;
    if (editor?.insertText(snippet)) {
      return;
    }
    updateDraft({ code: `${draftMacro.code}${snippet}` });
  }, [draftMacro, updateDraft]);

  const startMacroHelpColumnResize = useCallback((
    event: React.MouseEvent<HTMLSpanElement>,
    columnId: MacroHelpColumnId,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const column = MACRO_HELP_COLUMNS.find((item) => item.id === columnId);
    if (!column) {
      return;
    }

    const startX = event.clientX;
    const startWidth = helpColumnWidths[columnId] ?? column.defaultWidth;

    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(column.minWidth, startWidth + delta);
      setHelpColumnWidths((prev) => ({
        ...prev,
        [columnId]: next,
      }));
    };

    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [helpColumnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MACRO_HELP_COLUMNS_WIDTH_STORAGE_KEY, JSON.stringify(helpColumnWidths));
  }, [helpColumnWidths]);

  useEffect(() => {
    setTagsObjectsPage(1);
  }, [tagsObjectsQuery, tagsObjectsScopeFilter, tagsObjectsSourceFilter, tagsObjectsTypeFilter]);

  useEffect(() => {
    if (tagsObjectsPage > tagsObjectsTotalPages) {
      setTagsObjectsPage(tagsObjectsTotalPages);
    }
  }, [tagsObjectsPage, tagsObjectsTotalPages]);

  useEffect(() => {
    if (tagsObjectsTypeFilter === "all") {
      return;
    }
    if (!tagsObjectsTypeOptions.includes(tagsObjectsTypeFilter)) {
      setTagsObjectsTypeFilter("all");
    }
  }, [tagsObjectsTypeFilter, tagsObjectsTypeOptions]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MACRO_HELP_PAGE_SIZE_STORAGE_KEY, String(tagsObjectsPageSize));
  }, [tagsObjectsPageSize]);

  const checkSyntax = useCallback(() => {
    if (!draftMacro) {
      return;
    }
    try {
      // eslint-disable-next-line no-new-func
      new Function("api", "args", draftMacro.code);
      appendConsole("success", "Check syntax: OK");
      void message.success("Syntax OK");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      appendConsole("error", `Check syntax failed: ${text}`);
      void message.error(text);
    }
  }, [appendConsole, draftMacro]);

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
    showProjectCleanupHint("Macro was deleted");
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
          icon={<CheckOutlined />}
          title="Check Syntax"
          onClick={checkSyntax}
          disabled={!draftMacro}
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
        <WorkbenchButton icon={<SaveOutlined />} title="Save Project" onClick={() => void saveProject({ notify: true })} />
        <WorkbenchButton icon={<QuestionCircleOutlined />} title="Macro help" onClick={openHelpWindow} />
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
                      <div className="screen-editor-macro-code-editor">
                        <MacroCodeEditor
                          ref={codeEditorRef}
                          value={draftMacro.code}
                          onChange={(value) => updateDraft({ code: value })}
                          height="100%"
                          enableMacroCompletions
                        />
                      </div>
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
                <Tabs
                  className="screen-editor-macro-help-tabs"
                  activeKey={helpTab}
                  onChange={(key) => setHelpTab(key as HelpTabKey)}
                  items={[
                    {
                      key: "quickStart",
                      label: "Quick Start",
                      children: (
                        <div className="screen-editor-macro-help-modal__block">
                          <div className="screen-editor-macro-help-modal__title">Quick Start</div>
                          <div className="screen-editor-macro-help-section-grid">
                            <div className="screen-editor-macro-help-section">
                              <div className="screen-editor-macro-help-section__title">Syntax Basics</div>
                              <ul>
                                <li>Read values with <code>readTag</code> / <code>getVar</code>.</li>
                                <li>Use conditionals to decide actions.</li>
                                <li>Write outputs with <code>writeTag</code> or <code>pulseTag</code>.</li>
                              </ul>
                              <pre>{`const pressure = Number(readTag("Boiler.Pressure") ?? 0);
if (pressure > 10) await writeTag("Boiler.HighPressureAlarm", true);`}</pre>
                              <pre>{`const enabled = readTag("Pump_1.Enable") === true;
if (enabled) await pulseTag("Pump_1.StartCmd", true, 300, false);`}</pre>
                            </div>
                            <div className="screen-editor-macro-help-section">
                              <div className="screen-editor-macro-help-section__title">Indexing Patterns</div>
                              <ul>
                                <li>Map multi-dimensional selectors to one flat index.</li>
                                <li>Store index in LW/internal variable for reuse.</li>
                              </ul>
                              <pre>{`const burner = Number(getLW(20) ?? 1);
const valve = Number(getLW(10) ?? 1);
const index = (burner - 1) * 32 + valve;
setLW(9200, index);`}</pre>
                              <pre>{`const row = Number(getLW(30) ?? 1);
const col = Number(getLW(31) ?? 1);
const cellIndex = (row - 1) * 10 + col;
setVar("CellIndex", cellIndex);`}</pre>
                            </div>
                            <div className="screen-editor-macro-help-section">
                              <div className="screen-editor-macro-help-section__title">Window Template Patterns</div>
                              <ul>
                                <li>Open one popup template for many assets via <code>tagPrefix</code>.</li>
                                <li>Pass calculated values via <code>args</code>.</li>
                              </ul>
                              <pre>{`const index = Number(getVar("SelectedIndex") ?? 1);
openPopup("Popup_ValveTemplate", {
  title: "Valve #" + index,
  tagPrefix: "VALVES.V" + index,
  args: { index }
});`}</pre>
                              <pre>{`openPopup("Popup_CellTemplate", {
  title: "Cell Details",
  tagPrefix: "MATRIX.R1.C1",
  args: { mode: "inspect", source: "macro" }
});`}</pre>
                            </div>
                            <div className="screen-editor-macro-help-section">
                              <div className="screen-editor-macro-help-section__title">Prefix & resolveTag Patterns</div>
                              <ul>
                                <li>Build dynamic prefixes from runtime selectors.</li>
                                <li>Resolve relative tags like <code>.Run</code>, <code>.StartCmd</code>.</li>
                              </ul>
                              <pre>{`const prefix = "UNITS.U" + Number(getVar("SelectedIndex") ?? 1);
const runTag = resolveTag(".Run", prefix);
const cmdTag = resolveTag(".StartCmd", prefix);`}</pre>
                              <pre>{`if (readTag(resolveTag(".Fault", prefix)) !== true) {
  await pulseTag(resolveTag(".StartCmd", prefix), true, 300, false);
}`}</pre>
                            </div>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "api",
                      label: "API",
                      children: (
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
                                <div>
                                  <WorkbenchButton onClick={() => insertCode(`${normalizeSnippetForInsert(buildApiSnippet(item))}\n`)}>
                                    Insert
                                  </WorkbenchButton>
                                </div>
                                <pre>{item.example}</pre>
                              </div>
                            ))}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "templates",
                      label: "Templates",
                      children: (
                        <div className="screen-editor-macro-help-modal__block">
                          <div className="screen-editor-macro-help-modal__title">Templates</div>
                          <input
                            className="workbench-input"
                            value={templateQuery}
                            placeholder="Search templates"
                            onChange={(event) => setTemplateQuery(event.target.value)}
                            style={{ marginBottom: 8, width: "100%" }}
                          />
                          <div className="screen-editor-macro-help-modal__api-list">
                            {filteredTemplates.map((template) => (
                              <div key={template.id} className="screen-editor-macro-help-modal__api-item">
                                <div className="screen-editor-macro-help-modal__api-meta">
                                  <span>{template.category}</span>
                                </div>
                                <code>{template.title}</code>
                                <div className="screen-editor-macro-help-modal__api-desc">{template.description}</div>
                                <div>
                                  <WorkbenchButton onClick={() => insertCode(`\n${template.code}\n`)}>
                                    Insert
                                  </WorkbenchButton>
                                </div>
                                <pre>{template.code}</pre>
                              </div>
                            ))}
                            {filteredTemplates.length === 0 ? <div className="screen-editor-empty-state">No templates found</div> : null}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "tagsObjects",
                      label: "Tags/Objects",
                      children: (
                        <div className="screen-editor-macro-help-modal__block">
                          <div className="screen-editor-macro-help-modal__title">Tags / Objects</div>
                          <div className="screen-editor-macro-help-tags-filters">
                            <select
                              className="workbench-select"
                              value={tagsObjectsScopeFilter}
                              onChange={(event) => setTagsObjectsScopeFilter(event.target.value as TagsObjectsScopeFilter)}
                            >
                              <option value="all">Scope: All Items</option>
                              <option value="tags">Scope: Tags</option>
                              <option value="screenObjects">Scope: Screen Objects</option>
                              <option value="libraryObjects">Scope: Library Objects</option>
                            </select>
                            <select
                              className="workbench-select"
                              value={tagsObjectsSourceFilter}
                              onChange={(event) => setTagsObjectsSourceFilter(event.target.value as TagsObjectsSourceFilter)}
                            >
                              <option value="all">Source: All</option>
                              <option value="projectTags">Source: ProjectTags</option>
                              <option value="screen">Source: Screen</option>
                              <option value="libraryInstance">Source: LibraryInstance</option>
                            </select>
                            <select
                              className="workbench-select"
                              value={tagsObjectsTypeFilter}
                              onChange={(event) => setTagsObjectsTypeFilter(event.target.value)}
                            >
                              <option value="all">Type: All</option>
                              {tagsObjectsTypeOptions.map((typeValue) => (
                                <option key={typeValue} value={typeValue}>
                                  {`Type: ${formatObjectTypeLabel(typeValue)}`}
                                </option>
                              ))}
                            </select>
                            <input
                              className="workbench-input screen-editor-macro-help-tags-search"
                              value={tagsObjectsQuery}
                              placeholder="Search tag/id/path/screen/context"
                              onChange={(event) => setTagsObjectsQuery(event.target.value)}
                            />
                          </div>
                          <div className="screen-editor-macro-help-tags-table-wrap">
                            <div className="screen-editor-tags-table">
                              <div
                                className="screen-editor-tags-row screen-editor-tags-row--header"
                                style={{ gridTemplateColumns: macroHelpGridTemplateColumns } as CSSProperties}
                              >
                                {MACRO_HELP_COLUMNS.map((column) => (
                                  <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell">
                                    <span>{column.title}</span>
                                    <span
                                      className="screen-editor-tags-column-resize-handle"
                                      onMouseDown={(event) => startMacroHelpColumnResize(event, column.id)}
                                    />
                                  </div>
                                ))}
                              </div>
                              {tagsObjectsPageRows.map((row) => (
                                <div
                                  key={row.key}
                                  className="screen-editor-tags-row"
                                  style={{ gridTemplateColumns: macroHelpGridTemplateColumns } as CSSProperties}
                                >
                                  <div className="screen-editor-tags-cell">{row.type}</div>
                                  <div className="screen-editor-tags-cell screen-editor-macro-help-tags-table__mono" title={row.idTag}>
                                    {row.idTag}
                                  </div>
                                  <div className="screen-editor-tags-cell" title={row.pathContext}>
                                    {row.pathContext}
                                  </div>
                                  <div className="screen-editor-tags-cell">{row.source}</div>
                                  <div className="screen-editor-tags-cell">
                                    <div className="screen-editor-macro-help-tags-table__actions">
                                      {row.rowType === "tag" ? (
                                        <>
                                          <WorkbenchButton onClick={() => insertCode(`readTag("${row.idTag}")`)}>Read</WorkbenchButton>
                                          <WorkbenchButton onClick={() => insertCode(`writeTag("${row.idTag}", value)`)}>Write</WorkbenchButton>
                                        </>
                                      ) : (
                                        <WorkbenchButton onClick={() => insertCode(`"${row.idTag}"`)}>
                                          Insert ID
                                        </WorkbenchButton>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {tagsObjectsPageRows.length === 0 ? (
                              <div className="screen-editor-empty-state">No matches found</div>
                            ) : null}
                          </div>
                          <div className="screen-editor-tags-pagination screen-editor-macro-help-tags-pagination">
                            <span>
                              Rows: {tagsObjectsTotalRows} · Page {tagsObjectsSafePage} / {tagsObjectsTotalPages}
                            </span>
                            <WorkbenchButton disabled={tagsObjectsSafePage <= 1} onClick={() => setTagsObjectsPage(1)}>
                              First
                            </WorkbenchButton>
                            <WorkbenchButton
                              disabled={tagsObjectsSafePage <= 1}
                              onClick={() => setTagsObjectsPage((prev) => Math.max(1, prev - 1))}
                            >
                              Prev
                            </WorkbenchButton>
                            <WorkbenchButton
                              disabled={tagsObjectsSafePage >= tagsObjectsTotalPages}
                              onClick={() => setTagsObjectsPage((prev) => Math.min(tagsObjectsTotalPages, prev + 1))}
                            >
                              Next
                            </WorkbenchButton>
                            <WorkbenchButton
                              disabled={tagsObjectsSafePage >= tagsObjectsTotalPages}
                              onClick={() => setTagsObjectsPage(tagsObjectsTotalPages)}
                            >
                              Last
                            </WorkbenchButton>
                            <select
                              className="workbench-select screen-editor-tags-page-size"
                              value={tagsObjectsPageSize}
                              onChange={(event) => {
                                setTagsObjectsPageSize(Number(event.target.value));
                                setTagsObjectsPage(1);
                              }}
                            >
                              <option value={50}>50</option>
                              <option value={100}>100</option>
                              <option value={200}>200</option>
                              <option value={500}>500</option>
                            </select>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "examples",
                      label: "Examples",
                      children: (
                        <div className="screen-editor-macro-help-modal__block">
                          <div className="screen-editor-macro-help-modal__title">Examples</div>
                          {exampleRows.map((example) => (
                            <div key={example.id} className="screen-editor-macro-help-modal__example">
                              <strong>{example.title}</strong>
                              <div className="screen-editor-macro-help-modal__api-desc">{example.description}</div>
                              <div>
                                <WorkbenchButton onClick={() => insertCode(`\n${example.code}\n`)}>
                                  Insert
                                </WorkbenchButton>
                              </div>
                              <pre>{example.code}</pre>
                            </div>
                          ))}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            </WorkbenchWindow>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
