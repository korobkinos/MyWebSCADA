import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ElementBindingDefinition,
  ElementLibrary,
  ElementStateAction,
  ElementStateCase,
  HmiObject,
  LibraryElement,
  MacroDefinition,
  ProjectLibraryRef,
  ScadaProject,
} from "@web-scada/shared";
import { api } from "../../../services/api";
import { WorkbenchButton, WorkbenchSection } from "../../../components/workbench";

type ScreenEditorLibrariesWindowProps = {
  libraries: ElementLibrary[];
  attachedLibraries: ProjectLibraryRef[];
  selectedObjectsCount: number;
  libraryId: string;
  libraryName: string;
  project: ScadaProject | null;
  onUpdateProjectJson?: (project: ScadaProject) => void;
  onLibraryIdChange: (value: string) => void;
  onLibraryNameChange: (value: string) => void;
  onCreateLibrary: () => Promise<void>;
  onAttachLibrary: (libraryId: string) => Promise<void>;
  onDetachLibrary: (libraryId: string) => Promise<void>;
  onAddLibraryElementToScreen: (libraryId: string, element: LibraryElement | string) => void;
  onUpdateLibraryElementFromSelection: (libraryId: string, element: LibraryElement) => Promise<void>;
  onSaveLibraryElementCopyFromSelection: (libraryId: string, element: LibraryElement) => Promise<void>;
  onRefreshLibraries?: () => Promise<void>;
  projectMacros: MacroDefinition[];
};

type TabId = "elements" | "assets" | "macros" | "metadata" | "interface";
type VisualRuleConditionType = ElementStateCase["condition"]["type"];
type VisualRuleActionKind = "visible" | "asset" | "text" | "fill" | "stroke";
type ApiErrorWithDetails = Error & { status?: number; details?: unknown };

type SignalDialogState = {
  open: boolean;
  mode: "create" | "edit";
  originalKey?: string;
  draft: ElementBindingDefinition;
  keyEditedManually: boolean;
  validationError?: string;
};

type SignalDeleteDialogState = {
  open: boolean;
  signal: ElementBindingDefinition | null;
  referencedRuleCount: number;
  usedByInstancesCount: number;
};

type SignalKeyMigrationDialogState = {
  open: boolean;
  oldKey: string;
  draft: ElementBindingDefinition;
};

type VisualRuleActionDraft = {
  id: string;
  objectId: string;
  type: VisualRuleActionKind;
  value: string;
};

type VisualRuleDialogState = {
  open: boolean;
  mode: "create" | "edit";
  editingRuleId?: string;
  signalKey: string;
  condition: VisualRuleConditionType;
  value: string;
  value2: string;
  actions: VisualRuleActionDraft[];
  validationError?: string;
};

type VisualRuleDeleteDialogState = {
  open: boolean;
  ruleId: string;
  title: string;
};

type DeleteLibraryDialogState = {
  open: boolean;
  canForce: boolean;
  message: string;
};

type DeleteElementDialogState = {
  open: boolean;
  element: LibraryElement | null;
  canForce: boolean;
  usagePreview: string[];
  message: string;
};

type WorkbenchDialogProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

type FlatObjectOption = {
  id: string;
  type: HmiObject["type"];
  label: string;
};

const DATA_TYPE_OPTIONS: Array<NonNullable<ElementBindingDefinition["dataType"]>> = ["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"];

