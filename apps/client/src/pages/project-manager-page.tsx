import { useMemo, useRef, useState } from "react";
import type {
  ArchiveConflictPreviewItem,
  ArchiveInspectionItem,
  ProjectArchiveInspectionResult,
  ScadaProject,
  ScreenArchiveDependencyMode,
  ScreenArchiveImportOptions,
} from "@web-scada/shared";
import { message } from "antd";
import {
  WorkbenchButton,
  WorkbenchConfirmDialog,
  WorkbenchDangerZone,
  WorkbenchFilePickerRow,
  WorkbenchInput,
  WorkbenchSection,
  WorkbenchSelect,
  WorkbenchStatusBlock,
  WorkbenchTable,
  WorkbenchTabs,
  type WorkbenchStatusRow,
  type WorkbenchTabItem,
  type WorkbenchTableColumn,
} from "../components/workbench";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";

type ArchiveFileSlot = "project" | "screenZip" | "screenProject" | "libraryZip" | "libraryProject" | "macroProject" | "assetsProject";
type ProjectManagerTab = "project" | "screens" | "libraries" | "macros" | "assets" | "backups";
type MacroConflictMode = "keep-existing" | "replace" | "copy";
type LibraryConflictMode = "keep-existing" | "replace" | "copy";

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => Promise<void>;
};

type DetailRow = {
  label: string;
  value: string | number;
};

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function validationTitle(result: ProjectArchiveInspectionResult | null): string {
  if (!result) {
    return "Archive not checked yet";
  }
  return result.valid ? "Archive is valid" : "Archive is invalid";
}

function hasIssue(result: ProjectArchiveInspectionResult, codes: string[]): boolean {
  const codeSet = new Set(codes);
  return [...result.errors, ...result.warnings].some((issue) => codeSet.has(issue.code));
}

function signatureLabel(result: ProjectArchiveInspectionResult): string {
  if (hasIssue(result, ["ARCHIVE_SIGNATURE_MISMATCH", "INVALID_SIGNATURE", "INVALID_SIGNATURE_JSON"])) {
    return "failed";
  }
  if (result.authenticity?.verified) {
    return "verified";
  }
  if (result.authenticity?.signed) {
    return result.authenticity.required ? "failed" : "not required";
  }
  return result.authenticity?.required ? "failed" : "unsigned";
}

function checksumLabel(result: ProjectArchiveInspectionResult): string {
  if (result.checksum?.verified === false || hasIssue(result, ["CHECKSUM_MISMATCH", "SIZE_MISMATCH", "MANIFEST_FILE_MISSING"])) {
    return "failed";
  }
  return "verified";
}

function makeResetProject(project: ScadaProject): ScadaProject {
  const firstScreen = project.screens[0] ?? {
    id: "screen_1",
    name: "SCREEN 1",
    kind: "screen" as const,
    width: 1920,
    height: 1080,
    background: "#1e1e1e",
    objects: [],
  };
  return {
    version: project.version,
    name: `${project.name} Reset`,
    drivers: [],
    tags: [],
    screens: [{ ...firstScreen, id: "screen_1", name: "SCREEN 1", objects: [] }],
    startScreenId: "screen_1",
    assets: [],
    assetGroups: [],
    libraries: [],
    events: [],
    eventCategories: [],
    eventSounds: project.eventSounds,
    variables: [],
    macros: [],
    uiSettings: project.uiSettings,
    runtimeSettings: project.runtimeSettings,
    editorSettings: project.editorSettings,
  };
}

function makeCopyId(sourceId: string, taken: Set<string>): string {
  const base = `${sourceId}_copy`;
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; index < 10000; index += 1) {
    const next = `${base}_${index}`;
    if (!taken.has(next)) {
      return next;
    }
  }
  return `${base}_${Date.now()}`;
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function compactRows(rows: Array<WorkbenchStatusRow | false | null | undefined>): WorkbenchStatusRow[] {
  return rows.filter((row): row is WorkbenchStatusRow => Boolean(row));
}

function formatArchiveType(result: ProjectArchiveInspectionResult | null): string {
  if (!result) {
    return "-";
  }
  if (result.archiveType === "project") {
    return "Project ZIP";
  }
  if (result.archiveType === "screen") {
    return "Screen ZIP";
  }
  return result.summary?.format ?? "-";
}

function ProjectSummaryTable({ project }: { project: ScadaProject }) {
  const rows: DetailRow[] = [
    { label: "Project name", value: project.name },
    { label: "Screens", value: project.screens.length },
    { label: "Tags", value: project.tags.length },
    { label: "Assets", value: project.assets?.length ?? 0 },
    { label: "Libraries", value: project.libraries?.length ?? 0 },
    { label: "Macros", value: project.macros?.length ?? 0 },
    { label: "Events", value: project.events?.length ?? 0 },
  ];

  return (
    <WorkbenchTable
      rows={rows}
      getRowId={(row) => row.label}
      emptyText="Project summary is not available"
      columns={[
        { id: "label", title: "FIELD", width: "180px", render: (row) => row.label },
        { id: "value", title: "VALUE", width: "minmax(180px, 1fr)", render: (row) => row.value },
      ]}
    />
  );
}

function DetailTable({ rows, emptyText = "No details" }: { rows: DetailRow[]; emptyText?: string }) {
  return (
    <WorkbenchTable
      rows={rows}
      getRowId={(row) => row.label}
      emptyText={emptyText}
      columns={[
        { id: "label", title: "FIELD", width: "170px", render: (row) => row.label },
        { id: "value", title: "VALUE", width: "minmax(170px, 1fr)", render: (row) => row.value },
      ]}
    />
  );
}