function formatOneDecimal(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "0.0";
  }
  const normalized = Math.trunc((value ?? 0) * 10) / 10;
  return normalized.toFixed(1);
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSignalKey(displayName: string): string {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `signal_${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBindingKeyFromRuleSource(rule: NonNullable<LibraryElement["stateRules"]>[number]): string | null {
  if (rule.source.type !== "tag") {
    return null;
  }
  const value = (rule.source.value ?? "").trim();
  if (!value.startsWith("$binding.")) {
    return null;
  }
  const key = value.slice("$binding.".length).trim();
  return key || null;
}

function ruleReferencesSignalKey(rule: NonNullable<LibraryElement["stateRules"]>[number], key: string): boolean {
  const pattern = new RegExp(`\\$binding\\.${escapeRegExp(key)}\\b`);
  if (rule.source.type === "tag" || rule.source.type === "expression") {
    return pattern.test(rule.source.value ?? "");
  }
  return false;
}

function replaceRuleSignalKey(rule: NonNullable<LibraryElement["stateRules"]>[number], oldKey: string, newKey: string) {
  const pattern = new RegExp(`\\$binding\\.${escapeRegExp(oldKey)}\\b`, "g");
  if (rule.source.type === "tag" || rule.source.type === "expression") {
    return {
      ...rule,
      source: {
        ...rule.source,
        value: (rule.source.value ?? "").replace(pattern, `$binding.${newKey}`),
      },
    };
  }
  return rule;
}

function parseScalarToken(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();
  if (trimmed.toLowerCase() === "true") {
    return true;
  }
  if (trimmed.toLowerCase() === "false") {
    return false;
  }
  const asNumber = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(asNumber)) {
    return asNumber;
  }
  return trimmed;
}

function flattenElementObjects(objects: HmiObject[], depth = 0): FlatObjectOption[] {
  const rows: FlatObjectOption[] = [];
  for (const item of objects) {
    const indent = depth > 0 ? `${"  ".repeat(depth)}• ` : "";
    rows.push({
      id: item.id,
      type: item.type,
      label: `${indent}${item.name?.trim() || item.id} (${item.type})`,
    });
    if (item.type === "group") {
      rows.push(...flattenElementObjects(item.objects, depth + 1));
    }
  }
  return rows;
}

function toVisualActionDraft(action: ElementStateAction): VisualRuleActionDraft {
  if (action.type === "setVisible") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      type: "visible",
      value: action.visible ? "true" : "false",
    };
  }
  if (action.type === "setAsset") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      type: "asset",
      value: action.assetId,
    };
  }
  if (action.type === "setText") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      type: "text",
      value: action.text,
    };
  }
  if (action.type === "setFill") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      type: "fill",
      value: action.color,
    };
  }
  return {
    id: createId("act"),
    objectId: action.objectId,
    type: "stroke",
    value: action.color,
  };
}

function fromVisualActionDraft(action: VisualRuleActionDraft): ElementStateAction {
  if (action.type === "visible") {
    return {
      type: "setVisible",
      objectId: action.objectId,
      visible: action.value === "true",
    };
  }
  if (action.type === "asset") {
    return {
      type: "setAsset",
      objectId: action.objectId,
      assetId: action.value,
    };
  }
  if (action.type === "text") {
    return {
      type: "setText",
      objectId: action.objectId,
      text: action.value,
    };
  }
  if (action.type === "fill") {
    return {
      type: "setFill",
      objectId: action.objectId,
      color: action.value,
    };
  }
  return {
    type: "setStroke",
    objectId: action.objectId,
    color: action.value,
  };
}

function describeCondition(condition: ElementStateCase["condition"]): string {
  switch (condition.type) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "equals":
      return `equals ${String(condition.value ?? "")}`;
    case "notEquals":
      return `not equals ${String(condition.value ?? "")}`;
    case "greaterThan":
      return `> ${condition.value}`;
    case "lessThan":
      return `< ${condition.value}`;
    case "between":
      return `between ${condition.min} .. ${condition.max}`;
    default:
      return "condition";
  }
}

function describeAction(action: ElementStateAction): string {
  if (action.type === "setVisible") {
    return `${action.objectId}.visible = ${String(action.visible)}`;
  }
  if (action.type === "setAsset") {
    return `${action.objectId}.asset = ${action.assetId || "<empty>"}`;
  }
  if (action.type === "setText") {
    return `${action.objectId}.text = ${action.text || "<empty>"}`;
  }
  if (action.type === "setFill") {
    return `${action.objectId}.fill = ${action.color || "<empty>"}`;
  }
  return `${action.objectId}.stroke = ${action.color || "<empty>"}`;
}

function countSignalAssignmentsInProject(
  project: ScadaProject | null,
  libraryId: string,
  elementId: string,
  bindingKey: string,
): number {
  if (!project) {
    return 0;
  }
  let count = 0;
  const scan = (objects: HmiObject[]): void => {
    for (const item of objects) {
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        if (item.bindingAssignments?.[bindingKey]) {
          count += 1;
        }
      }
      if (item.type === "group") {
        scan(item.objects);
      }
    }
  };

  for (const screen of project.screens) {
    scan(screen.objects);
  }

  return count;
}

function mutateProjectInstanceAssignments(
  project: ScadaProject,
  libraryId: string,
  elementId: string,
  updater: (assignments: Record<string, unknown>) => { changed: boolean; nextAssignments: Record<string, unknown> },
): { nextProject: ScadaProject; changedInstances: number } {
  const nextProject = structuredClone(project);
  let changedInstances = 0;

  const scan = (objects: HmiObject[]): void => {
    for (const item of objects) {
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        const currentAssignments = (item.bindingAssignments ?? {}) as Record<string, unknown>;
        const updated = updater(currentAssignments);
        if (updated.changed) {
          item.bindingAssignments = updated.nextAssignments as never;
          changedInstances += 1;
        }
      }
      if (item.type === "group") {
        scan(item.objects);
      }
    }
  };

  for (const screen of nextProject.screens) {
    scan(screen.objects);
  }

  return { nextProject, changedInstances };
}

function WorkbenchDialog({
  title,
  open,
  onClose,
  width = 520,
  children,
  actions,
}: WorkbenchDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    event.preventDefault();
    const startRect = dialog.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const base = { x: startRect.left, y: startRect.top };
    setPosition(base);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      setPosition({ x: base.x + dx, y: base.y + dy });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  return (
    <div className="workbench-confirm-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <div
        ref={dialogRef}
        className="workbench-confirm-dialog"
        style={position ? { position: "fixed", left: position.x, top: position.y, width, margin: 0 } : { width }}
      >
        <div className="workbench-confirm-dialog__header" onPointerDown={onHeaderPointerDown} style={{ cursor: "move", justifyContent: "space-between" }}>
          <span>{title}</span>
          <button type="button" className="workbench-button" onClick={onClose} aria-label="Close" style={{ height: 22 }}>
            x
          </button>
        </div>
        <div className="workbench-confirm-dialog__body">{children}</div>
        {actions ? <div className="workbench-confirm-dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ScreenEditorLibrariesWindow(props: ScreenEditorLibrariesWindowProps) {
  const {
    libraries,
    attachedLibraries,
    selectedObjectsCount,
    libraryId,
    libraryName,
    project,
    onUpdateProjectJson,
    onLibraryIdChange,
    onLibraryNameChange,
    onCreateLibrary,
    onAttachLibrary,
    onDetachLibrary,
    onAddLibraryElementToScreen,
    onUpdateLibraryElementFromSelection,
    onSaveLibraryElementCopyFromSelection,
    onRefreshLibraries,
    projectMacros,
  } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(libraries[0]?.id ?? "");
  const [selectedElementId, setSelectedElementId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabId>("elements");
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof api.validateLibraryImport>> | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [replaceLibrary, setReplaceLibrary] = useState(false);
  const [importAsCopy, setImportAsCopy] = useState(false);
  const [importMacrosToProject, setImportMacrosToProject] = useState(false);
  const [macroConflictMode, setMacroConflictMode] = useState<"skip" | "overwrite" | "copy">("skip");
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataVersion, setMetadataVersion] = useState("");
  const [selectedProjectMacroId, setSelectedProjectMacroId] = useState("");
  const [savingInterface, setSavingInterface] = useState(false);
  const [interfaceError, setInterfaceError] = useState<string | null>(null);

  const [signalDialog, setSignalDialog] = useState<SignalDialogState>({
    open: false,
    mode: "create",
    draft: {
      id: createId("binding"),
      key: "",
      displayName: "",
      kind: "state",
      dataType: "BOOL",
      required: false,
      description: "",
    },
    keyEditedManually: false,
  });
  const [signalDeleteDialog, setSignalDeleteDialog] = useState<SignalDeleteDialogState>({
    open: false,
    signal: null,
    referencedRuleCount: 0,
    usedByInstancesCount: 0,
  });
  const [signalKeyMigrationDialog, setSignalKeyMigrationDialog] = useState<SignalKeyMigrationDialogState>({
    open: false,
    oldKey: "",
    draft: {
      id: "",
      key: "",
      displayName: "",
      kind: "state",
      dataType: "BOOL",
      required: false,
      description: "",
    },
  });

  const [visualRuleDialog, setVisualRuleDialog] = useState<VisualRuleDialogState>({
    open: false,
    mode: "create",
    signalKey: "",
    condition: "true",
    value: "",
    value2: "",
    actions: [],
  });
  const [visualRuleDeleteDialog, setVisualRuleDeleteDialog] = useState<VisualRuleDeleteDialogState>({
    open: false,
    ruleId: "",
    title: "",
  });
  const [deleteLibraryDialog, setDeleteLibraryDialog] = useState<DeleteLibraryDialogState>({
    open: false,
    canForce: false,
    message: "",
  });
  const [deleteElementDialog, setDeleteElementDialog] = useState<DeleteElementDialogState>({
    open: false,
    element: null,
    canForce: false,
    usagePreview: [],
    message: "",
  });

  useEffect(() => {
    if (!selectedLibraryId || !libraries.some((item) => item.id === selectedLibraryId)) {
      setSelectedLibraryId(libraries[0]?.id ?? "");
    }
  }, [libraries, selectedLibraryId]);

  useEffect(() => {
    setSelectedElementId("");
  }, [selectedLibraryId]);

  const attachedIds = useMemo(
    () =>
      new Set(
        attachedLibraries
          .filter((ref) => ref.enabled)
          .map((ref) => ref.libraryId),
      ),
    [attachedLibraries],
  );

  const selectedLibrary = useMemo(
    () => libraries.find((item) => item.id === selectedLibraryId),
    [libraries, selectedLibraryId],
  );
  const selectedElement = useMemo(
    () => selectedLibrary?.elements.find((item) => item.id === selectedElementId) ?? null,
    [selectedElementId, selectedLibrary],
  );

  const flatElementObjects = useMemo(
    () => flattenElementObjects(selectedElement?.objects ?? []),
    [selectedElement],
  );

  const signalUsedInRulesCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const binding of selectedElement?.bindings ?? []) {
      map.set(binding.key, 0);
    }
    for (const rule of selectedElement?.stateRules ?? []) {
      const key = extractBindingKeyFromRuleSource(rule);
      if (!key) {
        continue;
      }
      map.set(key, (map.get(key) ?? 0) + (rule.cases?.length ?? 0));
    }
    return map;
  }, [selectedElement]);

  const visualRuleCards = useMemo(() => {
    const rows: Array<{
      ruleId: string;
      name: string;
      signalKey: string;
      condition: ElementStateCase["condition"];
      actions: ElementStateAction[];
      editable: boolean;
      reason?: string;
    }> = [];
    for (const rule of selectedElement?.stateRules ?? []) {
      const signalKey = extractBindingKeyFromRuleSource(rule);
      const firstCase = rule.cases?.[0];
      const hasMultipleCases = (rule.cases?.length ?? 0) > 1;
      if (!signalKey || !firstCase || hasMultipleCases) {
        rows.push({
          ruleId: rule.id,
          name: rule.name,
          signalKey: signalKey ?? "",
          condition: firstCase?.condition ?? { type: "true" },
          actions: firstCase?.actions ?? [],
          editable: false,
          reason: !signalKey
            ? "Source is not a Signal"
            : hasMultipleCases
              ? "Rule has multiple cases"
              : "Rule has no case",
        });
        continue;
      }
      rows.push({
        ruleId: rule.id,
        name: rule.name,
        signalKey,
        condition: firstCase.condition,
        actions: firstCase.actions,
        editable: true,
      });
    }
    return rows;
  }, [selectedElement]);

  useEffect(() => {
    if (!selectedLibrary) {
      setSelectedElementId("");
      return;
    }
    if (selectedElementId && !selectedLibrary.elements.some((item) => item.id === selectedElementId)) {
      setSelectedElementId("");
    }
  }, [selectedElementId, selectedLibrary]);

  useEffect(() => {
    if (!selectedLibrary) {
      setMetadataName("");
      setMetadataDescription("");
      setMetadataVersion("");
      return;
    }
    setMetadataName(selectedLibrary.name);
    setMetadataDescription(selectedLibrary.description ?? "");
    setMetadataVersion(selectedLibrary.version ?? "1.0.0");
  }, [selectedLibrary]);

  const refresh = async (): Promise<void> => {
    await onRefreshLibraries?.();
  };

  const triggerImportDialog = (): void => {
    fileInputRef.current?.click();
  };

  const onImportFileSelected = async (file: File): Promise<void> => {
    setValidation(null);
    setImportFile(file);
    setIsValidating(true);
    try {
      const result = await api.validateLibraryImport(file);
      setValidation(result);
      setReplaceLibrary(Boolean(result.conflicts.libraryExists));
      setImportAsCopy(false);
    } catch (error) {
      setValidation({
        ok: true,
        valid: false,
        conflicts: { libraryExists: false, elementConflicts: [], assetConflicts: [], projectMacroConflicts: [] },
        warnings: [],
        errors: [{ code: "VALIDATION_FAILED", message: error instanceof Error ? error.message : "Validation failed" }],
      });
    } finally {
      setIsValidating(false);
    }
  };

  const confirmImport = async (): Promise<void> => {
    if (!importFile || !validation?.valid) {
      return;
    }
    try {
      await api.importLibrary(importFile, {
        replace: replaceLibrary,
        importAsCopy,
        importMacrosToProject,
        macroConflictMode,
      });
      setValidation(null);
      setImportFile(null);
      await refresh();
    } catch {
      // no-op
    }
  };

  const exportSelectedLibrary = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    const exported = await api.exportLibrary(selectedLibrary.id);
    const url = URL.createObjectURL(exported.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const confirmDeleteLibrary = async (force = false): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    try {
      await api.deleteLibrary(selectedLibrary.id, force ? { force: true } : undefined);
      setDeleteLibraryDialog({ open: false, canForce: false, message: "" });
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to delete library";
      setDeleteLibraryDialog({
        open: true,
        canForce: !force,
        message: text,
      });
    }
  };

  const confirmDeleteElement = async (force = false): Promise<void> => {
    if (!selectedLibrary || !deleteElementDialog.element) {
      return;
    }
    try {
      await api.deleteLibraryElement(
        selectedLibrary.id,
        deleteElementDialog.element.id,
        force ? { force: true } : undefined,
      );
      setDeleteElementDialog({ open: false, element: null, canForce: false, usagePreview: [], message: "" });
      await refresh();
    } catch (error) {
      const apiError = error as ApiErrorWithDetails;
      if (!force && apiError.status === 409) {
        const usage =
          (apiError.details && typeof apiError.details === "object" && "usage" in apiError.details
            ? (apiError.details as { usage?: Array<{ screenName?: string; path?: string }> }).usage
            : undefined) ?? [];
        const usagePreview = usage
          .slice(0, 5)
          .map((item) => `${item.screenName ?? "Screen"}: ${item.path ?? "unknown path"}`);
        setDeleteElementDialog((prev) => ({
          ...prev,
          open: true,
          canForce: true,
          usagePreview,
          message: usage.length > 0
            ? `Element is used by ${usage.length} object(s).`
            : "Element is used in project.",
        }));
        return;
      }
      setDeleteElementDialog((prev) => ({
        ...prev,
        open: true,
        canForce: !force,
        message: apiError.message || "Failed to delete element",
      }));
    }
  };

  const saveMetadata = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    await api.updateLibrary(selectedLibrary.id, {
      name: metadataName.trim(),
      description: metadataDescription,
      version: metadataVersion.trim() || "1.0.0",
    });
    await refresh();
  };

  const addProjectMacroToLibrary = async (): Promise<void> => {
    if (!selectedLibrary || !selectedProjectMacroId) {
      return;
    }
    const macro = projectMacros.find((item) => item.id === selectedProjectMacroId);
    if (!macro) {
      return;
    }
    await api.createLibraryMacro(selectedLibrary.id, macro);
    await refresh();
  };

  const importMacroToProject = async (macroId: string): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    try {
      await api.importLibraryMacroToProject(selectedLibrary.id, macroId);
    } catch {
      await api.importLibraryMacroToProject(selectedLibrary.id, macroId, { overwrite: true });
    }
  };

  const importAllMacrosToProject = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    await api.importAllLibraryMacrosToProject(selectedLibrary.id, { overwrite: false });
  };

  const deleteMacroFromLibrary = async (macroId: string): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    await api.deleteLibraryMacro(selectedLibrary.id, macroId);
    await refresh();
  };

  const saveElementPatch = async (element: LibraryElement, patch: Partial<LibraryElement>): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    setSavingInterface(true);
    setInterfaceError(null);
    try {
      await api.updateLibraryElement(selectedLibrary.id, element.id, patch);
      await refresh();
    } catch (error) {
      setInterfaceError(error instanceof Error ? error.message : "Failed to save interface.");
    } finally {
      setSavingInterface(false);
    }
  };

  const startCreateSignal = () => {
    if (!selectedElement) {
      return;
    }
    const keyBase = createSignalKey(`signal_${(selectedElement.bindings?.length ?? 0) + 1}`);
    setSignalDialog({
      open: true,
      mode: "create",
      draft: {
        id: createId("binding"),
        key: keyBase,
        displayName: "",
        kind: "state",
        dataType: "BOOL",
        required: false,
        description: "",
      },
      keyEditedManually: false,
    });
  };

  const startEditSignal = (signal: ElementBindingDefinition) => {
    setSignalDialog({
      open: true,
      mode: "edit",
      originalKey: signal.key,
      draft: {
        ...signal,
        description: signal.description ?? "",
        required: signal.required ?? false,
      },
      keyEditedManually: true,
    });
  };

  const validateSignalDraft = (draft: ElementBindingDefinition, mode: "create" | "edit", originalKey?: string): string | null => {
    if (!selectedElement) {
      return "No selected element.";
    }
    if (!draft.displayName.trim()) {
      return "Display name is required.";
    }
    if (!draft.key.trim()) {
      return "Key is required.";
    }
    if (!/^[a-zA-Z0-9_]+$/.test(draft.key.trim())) {
      return "Key supports only letters, numbers, underscore.";
    }
    const duplicate = (selectedElement.bindings ?? []).some((binding) => binding.key === draft.key && (mode !== "edit" || binding.key !== originalKey));
    if (duplicate) {
      return "Signal key must be unique in this element.";
    }
    return null;
  };

  const applySignalUpdate = async ({
    oldKey,
    draft,
    migrateAssignments,
  }: {
    oldKey: string | null;
    draft: ElementBindingDefinition;
    migrateAssignments: boolean;
  }) => {
    if (!selectedElement) {
      return;
    }

    const oldBindings = selectedElement.bindings ?? [];
    const nextBindings = oldKey
      ? oldBindings.map((binding) => (binding.key === oldKey ? draft : binding))
      : [...oldBindings, draft];

    const keyChanged = Boolean(oldKey && oldKey !== draft.key);

    const nextStateRules = keyChanged
      ? (selectedElement.stateRules ?? []).map((rule) => replaceRuleSignalKey(rule, oldKey!, draft.key))
      : (selectedElement.stateRules ?? []);

    if (keyChanged && project && onUpdateProjectJson && migrateAssignments && selectedLibrary) {
      const migrated = mutateProjectInstanceAssignments(project, selectedLibrary.id, selectedElement.id, (assignments) => {
        const oldAssignment = assignments[oldKey!];
        if (!oldAssignment) {
          return { changed: false, nextAssignments: assignments };
        }
        const nextAssignments = { ...assignments };
        if (nextAssignments[draft.key] === undefined) {
          nextAssignments[draft.key] = oldAssignment;
        }
        delete nextAssignments[oldKey!];
        return { changed: true, nextAssignments };
      });
      if (migrated.changedInstances > 0) {
        onUpdateProjectJson(migrated.nextProject);
      }
    }

    await saveElementPatch(selectedElement, {
      bindings: nextBindings,
      stateRules: nextStateRules,
    });

    setSignalDialog((prev) => ({ ...prev, open: false }));
    setSignalKeyMigrationDialog((prev) => ({ ...prev, open: false }));
  };

  const saveSignalDialog = async () => {
    if (!selectedElement) {
      return;
    }
    const draft = {
      ...signalDialog.draft,
      key: signalDialog.draft.key.trim(),
      displayName: signalDialog.draft.displayName.trim(),
      description: (signalDialog.draft.description ?? "").trim(),
      id: signalDialog.draft.id || createId("binding"),
    };
    const validationError = validateSignalDraft(draft, signalDialog.mode, signalDialog.originalKey);
    if (validationError) {
      setSignalDialog((prev) => ({ ...prev, validationError }));
      return;
    }

    if (signalDialog.mode === "edit" && signalDialog.originalKey && signalDialog.originalKey !== draft.key) {
      setSignalKeyMigrationDialog({
        open: true,
        oldKey: signalDialog.originalKey,
        draft,
      });
      return;
    }

    await applySignalUpdate({
      oldKey: signalDialog.mode === "edit" ? signalDialog.originalKey ?? null : null,
      draft,
      migrateAssignments: false,
    });
  };

  const startDeleteSignal = (signal: ElementBindingDefinition) => {
    if (!selectedElement || !selectedLibrary) {
      return;
    }
    const referencedRuleCount = (selectedElement.stateRules ?? []).filter((rule) => ruleReferencesSignalKey(rule, signal.key)).length;
    const usedByInstancesCount = countSignalAssignmentsInProject(project, selectedLibrary.id, selectedElement.id, signal.key);
    setSignalDeleteDialog({
      open: true,
      signal,
      referencedRuleCount,
      usedByInstancesCount,
    });
  };

  const confirmDeleteSignal = async () => {
    if (!selectedElement || !selectedLibrary || !signalDeleteDialog.signal) {
      return;
    }
    const signal = signalDeleteDialog.signal;
    const nextBindings = (selectedElement.bindings ?? []).filter((binding) => binding.key !== signal.key);
    const nextRules = (selectedElement.stateRules ?? []).filter((rule) => !ruleReferencesSignalKey(rule, signal.key));

    if (project && onUpdateProjectJson) {
      const cleaned = mutateProjectInstanceAssignments(project, selectedLibrary.id, selectedElement.id, (assignments) => {
        if (!(signal.key in assignments)) {
          return { changed: false, nextAssignments: assignments };
        }
        const nextAssignments = { ...assignments };
        delete nextAssignments[signal.key];
        return { changed: true, nextAssignments };
      });
      if (cleaned.changedInstances > 0) {
        onUpdateProjectJson(cleaned.nextProject);
      }
    }

    await saveElementPatch(selectedElement, {
      bindings: nextBindings,
      stateRules: nextRules,
    });
    setSignalDeleteDialog({ open: false, signal: null, referencedRuleCount: 0, usedByInstancesCount: 0 });
  };

  const startCreateVisualRule = () => {
    if (!selectedElement) {
      return;
    }
    const signalKey = selectedElement.bindings?.[0]?.key ?? "";
    const defaultObject = flatElementObjects[0]?.id ?? "";
    setVisualRuleDialog({
      open: true,
      mode: "create",
      signalKey,
      condition: "true",
      value: "",
      value2: "",
      actions: defaultObject
        ? [{ id: createId("action"), objectId: defaultObject, type: "fill", value: "#00ff00" }]
        : [],
    });
  };

  const startEditVisualRule = (ruleId: string) => {
    const card = visualRuleCards.find((item) => item.ruleId === ruleId);
    if (!card || !card.editable) {
      return;
    }
    const condition = card.condition.type;
    const value =
      condition === "equals" || condition === "notEquals" || condition === "greaterThan" || condition === "lessThan"
        ? String((card.condition as { value?: unknown }).value ?? "")
        : "";
    const value2 = condition === "between" ? String((card.condition as { min: number; max: number }).max ?? "") : "";

    setVisualRuleDialog({
      open: true,
      mode: "edit",
      editingRuleId: card.ruleId,
      signalKey: card.signalKey,
      condition,
      value,
      value2,
      actions: card.actions.map((action) => toVisualActionDraft(action)),
    });
  };

  const validateVisualRuleDialog = (): string | null => {
    if (!selectedElement) {
      return "No selected element.";
    }
    if (!visualRuleDialog.signalKey) {
      return "Select a Signal.";
    }
    if ((selectedElement.bindings ?? []).every((binding) => binding.key !== visualRuleDialog.signalKey)) {
      return "Selected Signal no longer exists.";
    }
    if (visualRuleDialog.actions.length === 0) {
      return "Add at least one action.";
    }
    if (visualRuleDialog.actions.some((action) => !action.objectId)) {
      return "Choose object for each action.";
    }
    if ((visualRuleDialog.condition === "greaterThan" || visualRuleDialog.condition === "lessThan" || visualRuleDialog.condition === "between")
      && !Number.isFinite(Number(visualRuleDialog.value))) {
      return "Condition value must be a number.";
    }
    if (visualRuleDialog.condition === "between" && !Number.isFinite(Number(visualRuleDialog.value2))) {
      return "Max value must be a number.";
    }
    return null;
  };

  const saveVisualRuleDialog = async () => {
    if (!selectedElement) {
      return;
    }

    const validationError = validateVisualRuleDialog();
    if (validationError) {
      setVisualRuleDialog((prev) => ({ ...prev, validationError }));
      return;
    }

    const condition: ElementStateCase["condition"] = (() => {
      if (visualRuleDialog.condition === "true" || visualRuleDialog.condition === "false") {
        return { type: visualRuleDialog.condition };
      }
      if (visualRuleDialog.condition === "equals" || visualRuleDialog.condition === "notEquals") {
        return { type: visualRuleDialog.condition, value: parseScalarToken(visualRuleDialog.value) };
      }
      if (visualRuleDialog.condition === "greaterThan" || visualRuleDialog.condition === "lessThan") {
        return { type: visualRuleDialog.condition, value: Number(visualRuleDialog.value) };
      }
      return {
        type: "between",
        min: Number(visualRuleDialog.value),
        max: Number(visualRuleDialog.value2),
      };
    })();

    const nextRule: NonNullable<LibraryElement["stateRules"]>[number] = {
      id: visualRuleDialog.mode === "edit" ? visualRuleDialog.editingRuleId || createId("rule") : createId("rule"),
      name: visualRuleDialog.mode === "edit" ? "Visual Rule" : `Visual Rule ${(selectedElement.stateRules?.length ?? 0) + 1}`,
      source: {
        type: "tag",
        value: `$binding.${visualRuleDialog.signalKey}`,
      },
      cases: [
        {
          id: createId("case"),
          name: "when",
          condition,
          actions: visualRuleDialog.actions.map((action) => fromVisualActionDraft(action)),
        },
      ],
    };

    const existingRules = selectedElement.stateRules ?? [];
    const nextRules = visualRuleDialog.mode === "edit"
      ? existingRules.map((rule) => (rule.id === visualRuleDialog.editingRuleId ? nextRule : rule))
      : [...existingRules, nextRule];

    await saveElementPatch(selectedElement, { stateRules: nextRules });
    setVisualRuleDialog({
      open: false,
      mode: "create",
      signalKey: "",
      condition: "true",
      value: "",
      value2: "",
      actions: [],
    });
  };

  const startDeleteVisualRule = (ruleId: string, title: string) => {
    setVisualRuleDeleteDialog({
      open: true,
      ruleId,
      title,
    });
  };

  const confirmDeleteVisualRule = async () => {
    if (!selectedElement) {
      return;
    }
    const nextRules = (selectedElement.stateRules ?? []).filter((rule) => rule.id !== visualRuleDeleteDialog.ruleId);
    await saveElementPatch(selectedElement, { stateRules: nextRules });
    setVisualRuleDeleteDialog({ open: false, ruleId: "", title: "" });
  };

  return (
    <div className="screen-editor-window-content screen-editor-libraries-window">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.webscada-library.zip"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void onImportFileSelected(file);
          }
        }}
      />

      <WorkbenchSection title="LIBRARY TOOLBAR">
        <div style={{ padding: "0 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <WorkbenchButton onClick={() => void onCreateLibrary()}>Create</WorkbenchButton>
          <WorkbenchButton onClick={triggerImportDialog}>Import</WorkbenchButton>
          <WorkbenchButton onClick={() => void exportSelectedLibrary()} disabled={!selectedLibrary}>Export</WorkbenchButton>
          <WorkbenchButton
            variant="danger"
            onClick={() => setDeleteLibraryDialog({
              open: true,
              canForce: false,
              message: selectedLibrary ? `Delete library "${selectedLibrary.name}"?` : "Delete selected library?",
            })}
            disabled={!selectedLibrary}
          >
            Delete
          </WorkbenchButton>
          <WorkbenchButton onClick={() => void refresh()}>Refresh</WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="CREATE LIBRARY">
        <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
          <input
            className="workbench-input"
            value={libraryId}
            onChange={(event) => onLibraryIdChange(event.target.value)}
            placeholder="Library ID"
          />
          <input
            className="workbench-input"
            value={libraryName}
            onChange={(event) => onLibraryNameChange(event.target.value)}
            placeholder="Library name"
          />
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="LIBRARIES">
        <div className="screen-editor-library-list">
          {libraries.map((library) => {
            const isAttached = attachedIds.has(library.id);
            return (
              <div
                key={library.id}
                className="screen-editor-library-item"
                onClick={() => setSelectedLibraryId(library.id)}
                style={{ outline: selectedLibraryId === library.id ? "1px solid #4e8ff0" : undefined, cursor: "pointer" }}
              >
                <div className="screen-editor-item-title">{library.name}</div>
                <div className="screen-editor-item-meta">
                  {library.id} | v{library.version} | {library.elements.length} elements | {library.assets.length} assets | {(library.macros ?? []).length} macros
                </div>
                <div className="screen-editor-item-actions">
                  {isAttached ? (
                    <WorkbenchButton onClick={() => void onDetachLibrary(library.id)}>Detach</WorkbenchButton>
                  ) : (
                    <WorkbenchButton variant="primary" onClick={() => void onAttachLibrary(library.id)}>Attach</WorkbenchButton>
                  )}
                  <WorkbenchButton onClick={() => setSelectedLibraryId(library.id)}>Open</WorkbenchButton>
                </div>
              </div>
            );
          })}
        </div>
      </WorkbenchSection>

      {importFile ? (
        <WorkbenchSection title="IMPORT VALIDATION">
          <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
            <div className="screen-editor-item-meta">File: {importFile.name}</div>
            <div className="screen-editor-item-meta">{isValidating ? "Validating library archive..." : validation?.valid ? "Archive is valid" : "Archive is invalid"}</div>
            {validation?.errors?.map((item) => (
              <div key={`err-${item.code}-${item.path ?? ""}`} className="screen-editor-item-meta" style={{ color: "#ff9c9c" }}>
                {item.message}{item.path ? ` (${item.path})` : ""}
              </div>
            ))}
            {validation?.warnings?.map((item) => (
              <div key={`warn-${item.code}-${item.path ?? ""}`} className="screen-editor-item-meta" style={{ color: "#f5d283" }}>
                {item.message}{item.path ? ` (${item.path})` : ""}
              </div>
            ))}
            {validation?.valid ? (
              <>
                <label className="screen-editor-item-meta"><input type="checkbox" checked={replaceLibrary} onChange={(event) => setReplaceLibrary(event.target.checked)} /> Replace existing library</label>
                <label className="screen-editor-item-meta"><input type="checkbox" checked={importAsCopy} onChange={(event) => setImportAsCopy(event.target.checked)} /> Import as copy</label>
                <label className="screen-editor-item-meta"><input type="checkbox" checked={importMacrosToProject} onChange={(event) => setImportMacrosToProject(event.target.checked)} /> Import macros to project</label>
                <select className="workbench-select" value={macroConflictMode} onChange={(event) => setMacroConflictMode(event.target.value as "skip" | "overwrite" | "copy")}>
                  <option value="skip">Skip macro conflicts</option>
                  <option value="overwrite">Overwrite macro conflicts</option>
                  <option value="copy">Import macro conflicts as copies</option>
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <WorkbenchButton variant="primary" onClick={() => void confirmImport()}>Confirm Import</WorkbenchButton>
                  <WorkbenchButton onClick={() => { setImportFile(null); setValidation(null); }}>Cancel</WorkbenchButton>
                </div>
              </>
            ) : null}
          </div>
        </WorkbenchSection>
      ) : null}

      {selectedLibrary ? (
        <WorkbenchSection title="LIBRARY DETAILS">
          <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <WorkbenchButton onClick={() => setActiveTab("elements")}>Elements</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("interface")}>Interface</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("assets")}>Assets</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("macros")}>Macros</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("metadata")}>Metadata</WorkbenchButton>
            </div>

            {activeTab === "elements" ? (
              <div className="screen-editor-library-element-list">
                {!attachedIds.has(selectedLibrary.id) ? (
                  <div className="screen-editor-item-meta">Attach library to add elements to screen.</div>
                ) : null}
                {(selectedLibrary.elements ?? []).map((element) => (
                  <div
                    key={element.id}
                    className="screen-editor-library-element-item"
                    style={{ outline: selectedElementId === element.id ? "1px solid #4e8ff0" : undefined, cursor: "pointer" }}
                    onClick={() => setSelectedElementId(element.id)}
                  >
                    <div className="screen-editor-item-title">{element.name}</div>
                    <div className="screen-editor-item-meta">
                      {element.category ?? "General"} · {formatOneDecimal(element.width)}x{formatOneDecimal(element.height)}
                    </div>
                    {element.description?.trim() ? (
                      <div className="screen-editor-item-meta">{element.description.trim()}</div>
                    ) : null}
                  </div>
                ))}
                {selectedElement ? (
                  <div className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">Selected: {selectedElement.name}</div>
                    <div className="screen-editor-item-meta">Canvas selection: {selectedObjectsCount} object(s)</div>
                    <div className="screen-editor-item-actions">
                      <WorkbenchButton
                        variant="primary"
                        disabled={!attachedIds.has(selectedLibrary.id)}
                        onClick={() => onAddLibraryElementToScreen(selectedLibrary.id, selectedElement)}
                      >
                        Add to Screen
                      </WorkbenchButton>
                      <WorkbenchButton
                        disabled={selectedObjectsCount === 0}
                        onClick={() => void onUpdateLibraryElementFromSelection(selectedLibrary.id, selectedElement)}
                      >
                        Update from Selection
                      </WorkbenchButton>
                      <WorkbenchButton
                        disabled={selectedObjectsCount === 0}
                        onClick={() => void onSaveLibraryElementCopyFromSelection(selectedLibrary.id, selectedElement)}
                      >
                        Save as Copy
                      </WorkbenchButton>
                      <WorkbenchButton
                        variant="danger"
                        onClick={() => setDeleteElementDialog({
                          open: true,
                          element: selectedElement,
                          canForce: false,
                          usagePreview: [],
                          message: `Delete element "${selectedElement.name}" from library "${selectedLibrary.name}"?`,
                        })}
                      >
                        Delete
                      </WorkbenchButton>
                    </div>
                  </div>
                ) : (
                  <div className="screen-editor-item-meta">Select an element to see actions.</div>
                )}
              </div>
            ) : null}

            {activeTab === "interface" ? (
              <div className="screen-editor-library-interface">
                {!selectedElement ? (
                  <div className="screen-editor-item-meta">Select an element to edit its interface.</div>
                ) : (
                  <>
                    <div className="screen-editor-library-element-item">
                      <div className="screen-editor-item-title">{selectedElement.name}</div>
                      <div className="screen-editor-item-meta">Element id: {selectedElement.id}</div>
                      <div className="screen-editor-item-meta">Element key: {selectedElement.elementKey ?? "-"}</div>
                      <div className="screen-editor-item-meta">Size: {formatOneDecimal(selectedElement.width)} x {formatOneDecimal(selectedElement.height)}</div>
                      <div className="screen-editor-item-meta">Internal objects: {flatElementObjects.length}</div>
                      <div className="screen-editor-item-meta">Signals: {selectedElement.bindings?.length ?? 0}</div>
                      <div className="screen-editor-item-meta">Visual Rules: {selectedElement.stateRules?.length ?? 0}</div>
                      <div className="screen-editor-item-meta">Parameters: {selectedElement.parameters?.length ?? 0}</div>
                    </div>

                    <div className="screen-editor-item-meta">
                      Signals define external tag inputs for this library element. Visual Rules define how these signals change internal objects.
                      When this element is placed on a screen, users map only these signals to real tags.
                    </div>

                    {interfaceError ? <div className="screen-editor-library-interface__error">{interfaceError}</div> : null}

                    <div className="screen-editor-library-interface__section">
                      <div className="screen-editor-library-interface__section-title">SIGNALS</div>
                      <div>
                        <WorkbenchButton onClick={startCreateSignal} disabled={savingInterface}>Add Signal</WorkbenchButton>
                      </div>
                      {(selectedElement.bindings ?? []).length === 0 ? (
                        <div className="screen-editor-item-meta">No Signals yet.</div>
                      ) : (
                        (selectedElement.bindings ?? []).map((signal) => (
                          <div key={signal.id} className="screen-editor-signal-card">
                            <div className="screen-editor-item-title">{signal.displayName}</div>
                            <div className="screen-editor-item-meta">key: {signal.key}</div>
                            <div className="screen-editor-item-meta">type: {signal.dataType ?? "-"}</div>
                            <div className="screen-editor-item-meta">used in rules: {signalUsedInRulesCount.get(signal.key) ?? 0}</div>
                            {selectedLibrary ? (
                              <div className="screen-editor-item-meta">
                                used by instances: {countSignalAssignmentsInProject(project, selectedLibrary.id, selectedElement.id, signal.key)}
                              </div>
                            ) : null}
                            <div className="screen-editor-item-actions">
                              <WorkbenchButton onClick={() => startEditSignal(signal)} disabled={savingInterface}>Edit</WorkbenchButton>
                              <WorkbenchButton variant="danger" onClick={() => startDeleteSignal(signal)} disabled={savingInterface}>Delete</WorkbenchButton>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="screen-editor-library-interface__section">
                      <div className="screen-editor-library-interface__section-title">VISUAL RULES</div>
                      <div>
                        <WorkbenchButton onClick={startCreateVisualRule} disabled={savingInterface || (selectedElement.bindings?.length ?? 0) === 0}>
                          Add Visual Rule
                        </WorkbenchButton>
                      </div>
                      {visualRuleCards.length === 0 ? (
                        <div className="screen-editor-item-meta">No Visual Rules yet.</div>
                      ) : (
                        visualRuleCards.map((rule) => (
                          <div key={rule.ruleId} className="screen-editor-visual-rule-card">
                            <div className="screen-editor-item-title">{rule.name || "Visual Rule"}</div>
                            <div className="screen-editor-item-meta">Signal: {rule.signalKey || "-"}</div>
                            <div className="screen-editor-item-meta">Condition: {describeCondition(rule.condition)}</div>
                            <div className="screen-editor-item-meta">Actions:</div>
                            <div className="screen-editor-library-interface__rule-actions">
                              {rule.actions.map((action, index) => (
                                <div key={`${rule.ruleId}-act-${index}`} className="screen-editor-item-meta">- {describeAction(action)}</div>
                              ))}
                            </div>
                            {!rule.editable ? (
                              <div className="screen-editor-item-meta" style={{ color: "#f5d283" }}>
                                Complex rule: {rule.reason}
                              </div>
                            ) : null}
                            <div className="screen-editor-item-actions">
                              <WorkbenchButton onClick={() => startEditVisualRule(rule.ruleId)} disabled={!rule.editable || savingInterface}>Edit</WorkbenchButton>
                              <WorkbenchButton variant="danger" onClick={() => startDeleteVisualRule(rule.ruleId, rule.name || "Visual Rule")} disabled={savingInterface}>Delete</WorkbenchButton>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {activeTab === "assets" ? (
              <div className="screen-editor-library-element-list">
                {(selectedLibrary.assets ?? []).map((asset) => (
                  <div key={asset.id} className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">{asset.name}</div>
                    <div className="screen-editor-item-meta">{asset.fileName} · {asset.mimeType}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "macros" ? (
              <div className="screen-editor-library-element-list">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <select className="workbench-select" value={selectedProjectMacroId} onChange={(event) => setSelectedProjectMacroId(event.target.value)}>
                    <option value="">Select project macro</option>
                    {projectMacros.map((macro) => (
                      <option key={macro.id} value={macro.id}>{macro.name}</option>
                    ))}
                  </select>
                  <WorkbenchButton onClick={() => void addProjectMacroToLibrary()}>Add Project Macro</WorkbenchButton>
                  <WorkbenchButton onClick={() => void importAllMacrosToProject()}>Import All</WorkbenchButton>
                </div>
                {(selectedLibrary.macros ?? []).map((macro) => (
                  <div key={macro.id} className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">{macro.name}</div>
                    <div className="screen-editor-item-meta">{macro.id} · {macro.enabled === false ? "disabled" : "enabled"}</div>
                    <div className="screen-editor-item-actions">
                      <WorkbenchButton onClick={() => void importMacroToProject(macro.id)}>Import To Project</WorkbenchButton>
                      <WorkbenchButton onClick={() => void deleteMacroFromLibrary(macro.id)}>Delete</WorkbenchButton>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "metadata" ? (
              <div style={{ display: "grid", gap: 6 }}>
                <input className="workbench-input" value={metadataName} onChange={(event) => setMetadataName(event.target.value)} placeholder="Name" />
                <input className="workbench-input" value={metadataVersion} onChange={(event) => setMetadataVersion(event.target.value)} placeholder="Version" />
                <textarea className="workbench-input" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} placeholder="Description" style={{ minHeight: 72 }} />
                <WorkbenchButton variant="primary" onClick={() => void saveMetadata()}>Save Metadata</WorkbenchButton>
              </div>
            ) : null}
          </div>
        </WorkbenchSection>
      ) : null}

      <WorkbenchDialog
        title="Delete Library"
        open={deleteLibraryDialog.open}
        onClose={() => setDeleteLibraryDialog({ open: false, canForce: false, message: "" })}
        width={520}
        actions={(
          <>
            <WorkbenchButton onClick={() => setDeleteLibraryDialog({ open: false, canForce: false, message: "" })}>Cancel</WorkbenchButton>
            {deleteLibraryDialog.canForce ? (
              <WorkbenchButton variant="danger" onClick={() => void confirmDeleteLibrary(true)}>Force Delete</WorkbenchButton>
            ) : null}
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteLibrary(false)}>Delete</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">{deleteLibraryDialog.message}</div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Delete Element"
        open={deleteElementDialog.open}
        onClose={() => setDeleteElementDialog({ open: false, element: null, canForce: false, usagePreview: [], message: "" })}
        width={620}
        actions={(
          <>
            <WorkbenchButton onClick={() => setDeleteElementDialog({ open: false, element: null, canForce: false, usagePreview: [], message: "" })}>Cancel</WorkbenchButton>
            {deleteElementDialog.canForce ? (
              <WorkbenchButton variant="danger" onClick={() => void confirmDeleteElement(true)}>Force Delete</WorkbenchButton>
            ) : null}
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteElement(false)}>Delete</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">{deleteElementDialog.message}</div>
        {deleteElementDialog.usagePreview.length ? (
          <div className="screen-editor-library-interface__warning">
            {deleteElementDialog.usagePreview.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </WorkbenchDialog>

      <WorkbenchDialog
        title={signalDialog.mode === "create" ? "Add Signal" : "Edit Signal"}
        open={signalDialog.open}
        onClose={() => setSignalDialog((prev) => ({ ...prev, open: false }))}
        width={560}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSignalDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void saveSignalDialog()} disabled={savingInterface}>Save</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-library-interface__dialog-grid">
          <label>
            <span>Display name</span>
            <input
              className="workbench-input"
              value={signalDialog.draft.displayName}
              onChange={(event) => {
                const displayName = event.target.value;
                setSignalDialog((prev) => {
                  const nextKey = prev.mode === "create" && !prev.keyEditedManually
                    ? createSignalKey(displayName)
                    : prev.draft.key;
                  return {
                    ...prev,
                    validationError: undefined,
                    draft: {
                      ...prev.draft,
                      displayName,
                      key: nextKey,
                    },
                  };
                });
              }}
            />
          </label>
          <label>
            <span>Key</span>
            <input
              className="workbench-input"
              value={signalDialog.draft.key}
              onChange={(event) => {
                setSignalDialog((prev) => ({
                  ...prev,
                  keyEditedManually: true,
                  validationError: undefined,
                  draft: {
                    ...prev.draft,
                    key: event.target.value,
                  },
                }));
              }}
            />
          </label>
          <label>
            <span>Data type</span>
            <select
              className="workbench-select"
              value={signalDialog.draft.dataType ?? "BOOL"}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  dataType: event.target.value as NonNullable<ElementBindingDefinition["dataType"]>,
                },
              }))}
            >
              {DATA_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>Description</span>
            <input
              className="workbench-input"
              value={signalDialog.draft.description ?? ""}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  description: event.target.value,
                },
              }))}
            />
          </label>
          <label className="screen-editor-library-interface__checkbox">
            <input
              type="checkbox"
              checked={Boolean(signalDialog.draft.required)}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  required: event.target.checked,
                },
              }))}
            />
            Required
          </label>
        </div>
        {signalDialog.validationError ? <div className="screen-editor-library-interface__error">{signalDialog.validationError}</div> : null}
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Delete Signal"
        open={signalDeleteDialog.open}
        onClose={() => setSignalDeleteDialog({ open: false, signal: null, referencedRuleCount: 0, usedByInstancesCount: 0 })}
        width={520}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSignalDeleteDialog({ open: false, signal: null, referencedRuleCount: 0, usedByInstancesCount: 0 })}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteSignal()} disabled={savingInterface}>Remove Signal</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">Signal: {signalDeleteDialog.signal?.displayName}</div>
        <div className="screen-editor-item-meta">Key: {signalDeleteDialog.signal?.key}</div>
        <div className="screen-editor-item-meta">Referenced visual rules: {signalDeleteDialog.referencedRuleCount}</div>
        <div className="screen-editor-item-meta">Instance mappings: {signalDeleteDialog.usedByInstancesCount}</div>
        <div className="screen-editor-library-interface__warning">
          This signal may be used by existing instances. Remove this signal and clear corresponding mappings from all instances?
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Signal Key Changed"
        open={signalKeyMigrationDialog.open}
        onClose={() => setSignalKeyMigrationDialog((prev) => ({ ...prev, open: false }))}
        width={620}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSignalKeyMigrationDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton onClick={() => void applySignalUpdate({ oldKey: signalKeyMigrationDialog.oldKey, draft: signalKeyMigrationDialog.draft, migrateAssignments: false })}>
              Keep as New Signal
            </WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void applySignalUpdate({ oldKey: signalKeyMigrationDialog.oldKey, draft: signalKeyMigrationDialog.draft, migrateAssignments: true })}>
              Migrate Mappings
            </WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">
          Signal key changed from <strong>{signalKeyMigrationDialog.oldKey}</strong> to <strong>{signalKeyMigrationDialog.draft.key}</strong>.
        </div>
        <div className="screen-editor-item-meta">Migrate existing instance tag mappings?</div>
        <div className="screen-editor-library-interface__warning">
          Keep as New Signal will keep old instance mappings unchanged. They may become obsolete under Advanced.
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title={visualRuleDialog.mode === "create" ? "Add Visual Rule" : "Edit Visual Rule"}
        open={visualRuleDialog.open}
        onClose={() => setVisualRuleDialog((prev) => ({ ...prev, open: false }))}
        width={760}
        actions={(
          <>
            <WorkbenchButton onClick={() => setVisualRuleDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void saveVisualRuleDialog()} disabled={savingInterface}>Save</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-library-interface__dialog-grid">
          <label>
            <span>Signal</span>
            <select
              className="workbench-select"
              value={visualRuleDialog.signalKey}
              onChange={(event) => setVisualRuleDialog((prev) => ({ ...prev, signalKey: event.target.value, validationError: undefined }))}
            >
              <option value="">Select signal</option>
              {(selectedElement?.bindings ?? []).map((binding) => (
                <option key={binding.id} value={binding.key}>{binding.displayName} ({binding.key})</option>
              ))}
            </select>
          </label>
          <label>
            <span>Condition</span>
            <select
              className="workbench-select"
              value={visualRuleDialog.condition}
              onChange={(event) => setVisualRuleDialog((prev) => ({
                ...prev,
                condition: event.target.value as VisualRuleConditionType,
                validationError: undefined,
              }))}
            >
              <option value="true">true</option>
              <option value="false">false</option>
              <option value="equals">equals</option>
              <option value="notEquals">notEquals</option>
              <option value="greaterThan">greaterThan</option>
              <option value="lessThan">lessThan</option>
              <option value="between">between</option>
            </select>
          </label>
          {visualRuleDialog.condition !== "true" && visualRuleDialog.condition !== "false" ? (
            <label>
              <span>Value</span>
              <input
                className="workbench-input"
                value={visualRuleDialog.value}
                onChange={(event) => setVisualRuleDialog((prev) => ({ ...prev, value: event.target.value, validationError: undefined }))}
              />
            </label>
          ) : null}
          {visualRuleDialog.condition === "between" ? (
            <label>
              <span>Value 2</span>
              <input
                className="workbench-input"
                value={visualRuleDialog.value2}
                onChange={(event) => setVisualRuleDialog((prev) => ({ ...prev, value2: event.target.value, validationError: undefined }))}
              />
            </label>
          ) : null}
        </div>

        <div className="screen-editor-library-interface__section-title" style={{ marginTop: 8 }}>Then Actions</div>
        <div className="screen-editor-library-interface__rule-actions-editor">
          {visualRuleDialog.actions.map((action, index) => (
            <div key={action.id} className="screen-editor-library-interface__rule-action-row">
              <select
                className="workbench-select"
                value={action.objectId}
                onChange={(event) => setVisualRuleDialog((prev) => {
                  const nextActions = [...prev.actions];
                  const current = nextActions[index];
                  if (!current) {
                    return prev;
                  }
                  nextActions[index] = { ...current, objectId: event.target.value };
                  return { ...prev, actions: nextActions, validationError: undefined };
                })}
              >
                <option value="">Select object</option>
                {flatElementObjects.map((objectOption) => (
                  <option key={objectOption.id} value={objectOption.id}>{objectOption.label}</option>
                ))}
              </select>
              <select
                className="workbench-select"
                value={action.type}
                onChange={(event) => setVisualRuleDialog((prev) => {
                  const nextType = event.target.value as VisualRuleActionKind;
                  const nextActions = [...prev.actions];
                  const current = nextActions[index];
                  if (!current) {
                    return prev;
                  }
                  nextActions[index] = {
                    ...current,
                    type: nextType,
                    value: nextType === "visible" ? "true" : nextType === "fill" || nextType === "stroke" ? "#ffffff" : "",
                  };
                  return { ...prev, actions: nextActions, validationError: undefined };
                })}
              >
                <option value="visible">visible</option>
                <option value="asset">asset</option>
                <option value="text">text</option>
                <option value="fill">fill</option>
                <option value="stroke">stroke</option>
              </select>

              {action.type === "visible" ? (
                <select
                  className="workbench-select"
                  value={action.value}
                  onChange={(event) => setVisualRuleDialog((prev) => {
                    const nextActions = [...prev.actions];
                    const current = nextActions[index];
                    if (!current) {
                      return prev;
                    }
                    nextActions[index] = { ...current, value: event.target.value };
                    return { ...prev, actions: nextActions };
                  })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : null}

              {action.type === "asset" ? (
                <select
                  className="workbench-select"
                  value={action.value}
                  onChange={(event) => setVisualRuleDialog((prev) => {
                    const nextActions = [...prev.actions];
                    const current = nextActions[index];
                    if (!current) {
                      return prev;
                    }
                    nextActions[index] = { ...current, value: event.target.value };
                    return { ...prev, actions: nextActions };
                  })}
                >
                  <option value="">Select asset</option>
                  {(selectedLibrary?.assets ?? []).map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              ) : null}

              {action.type === "text" || action.type === "fill" || action.type === "stroke" ? (
                <input
                  className="workbench-input"
                  value={action.value}
                  type={action.type === "fill" || action.type === "stroke" ? "color" : "text"}
                  onChange={(event) => setVisualRuleDialog((prev) => {
                    const nextActions = [...prev.actions];
                    const current = nextActions[index];
                    if (!current) {
                      return prev;
                    }
                    nextActions[index] = { ...current, value: event.target.value };
                    return { ...prev, actions: nextActions };
                  })}
                />
              ) : null}

              <WorkbenchButton
                variant="danger"
                onClick={() => setVisualRuleDialog((prev) => ({
                  ...prev,
                  actions: prev.actions.filter((_, actionIndex) => actionIndex !== index),
                }))}
              >
                Delete
              </WorkbenchButton>
            </div>
          ))}
        </div>
        <WorkbenchButton
          onClick={() => setVisualRuleDialog((prev) => ({
            ...prev,
            actions: [...prev.actions, { id: createId("action"), objectId: flatElementObjects[0]?.id ?? "", type: "fill", value: "#ffffff" }],
          }))}
        >
          Add Action
        </WorkbenchButton>
        {visualRuleDialog.validationError ? <div className="screen-editor-library-interface__error">{visualRuleDialog.validationError}</div> : null}
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Delete Visual Rule"
        open={visualRuleDeleteDialog.open}
        onClose={() => setVisualRuleDeleteDialog({ open: false, ruleId: "", title: "" })}
        width={460}
        actions={(
          <>
            <WorkbenchButton onClick={() => setVisualRuleDeleteDialog({ open: false, ruleId: "", title: "" })}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteVisualRule()} disabled={savingInterface}>Delete</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">Delete visual rule "{visualRuleDeleteDialog.title}"?</div>
      </WorkbenchDialog>
    </div>
  );
}