function ArchiveStatusPanel({
  label,
  file,
  result,
}: {
  label: string;
  file: File | null;
  result: ProjectArchiveInspectionResult | null;
}) {
  if (!file) {
    return (
      <WorkbenchStatusBlock
        variant="info"
        title="No archive selected"
        description={`${label} No archive selected. Choose an archive, then validate it. Nothing is imported after file selection.`}
      />
    );
  }

  if (!result) {
    return (
      <WorkbenchStatusBlock
        variant="info"
        title="Archive not checked yet"
        description={`${label} ${file.name}. Validate this ZIP before import actions become available.`}
      />
    );
  }

  const summary = result.summary;
  const rows = compactRows([
    { label: "Archive type", value: formatArchiveType(result) },
    { label: "Project / screen name", value: summary?.name ?? "-" },
    { label: "Screens count", value: summary?.screens ?? result.screens.length },
    { label: "Libraries count", value: summary?.libraries ?? result.libraries.length },
    { label: "Macros count", value: summary?.macros ?? result.macros.length },
    { label: "Assets count", value: summary?.assets ?? result.assets.length },
    { label: "Tags count", value: summary?.tags ?? result.tags.length },
    { label: "Checksums", value: `Checksums: ${checksumLabel(result)}` },
    { label: "Signature", value: `Signature: ${signatureLabel(result)}` },
    result.dependencies ? { label: "Dependencies", value: `Assets ${result.dependencies.assets}, libraries ${result.dependencies.libraries}, macros ${result.dependencies.macros}, tags ${result.dependencies.tags}, events ${result.dependencies.events}` } : null,
  ]);

  return (
    <WorkbenchStatusBlock
      variant={result.valid ? "success" : "error"}
      title={validationTitle(result)}
      description={`${label} ${file.name}`}
      rows={rows}
    >
      {result.warnings.length > 0 ? (
        <div className="project-manager-issues project-manager-issues--warning">
          <div className="project-manager-issues__title">Warnings</div>
          {result.warnings.map((issue) => (
            <div key={`${issue.code}-${issue.path ?? issue.message}`} className="project-manager-issues__line">
              {issue.message}{issue.path ? ` (${issue.path})` : ""}
            </div>
          ))}
        </div>
      ) : null}
      {result.errors.length > 0 ? (
        <div className="project-manager-issues project-manager-issues--error">
          <div className="project-manager-issues__title">Errors</div>
          {result.errors.map((issue) => (
            <div key={`${issue.code}-${issue.path ?? issue.message}`} className="project-manager-issues__line">
              {issue.message}{issue.path ? ` (${issue.path})` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </WorkbenchStatusBlock>
  );
}

function ResourceTable({
  items,
  selectedIds,
  onSelectedIdsChange,
  emptyText,
}: {
  items: ArchiveInspectionItem[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  emptyText: string;
}) {
  return (
    <WorkbenchTable
      rows={items}
      getRowId={(item) => item.id}
      emptyText={emptyText}
      selectedIds={selectedIds}
      onToggleRow={(item) => onSelectedIdsChange(toggleId(selectedIds, item.id))}
      columns={[
        { id: "name", title: "NAME", width: "minmax(180px, 1fr)", render: (item) => item.name },
        { id: "id", title: "ID", width: "minmax(160px, 1fr)", render: (item) => item.id },
        { id: "kind", title: "KIND", width: "120px", render: (item) => item.kind ?? "-" },
        { id: "count", title: "COUNT", width: "80px", render: (item) => item.count ?? "-" },
      ]}
    />
  );
}

function ConflictPreview({ items }: { items: ArchiveConflictPreviewItem[] }) {
  if (items.length === 0) {
    return <WorkbenchStatusBlock variant="success" title="No conflicts detected for this selection" />;
  }

  return (
    <WorkbenchTable
      rows={items}
      getRowId={(item) => `${item.id}-${item.status}`}
      emptyText="No conflicts detected for this selection"
      columns={[
        { id: "name", title: "NAME", width: "minmax(180px, 1fr)", render: (item) => item.name },
        { id: "id", title: "ID", width: "minmax(160px, 1fr)", render: (item) => item.id },
        { id: "status", title: "STATUS", width: "150px", render: (item) => item.status },
        { id: "message", title: "MESSAGE", width: "minmax(220px, 1.5fr)", render: (item) => item.message },
      ]}
    />
  );
}

export function ProjectManagerPage() {
  const project = useScadaStore((s) => s.project);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadTags = useScadaStore((s) => s.loadTags);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);
  const loadMacros = useScadaStore((s) => s.loadMacros);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const assets = useScadaStore((s) => s.assets);
  const libraries = useScadaStore((s) => s.libraries);
  const macros = useScadaStore((s) => s.macros);

  const fileRefs = {
    project: useRef<HTMLInputElement | null>(null),
    screenZip: useRef<HTMLInputElement | null>(null),
    screenProject: useRef<HTMLInputElement | null>(null),
    libraryZip: useRef<HTMLInputElement | null>(null),
    libraryProject: useRef<HTMLInputElement | null>(null),
    macroProject: useRef<HTMLInputElement | null>(null),
    assetsProject: useRef<HTMLInputElement | null>(null),
  };
  const [activeTab, setActiveTab] = useState<ProjectManagerTab>("project");
  const [files, setFiles] = useState<Record<ArchiveFileSlot, File | null>>({
    project: null,
    screenZip: null,
    screenProject: null,
    libraryZip: null,
    libraryProject: null,
    macroProject: null,
    assetsProject: null,
  });
  const [inspections, setInspections] = useState<Record<ArchiveFileSlot, ProjectArchiveInspectionResult | null>>({
    project: null,
    screenZip: null,
    screenProject: null,
    libraryZip: null,
    libraryProject: null,
    macroProject: null,
    assetsProject: null,
  });
  const [selectedScreenId, setSelectedScreenId] = useState<string | undefined>(currentScreenId ?? project?.screens[0]?.id);
  const [screenMode, setScreenMode] = useState<ScreenArchiveImportOptions["mode"]>("add");
  const [dependencyMode, setDependencyMode] = useState<ScreenArchiveDependencyMode>("safe");
  const [archiveScreenIds, setArchiveScreenIds] = useState<string[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | undefined>(libraries[0]?.id);
  const [archiveLibraryIds, setArchiveLibraryIds] = useState<string[]>([]);
  const [libraryConflictMode, setLibraryConflictMode] = useState<LibraryConflictMode>("copy");
  const [selectedMacroId, setSelectedMacroId] = useState<string | undefined>(macros[0]?.id);
  const [archiveMacroIds, setArchiveMacroIds] = useState<string[]>([]);
  const [macroConflictMode, setMacroConflictMode] = useState<MacroConflictMode>("copy");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [archiveAssetIds, setArchiveAssetIds] = useState<string[]>([]);
  const [resetConfirm, setResetConfirm] = useState("");
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentScreen = useMemo(
    () => project?.screens.find((screen) => screen.id === selectedScreenId) ?? project?.screens.find((screen) => screen.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project?.screens, selectedScreenId],
  );

  if (!project) {
    return <div className="screen-editor-window-content project-manager-window"><div className="screen-editor-empty-state">Project is not loaded</div></div>;
  }

  const requestConfirm = (state: ConfirmState): void => {
    setConfirmState(state);
  };

  const runConfirmAction = async (): Promise<void> => {
    if (!confirmState) {
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

  const setArchiveFile = (slot: ArchiveFileSlot, file: File | null): void => {
    setFiles((prev) => ({ ...prev, [slot]: file }));
    setInspections((prev) => ({ ...prev, [slot]: null }));
    if (slot === "screenProject") {
      setArchiveScreenIds([]);
    }
    if (slot === "libraryProject") {
      setArchiveLibraryIds([]);
    }
    if (slot === "macroProject") {
      setArchiveMacroIds([]);
    }
    if (slot === "assetsProject") {
      setArchiveAssetIds([]);
    }
  };

  const reloadAfterImport = async (): Promise<void> => {
    await loadProject();
    await Promise.all([loadTags(), loadDrivers(), loadMacros(), loadAssets(), loadLibraries()]);
  };

  const inspectFile = async (slot: ArchiveFileSlot): Promise<ProjectArchiveInspectionResult | null> => {
    const file = files[slot];
    if (!file) {
      void message.warning("Choose a ZIP archive first");
      return null;
    }
    setBusy(true);
    try {
      const result = await api.inspectArchive(file);
      setInspections((prev) => ({ ...prev, [slot]: result }));
      if (slot === "screenProject") {
        setArchiveScreenIds(result.screens.slice(0, 1).map((item) => item.id));
      }
      if (slot === "libraryProject") {
        setArchiveLibraryIds(result.libraries.slice(0, 1).map((item) => item.id));
      }
      if (slot === "macroProject") {
        setArchiveMacroIds(result.macros.slice(0, 1).map((item) => item.id));
      }
      if (slot === "assetsProject") {
        setArchiveAssetIds(result.assets.slice(0, 1).map((item) => item.id));
      }
      return result;
    } finally {
      setBusy(false);
    }
  };

  const exportProject = async (): Promise<void> => {
    setBusy(true);
    try {
      const exported = await api.exportProjectArchive();
      downloadBlob(exported.blob, exported.fileName);
      void message.success("Project ZIP exported");
    } finally {
      setBusy(false);
    }
  };

  const executeImportProject = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const imported = await api.importProjectArchive(file, { mode: "replace-current" });
      setLastBackupPath(imported.backupPath ?? null);
      await reloadAfterImport();
      void message.success("Project imported");
    } finally {
      setBusy(false);
    }
  };

  const importProject = (): void => {
    const file = files.project;
    const result = inspections.project;
    if (!file || !result?.valid || result.archiveType !== "project") {
      void message.warning("Validate a project ZIP first");
      return;
    }
    requestConfirm({
      title: "Replace Current Project",
      message: `The current project will be replaced with "${result.summary?.name ?? file.name}". A backup ZIP will be created first.`,
      confirmLabel: "Replace Current Project",
      confirmVariant: "danger",
      onConfirm: () => executeImportProject(file),
    });
  };

  const exportScreen = async (): Promise<void> => {
    if (!currentScreen) {
      return;
    }
    setBusy(true);
    try {
      const exported = await api.exportScreenArchive(currentScreen.id, { dependencyMode });
      downloadBlob(exported.blob, exported.fileName);
      void message.success("Screen ZIP exported");
    } finally {
      setBusy(false);
    }
  };

  const duplicateScreen = async (): Promise<void> => {
    if (!currentScreen) {
      return;
    }
    const taken = new Set(project.screens.map((screen) => screen.id));
    const nextScreen = { ...currentScreen, id: makeCopyId(currentScreen.id, taken), name: `${currentScreen.name} copy` };
    updateProjectJson({ ...project, screens: [...project.screens, nextScreen] });
    setCurrentScreen(nextScreen.id);
    setSelectedScreenId(nextScreen.id);
    await saveProject();
    void message.success("Screen duplicated");
  };

  const executeDeleteScreen = async (): Promise<void> => {
    if (!currentScreen || project.screens.length <= 1) {
      return;
    }
    const nextScreens = project.screens.filter((screen) => screen.id !== currentScreen.id);
    const fallback = nextScreens[0];
    if (!fallback) {
      return;
    }
    updateProjectJson({
      ...project,
      screens: nextScreens,
      startScreenId: project.startScreenId === currentScreen.id ? fallback.id : project.startScreenId,
    });
    setCurrentScreen(fallback.id);
    setSelectedScreenId(fallback.id);
    await saveProject();
    void message.success("Screen deleted");
  };

  const deleteScreen = (): void => {
    if (!currentScreen || project.screens.length <= 1) {
      return;
    }
    requestConfirm({
      title: "Delete Screen",
      message: `Delete "${currentScreen.name}" from the current project? This action cannot be undone after saving.`,
      confirmLabel: "Delete",
      confirmVariant: "danger",
      onConfirm: executeDeleteScreen,
    });
  };

  const executeImportScreenZip = async (): Promise<void> => {
    const file = files.screenZip;
    const result = inspections.screenZip;
    if (!file || !result?.valid || result.archiveType !== "screen") {
      void message.warning("Validate a Screen ZIP first");
      return;
    }
    if (screenMode === "replace" && !currentScreen) {
      void message.warning("Select a current screen to replace");
      return;
    }
    setBusy(true);
    try {
      const imported = await api.importScreenArchive(file, {
        mode: screenMode,
        replaceScreenId: screenMode === "replace" ? currentScreen?.id : undefined,
      });
      updateProjectJson(imported.project);
      setCurrentScreen(imported.screenId);
      setSelectedScreenId(imported.screenId);
      await Promise.all([loadTags(), loadAssets(), loadLibraries(), loadMacros()]);
      void message.success(`Screen imported: ${imported.importedScreenName}`);
    } finally {
      setBusy(false);
    }
  };

  const importScreenZip = (): void => {
    if (screenMode !== "replace") {
      void executeImportScreenZip();
      return;
    }
    if (!currentScreen) {
      void message.warning("Select a current screen to replace");
      return;
    }
    requestConfirm({
      title: "Replace Selected Screen",
      message: `Replace "${currentScreen.name}" with the validated Screen ZIP. Existing screen content will be replaced.`,
      confirmLabel: "Replace Selected Screen",
      confirmVariant: "danger",
      onConfirm: executeImportScreenZip,
    });
  };

  const executeImportScreensFromProject = async (mode: ScreenArchiveImportOptions["mode"]): Promise<void> => {
    const file = files.screenProject;
    const result = inspections.screenProject;
    if (!file || !result?.valid || result.archiveType !== "project" || archiveScreenIds.length === 0) {
      void message.warning("Validate a Project ZIP and select screens first");
      return;
    }
    if (mode === "replace" && (!currentScreen || archiveScreenIds.length !== 1)) {
      void message.warning("Select one archive screen and one current screen to replace");
      return;
    }
    setBusy(true);
    try {
      const imported = await api.importScreenFromProjectArchive(file, {
        screenIds: archiveScreenIds,
        mode,
        replaceScreenId: mode === "replace" ? currentScreen?.id : undefined,
        dependencyMode,
      });
      updateProjectJson(imported.project);
      setCurrentScreen(imported.screenId);
      setSelectedScreenId(imported.screenId);
      await Promise.all([loadTags(), loadAssets(), loadLibraries(), loadMacros()]);
      void message.success("Screens imported from project ZIP");
    } finally {
      setBusy(false);
    }
  };

  const importScreensFromProject = (mode: ScreenArchiveImportOptions["mode"]): void => {
    if (mode !== "replace") {
      void executeImportScreensFromProject(mode);
      return;
    }
    if (!currentScreen || archiveScreenIds.length !== 1) {
      void message.warning("Select one archive screen and one current screen to replace");
      return;
    }
    const archiveScreen = inspections.screenProject?.screens.find((item) => item.id === archiveScreenIds[0]);
    requestConfirm({
      title: "Replace Selected Screen",
      message: `Replace "${currentScreen.name}" with "${archiveScreen?.name ?? archiveScreenIds[0]}" from the selected Project ZIP. Existing screen content will be replaced.`,
      confirmLabel: "Replace Selected Screen",
      confirmVariant: "danger",
      onConfirm: () => executeImportScreensFromProject("replace"),
    });
  };

  const executeImportLibraryZip = async (): Promise<void> => {
    const file = files.libraryZip;
    if (!file) {
      void message.warning("Choose a Library ZIP first");
      return;
    }
    setBusy(true);
    try {
      await api.validateLibraryImport(file);
      const imported = await api.importLibrary(file, { replace: libraryConflictMode === "replace", importAsCopy: libraryConflictMode === "copy" });
      await loadLibraries();
      void message.success(`Library imported: ${imported.library.name}`);
    } finally {
      setBusy(false);
    }
  };

  const importLibraryZip = (): void => {
    if (libraryConflictMode !== "replace") {
      void executeImportLibraryZip();
      return;
    }
    requestConfirm({
      title: "Replace Library",
      message: "Import the selected Library ZIP and replace an existing library if its identifier conflicts.",
      confirmLabel: "Replace",
      confirmVariant: "danger",
      onConfirm: executeImportLibraryZip,
    });
  };

  const executeImportLibrariesFromProject = async (): Promise<void> => {
    const file = files.libraryProject;
    const result = inspections.libraryProject;
    if (!file || !result?.valid || result.archiveType !== "project" || archiveLibraryIds.length === 0) {
      void message.warning("Validate a Project ZIP and select libraries first");
      return;
    }
    setBusy(true);
    try {
      const imported = await api.importLibraryFromProjectArchive(file, { libraryIds: archiveLibraryIds, conflictMode: libraryConflictMode });
      updateProjectJson(imported.project);
      await loadLibraries();
      void message.success("Libraries imported from project ZIP");
    } finally {
      setBusy(false);
    }
  };

  const importLibrariesFromProject = (): void => {
    if (libraryConflictMode !== "replace") {
      void executeImportLibrariesFromProject();
      return;
    }
    requestConfirm({
      title: "Replace Library",
      message: "Import selected libraries from the Project ZIP and replace any selected library with a matching identifier.",
      confirmLabel: "Replace",
      confirmVariant: "danger",
      onConfirm: executeImportLibrariesFromProject,
    });
  };

  const exportLibrary = async (): Promise<void> => {
    if (!selectedLibraryId) {
      return;
    }
    setBusy(true);
    try {
      const exported = await api.exportLibrary(selectedLibraryId);
      downloadBlob(exported.blob, exported.fileName);
      void message.success("Library ZIP exported");
    } finally {
      setBusy(false);
    }
  };

  const executeDeleteLibrary = async (): Promise<void> => {
    if (!selectedLibraryId) {
      return;
    }
    await api.deleteLibrary(selectedLibraryId, { force: true });
    await loadLibraries();
    void message.success("Library deleted");
  };

  const deleteLibrary = (): void => {
    const library = libraries.find((item) => item.id === selectedLibraryId);
    if (!selectedLibraryId) {
      return;
    }
    requestConfirm({
      title: "Delete Library",
      message: `Delete "${library?.name ?? selectedLibraryId}"? Library files will be removed. If it is attached to the project, it will be detached first.`,
      confirmLabel: "Delete",
      confirmVariant: "danger",
      onConfirm: executeDeleteLibrary,
    });
  };

  const exportMacro = (): void => {
    const macro = macros.find((item) => item.id === selectedMacroId);
    if (!macro) {
      return;
    }
    const blob = new Blob([JSON.stringify({ format: "mywebscada-macro", macro }, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${macro.id}.webscada-macro.json`);
    void message.info("Macro exported as JSON. Project ZIP import is used for signed macro transfer.");
  };

  const executeImportMacrosFromProject = async (): Promise<void> => {
    const file = files.macroProject;
    const result = inspections.macroProject;
    if (!file || !result?.valid || result.archiveType !== "project" || archiveMacroIds.length === 0) {
      void message.warning("Validate a Project ZIP and select macros first");
      return;
    }
    setBusy(true);
    try {
      const imported = await api.importMacroFromProjectArchive(file, { macroIds: archiveMacroIds, conflictMode: macroConflictMode });
      updateProjectJson(imported.project);
      await loadMacros();
      void message.success("Macros imported from project ZIP");
    } finally {
      setBusy(false);
    }
  };

  const importMacrosFromProject = (): void => {
    if (macroConflictMode !== "replace") {
      void executeImportMacrosFromProject();
      return;
    }
    requestConfirm({
      title: "Replace Macro",
      message: "Import selected macros from the Project ZIP and replace any selected macro with a matching identifier.",
      confirmLabel: "Replace",
      confirmVariant: "danger",
      onConfirm: executeImportMacrosFromProject,
    });
  };

  const duplicateMacro = async (): Promise<void> => {
    const macro = macros.find((item) => item.id === selectedMacroId);
    if (!macro) {
      return;
    }
    const taken = new Set((project.macros ?? []).map((item) => item.id));
    const nextMacro = { ...macro, id: makeCopyId(macro.id, taken), name: `${macro.name} copy` };
    updateProjectJson({ ...project, macros: [...(project.macros ?? []), nextMacro] });
    setSelectedMacroId(nextMacro.id);
    await saveProject();
    await loadMacros();
    void message.success("Macro duplicated");
  };

  const executeDeleteMacro = async (): Promise<void> => {
    if (!selectedMacroId) {
      return;
    }
    updateProjectJson({ ...project, macros: (project.macros ?? []).filter((macro) => macro.id !== selectedMacroId) });
    await saveProject();
    await loadMacros();
    void message.success("Macro deleted");
  };

  const deleteMacro = (): void => {
    const macro = macros.find((item) => item.id === selectedMacroId);
    if (!selectedMacroId) {
      return;
    }
    requestConfirm({
      title: "Delete Macro",
      message: `Delete "${macro?.name ?? selectedMacroId}" from the current project? This action cannot be undone after saving.`,
      confirmLabel: "Delete",
      confirmVariant: "danger",
      onConfirm: executeDeleteMacro,
    });
  };

  const importAssetsFromProject = async (): Promise<void> => {
    const file = files.assetsProject;
    const result = inspections.assetsProject;
    if (!file || !result?.valid || result.archiveType !== "project" || archiveAssetIds.length === 0) {
      void message.warning("Validate a Project ZIP and select assets first");
      return;
    }
    setBusy(true);
    try {
      const imported = await api.importAssetsFromProjectArchive(file, { assetIds: archiveAssetIds });
      updateProjectJson(imported.project);
      await loadAssets();
      void message.success("Assets imported from project ZIP");
    } finally {
      setBusy(false);
    }
  };

  const executeDeleteUnusedAssets = async (): Promise<void> => {
    const serializedScreens = JSON.stringify(project.screens);
    const unused = assets.filter((asset) => !serializedScreens.includes(asset.id));
    for (const asset of unused) {
      await api.deleteAsset(asset.id).catch(() => undefined);
    }
    await loadAssets();
    void message.success("Unused assets deleted");
  };

  const deleteUnusedAssets = (): void => {
    const serializedScreens = JSON.stringify(project.screens);
    const unused = assets.filter((asset) => !serializedScreens.includes(asset.id));
    if (unused.length === 0) {
      void message.info("No unused assets found");
      return;
    }
    requestConfirm({
      title: "Delete Unused Assets",
      message: `${unused.length} assets are not referenced by current screens and will be deleted from the project assets store.`,
      confirmLabel: "Delete",
      confirmVariant: "danger",
      onConfirm: executeDeleteUnusedAssets,
    });
  };

  const executeResetProject = async (): Promise<void> => {
    if (resetConfirm !== "RESET") {
      void message.warning("Type RESET to enable project reset");
      return;
    }
    updateProjectJson(makeResetProject(project));
    await saveProject();
    await reloadAfterImport();
    setResetConfirm("");
    void message.success("Project reset");
  };

  const resetProject = (): void => {
    if (resetConfirm !== "RESET") {
      void message.warning("Type RESET to enable project reset");
      return;
    }
    requestConfirm({
      title: "Reset Project",
      message: "Reset clears screens, tags, assets, libraries, events, variables, and macros in the editable project.",
      confirmLabel: "Reset Project",
      confirmVariant: "danger",
      onConfirm: executeResetProject,
    });
  };

  const fileInput = (slot: ArchiveFileSlot) => (
    <input
      ref={fileRefs[slot]}
      type="file"
      accept=".zip,application/zip"
      hidden
      onChange={(event) => setArchiveFile(slot, event.target.files?.[0] ?? null)}
    />
  );

  const screenColumns: WorkbenchTableColumn<ScadaProject["screens"][number]>[] = [
    { id: "name", title: "NAME", width: "minmax(180px, 1fr)", render: (screen) => screen.name },
    { id: "id", title: "ID", width: "minmax(160px, 1fr)", render: (screen) => screen.id },
    { id: "kind", title: "KIND", width: "100px", render: (screen) => screen.kind ?? "screen" },
    { id: "size", title: "SIZE", width: "120px", render: (screen) => `${screen.width} x ${screen.height}` },
  ];
  const selectedScreenDetails: DetailRow[] = currentScreen
    ? [
        { label: "Name", value: currentScreen.name },
        { label: "ID", value: currentScreen.id },
        { label: "Kind", value: currentScreen.kind ?? "screen" },
        { label: "Size", value: `${currentScreen.width} x ${currentScreen.height}` },
        { label: "Objects", value: currentScreen.objects.length },
      ]
    : [];
  const libraryColumns = [
    { id: "name", title: "NAME", width: "minmax(180px, 1fr)", render: (library: typeof libraries[number]) => library.name },
    { id: "id", title: "ID", width: "minmax(160px, 1fr)", render: (library: typeof libraries[number]) => library.id },
    { id: "version", title: "VERSION", width: "110px", render: (library: typeof libraries[number]) => library.version ?? "-" },
  ];
  const macroColumns = [
    { id: "name", title: "NAME", width: "minmax(180px, 1fr)", render: (macro: typeof macros[number]) => macro.name },
    { id: "id", title: "ID", width: "minmax(160px, 1fr)", render: (macro: typeof macros[number]) => macro.id },
    { id: "enabled", title: "ENABLED", width: "90px", render: (macro: typeof macros[number]) => macro.enabled === false ? "No" : "Yes" },
  ];
  const assetColumns = [
    { id: "name", title: "NAME", width: "minmax(180px, 1fr)", render: (asset: typeof assets[number]) => asset.name },
    { id: "id", title: "ID", width: "minmax(160px, 1fr)", render: (asset: typeof assets[number]) => asset.id },
    { id: "mime", title: "MIME TYPE", width: "minmax(130px, 1fr)", render: (asset: typeof assets[number]) => asset.mimeType },
  ];
  const tabs: WorkbenchTabItem[] = [
    { id: "project", title: "Project", active: activeTab === "project", onClick: () => setActiveTab("project") },
    { id: "screens", title: "Screens", active: activeTab === "screens", onClick: () => setActiveTab("screens") },
    { id: "libraries", title: "Libraries", active: activeTab === "libraries", onClick: () => setActiveTab("libraries") },
    { id: "macros", title: "Macros", active: activeTab === "macros", onClick: () => setActiveTab("macros") },
    { id: "assets", title: "Assets / Images", active: activeTab === "assets", onClick: () => setActiveTab("assets") },
    { id: "backups", title: "Backups / Reset", active: activeTab === "backups", onClick: () => setActiveTab("backups") },
  ];

  return (
    <div className="screen-editor-window-content project-manager-window">
      <div className="project-manager-window__toolbar">
        <div className="project-manager-window__toolbar-title">Project Manager</div>
        <div className="project-manager-window__toolbar-meta">
          Project: {project.name} | Screens: {project.screens.length} | Tags: {project.tags.length} | Assets: {assets.length}
        </div>
      </div>

      <WorkbenchTabs items={tabs} className="project-manager-window__tabs" />

      <div className="project-manager-window__body">
        {activeTab === "project" ? (
          <div className="project-manager-grid project-manager-grid--two">
            <WorkbenchSection title="Current Project Summary">
              <ProjectSummaryTable project={project} />
            </WorkbenchSection>
            <WorkbenchSection title="Project Archive Actions">
              <div className="project-manager-stack">
                <div className="project-manager-actions">
                  <WorkbenchButton variant="primary" disabled={busy} onClick={() => void exportProject()}>Export Project</WorkbenchButton>
                </div>
                <WorkbenchFilePickerRow
                  label="Selected project archive:"
                  file={files.project}
                  chooseLabel="Choose Project ZIP"
                  validateLabel="Validate Archive"
                  onChoose={() => fileRefs.project.current?.click()}
                  onValidate={() => void inspectFile("project")}
                  validateDisabled={!files.project}
                  busy={busy}
                />
                {fileInput("project")}
                <ArchiveStatusPanel label="Selected project archive:" file={files.project} result={inspections.project} />
                <div className="project-manager-actions project-manager-actions--end">
                  <WorkbenchButton
                    variant="danger"
                    disabled={!files.project || !inspections.project?.valid || inspections.project.archiveType !== "project" || busy}
                    onClick={importProject}
                  >
                    Replace Current Project
                  </WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
          </div>
        ) : null}

        {activeTab === "screens" ? (
          <div className="project-manager-stack">
            <div className="project-manager-grid project-manager-grid--two">
              <WorkbenchSection title="Current Project Screens">
                <div className="project-manager-stack">
                  <WorkbenchTable
                    rows={project.screens}
                    getRowId={(screen) => screen.id}
                    emptyText="No screens"
                    columns={screenColumns}
                    selectedRowId={currentScreen?.id}
                    onRowClick={(screen) => {
                      setSelectedScreenId(screen.id);
                      setCurrentScreen(screen.id);
                    }}
                  />
                  <div className="project-manager-inline-controls">
                    <WorkbenchSelect
                      value={dependencyMode}
                      onChange={(event) => setDependencyMode(event.target.value as ScreenArchiveDependencyMode)}
                      options={[
                        { value: "safe", label: "Safe dependencies: include all required project resources" },
                        { value: "minimal", label: "Minimal dependencies: include only detected dependencies" },
                      ]}
                    />
                  </div>
                  <div className="project-manager-actions">
                    <WorkbenchButton variant="primary" disabled={!currentScreen || busy} onClick={() => void exportScreen()}>Export Screen</WorkbenchButton>
                    <WorkbenchButton disabled={!currentScreen || busy} onClick={() => void duplicateScreen()}>Duplicate</WorkbenchButton>
                    <WorkbenchButton variant="danger" disabled={!currentScreen || project.screens.length <= 1 || busy} onClick={deleteScreen}>Delete</WorkbenchButton>
                  </div>
                </div>
              </WorkbenchSection>
              <WorkbenchSection title="Selected Screen Details">
                <DetailTable rows={selectedScreenDetails} emptyText="No screen selected" />
              </WorkbenchSection>
            </div>

            <div className="project-manager-grid project-manager-grid--two">
              <WorkbenchSection title="Import Screen from ZIP">
                <div className="project-manager-stack">
                  <WorkbenchFilePickerRow
                    label="Selected screen archive:"
                    file={files.screenZip}
                    chooseLabel="Import Screen from ZIP"
                    validateLabel="Validate Archive"
                    onChoose={() => fileRefs.screenZip.current?.click()}
                    onValidate={() => void inspectFile("screenZip")}
                    validateDisabled={!files.screenZip}
                    busy={busy}
                  />
                  {fileInput("screenZip")}
                  <WorkbenchSelect
                    value={screenMode}
                    onChange={(event) => setScreenMode(event.target.value as ScreenArchiveImportOptions["mode"])}
                    options={[
                      { value: "add", label: "Add as New" },
                      { value: "replace", label: "Replace Selected Screen" },
                    ]}
                  />
                  <ArchiveStatusPanel label="Selected screen archive:" file={files.screenZip} result={inspections.screenZip} />
                  <ConflictPreview items={inspections.screenZip?.conflicts?.assets ?? []} />
                  <div className="project-manager-actions project-manager-actions--end">
                    <WorkbenchButton
                      variant={screenMode === "replace" ? "danger" : "primary"}
                      disabled={!files.screenZip || !inspections.screenZip?.valid || inspections.screenZip.archiveType !== "screen" || busy}
                      onClick={importScreenZip}
                    >
                      {screenMode === "replace" ? "Replace Selected Screen" : "Add as New"}
                    </WorkbenchButton>
                  </div>
                </div>
              </WorkbenchSection>

              <WorkbenchSection title="Import Screen from Project ZIP">
                <div className="project-manager-stack">
                  <WorkbenchFilePickerRow
                    label="Source project archive:"
                    file={files.screenProject}
                    chooseLabel="Import Screen from Project"
                    validateLabel="Validate Archive"
                    onChoose={() => fileRefs.screenProject.current?.click()}
                    onValidate={() => void inspectFile("screenProject")}
                    validateDisabled={!files.screenProject}
                    busy={busy}
                  />
                  {fileInput("screenProject")}
                  <ArchiveStatusPanel label="Source project archive:" file={files.screenProject} result={inspections.screenProject} />
                  <ResourceTable items={inspections.screenProject?.screens ?? []} selectedIds={archiveScreenIds} onSelectedIdsChange={setArchiveScreenIds} emptyText="Validate a Project ZIP to show screens" />
                  <ConflictPreview items={inspections.screenProject?.conflicts?.screens.filter((item) => archiveScreenIds.includes(item.id)) ?? []} />
                  <div className="project-manager-actions project-manager-actions--end">
                    <WorkbenchButton disabled={!inspections.screenProject?.valid || archiveScreenIds.length === 0 || busy} onClick={() => importScreensFromProject("add")}>Add as New</WorkbenchButton>
                    <WorkbenchButton variant="danger" disabled={!inspections.screenProject?.valid || archiveScreenIds.length !== 1 || !currentScreen || busy} onClick={() => importScreensFromProject("replace")}>Replace Selected Screen</WorkbenchButton>
                  </div>
                </div>
              </WorkbenchSection>
            </div>
          </div>
        ) : null}

        {activeTab === "libraries" ? (
          <div className="project-manager-grid project-manager-grid--two">
            <WorkbenchSection title="Current Libraries">
              <div className="project-manager-stack">
                <WorkbenchTable
                  rows={libraries}
                  getRowId={(library) => library.id}
                  emptyText="No libraries"
                  columns={libraryColumns}
                  selectedRowId={selectedLibraryId}
                  onRowClick={(library) => setSelectedLibraryId(library.id)}
                />
                <div className="project-manager-actions">
                  <WorkbenchButton variant="primary" disabled={!selectedLibraryId || busy} onClick={() => void exportLibrary()}>Export Library</WorkbenchButton>
                  <WorkbenchButton variant="danger" disabled={!selectedLibraryId || busy} onClick={deleteLibrary}>Delete</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
            <WorkbenchSection title="Import Libraries">
              <div className="project-manager-stack">
                <WorkbenchSelect
                  value={libraryConflictMode}
                  onChange={(event) => setLibraryConflictMode(event.target.value as LibraryConflictMode)}
                  options={[
                    { value: "keep-existing", label: "Keep existing" },
                    { value: "replace", label: "Replace" },
                    { value: "copy", label: "Import as copy" },
                  ]}
                />
                <WorkbenchFilePickerRow
                  label="Selected library archive:"
                  file={files.libraryZip}
                  chooseLabel="Choose Library ZIP"
                  onChoose={() => fileRefs.libraryZip.current?.click()}
                  busy={busy}
                />
                <div className="project-manager-actions">
                  <WorkbenchButton disabled={!files.libraryZip || busy} onClick={importLibraryZip}>Import Library</WorkbenchButton>
                </div>
                {fileInput("libraryZip")}
                <WorkbenchFilePickerRow
                  label="Source project archive:"
                  file={files.libraryProject}
                  chooseLabel="Choose Project ZIP"
                  validateLabel="Validate Archive"
                  onChoose={() => fileRefs.libraryProject.current?.click()}
                  onValidate={() => void inspectFile("libraryProject")}
                  validateDisabled={!files.libraryProject}
                  busy={busy}
                />
                {fileInput("libraryProject")}
                <ArchiveStatusPanel label="Source project archive:" file={files.libraryProject} result={inspections.libraryProject} />
                <ResourceTable items={inspections.libraryProject?.libraries ?? []} selectedIds={archiveLibraryIds} onSelectedIdsChange={setArchiveLibraryIds} emptyText="Validate a Project ZIP to show libraries" />
                <ConflictPreview items={inspections.libraryProject?.conflicts?.libraries.filter((item) => archiveLibraryIds.includes(item.id)) ?? []} />
                <div className="project-manager-actions project-manager-actions--end">
                  <WorkbenchButton disabled={!inspections.libraryProject?.valid || archiveLibraryIds.length === 0 || busy} onClick={importLibrariesFromProject}>Import selected libraries</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
          </div>
        ) : null}

        {activeTab === "macros" ? (
          <div className="project-manager-grid project-manager-grid--two">
            <WorkbenchSection title="Current Macros">
              <div className="project-manager-stack">
                <WorkbenchTable
                  rows={macros}
                  getRowId={(macro) => macro.id}
                  emptyText="No macros"
                  columns={macroColumns}
                  selectedRowId={selectedMacroId}
                  onRowClick={(macro) => setSelectedMacroId(macro.id)}
                />
                <div className="project-manager-actions">
                  <WorkbenchButton disabled={!selectedMacroId || busy} onClick={exportMacro}>Export Macro JSON</WorkbenchButton>
                  <WorkbenchButton disabled={!selectedMacroId || busy} onClick={() => void duplicateMacro()}>Duplicate</WorkbenchButton>
                  <WorkbenchButton variant="danger" disabled={!selectedMacroId || busy} onClick={deleteMacro}>Delete</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
            <WorkbenchSection title="Import Macros from Project ZIP">
              <div className="project-manager-stack">
                <WorkbenchSelect
                  value={macroConflictMode}
                  onChange={(event) => setMacroConflictMode(event.target.value as MacroConflictMode)}
                  options={[
                    { value: "keep-existing", label: "Keep existing" },
                    { value: "replace", label: "Replace" },
                    { value: "copy", label: "Import as copy" },
                  ]}
                />
                <div className="project-manager-actions">
                  <WorkbenchButton disabled title="Not implemented yet">Import macro from Macro ZIP</WorkbenchButton>
                </div>
                <WorkbenchFilePickerRow
                  label="Source project archive:"
                  file={files.macroProject}
                  chooseLabel="Choose Project ZIP"
                  validateLabel="Validate Archive"
                  onChoose={() => fileRefs.macroProject.current?.click()}
                  onValidate={() => void inspectFile("macroProject")}
                  validateDisabled={!files.macroProject}
                  busy={busy}
                />
                {fileInput("macroProject")}
                <ArchiveStatusPanel label="Source project archive:" file={files.macroProject} result={inspections.macroProject} />
                <ResourceTable items={inspections.macroProject?.macros ?? []} selectedIds={archiveMacroIds} onSelectedIdsChange={setArchiveMacroIds} emptyText="Validate a Project ZIP to show macros" />
                <ConflictPreview items={inspections.macroProject?.conflicts?.macros.filter((item) => archiveMacroIds.includes(item.id)) ?? []} />
                <div className="project-manager-actions project-manager-actions--end">
                  <WorkbenchButton disabled={!inspections.macroProject?.valid || archiveMacroIds.length === 0 || busy} onClick={importMacrosFromProject}>Import selected macros</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
          </div>
        ) : null}

        {activeTab === "assets" ? (
          <div className="project-manager-grid project-manager-grid--two">
            <WorkbenchSection title="Current Assets / Images">
              <div className="project-manager-stack">
                <WorkbenchTable
                  rows={assets}
                  getRowId={(asset) => asset.id}
                  emptyText="No assets"
                  columns={assetColumns}
                  selectedIds={selectedAssetIds}
                  onToggleRow={(asset) => setSelectedAssetIds((prev) => toggleId(prev, asset.id))}
                />
                <div className="project-manager-actions">
                  <WorkbenchButton disabled title="Not implemented yet">Import image/assets from ZIP</WorkbenchButton>
                  <WorkbenchButton disabled title="Not implemented yet">Export selected assets</WorkbenchButton>
                  <WorkbenchButton variant="danger" disabled={busy} onClick={deleteUnusedAssets}>Delete unused assets</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
            <WorkbenchSection title="Import Assets / Images from Project ZIP">
              <div className="project-manager-stack">
                <WorkbenchFilePickerRow
                  label="Source project archive:"
                  file={files.assetsProject}
                  chooseLabel="Choose Project ZIP"
                  validateLabel="Validate Archive"
                  onChoose={() => fileRefs.assetsProject.current?.click()}
                  onValidate={() => void inspectFile("assetsProject")}
                  validateDisabled={!files.assetsProject}
                  busy={busy}
                />
                {fileInput("assetsProject")}
                <ArchiveStatusPanel label="Source project archive:" file={files.assetsProject} result={inspections.assetsProject} />
                <ResourceTable items={inspections.assetsProject?.assets ?? []} selectedIds={archiveAssetIds} onSelectedIdsChange={setArchiveAssetIds} emptyText="Validate a Project ZIP to show assets" />
                <ConflictPreview items={inspections.assetsProject?.conflicts?.assets.filter((item) => archiveAssetIds.includes(item.id)) ?? []} />
                <div className="project-manager-actions project-manager-actions--end">
                  <WorkbenchButton disabled={!inspections.assetsProject?.valid || archiveAssetIds.length === 0 || busy} onClick={() => void importAssetsFromProject()}>Import selected assets</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
          </div>
        ) : null}

        {activeTab === "backups" ? (
          <div className="project-manager-grid project-manager-grid--two">
            <WorkbenchSection title="Backups Created by Project Import">
              <div className="project-manager-stack">
                <WorkbenchStatusBlock
                  variant="info"
                  title={lastBackupPath ? "Latest backup ZIP" : "No backup created in this session"}
                  description={lastBackupPath ?? "No import backup has been created in this session."}
                />
                <div className="project-manager-actions">
                  <WorkbenchButton disabled title="Not implemented yet">Restore backup</WorkbenchButton>
                  <WorkbenchButton disabled title="Not implemented yet">Download backup ZIP</WorkbenchButton>
                </div>
              </div>
            </WorkbenchSection>
            <WorkbenchDangerZone>
              <div className="project-manager-stack">
                <div className="project-manager-danger-text">
                  Reset clears screens, tags, assets, libraries, events, variables, and macros in the editable project.
                </div>
                <div className="project-manager-reset-row">
                  <WorkbenchInput placeholder="Type RESET" value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} />
                  <WorkbenchButton variant="danger" disabled={resetConfirm !== "RESET" || busy} onClick={resetProject}>Reset Project</WorkbenchButton>
                </div>
              </div>
            </WorkbenchDangerZone>
          </div>
        ) : null}
      </div>

      <WorkbenchConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? "Confirm"}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "OK"}
        confirmVariant={confirmState?.confirmVariant ?? "primary"}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) {
            setConfirmState(null);
          }
        }}
        onConfirm={() => void runConfirmAction()}
      />
    </div>
  );
}
