import { useMemo, useRef, useState } from "react";
import type {
  ArchiveConflictPreviewItem,
  ArchiveInspectionItem,
  ProjectArchiveInspectionResult,
  ScadaProject,
  ScreenArchiveDependencyMode,
  ScreenArchiveImportOptions,
} from "@web-scada/shared";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";

type ArchiveFileSlot = "project" | "screenZip" | "screenProject" | "libraryZip" | "libraryProject" | "macroProject" | "assetsProject";
type MacroConflictMode = "keep-existing" | "replace" | "copy";
type LibraryConflictMode = "keep-existing" | "replace" | "copy";
type CheckboxValue = string | number | boolean;

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

function ProjectSummary({ project }: { project: ScadaProject }) {
  return (
    <Descriptions size="small" bordered column={3}>
      <Descriptions.Item label="Project name">{project.name}</Descriptions.Item>
      <Descriptions.Item label="Screens">{project.screens.length}</Descriptions.Item>
      <Descriptions.Item label="Tags">{project.tags.length}</Descriptions.Item>
      <Descriptions.Item label="Assets">{project.assets?.length ?? 0}</Descriptions.Item>
      <Descriptions.Item label="Libraries">{project.libraries?.length ?? 0}</Descriptions.Item>
      <Descriptions.Item label="Macros">{project.macros?.length ?? 0}</Descriptions.Item>
      <Descriptions.Item label="Events">{project.events?.length ?? 0}</Descriptions.Item>
    </Descriptions>
  );
}

function ArchiveValidationPanel({ result, file }: { result: ProjectArchiveInspectionResult | null; file: File | null }) {
  if (!file) {
    return <Alert type="info" showIcon message="No ZIP selected" description="Choose an archive, then validate it. Nothing is imported after file selection." />;
  }
  if (!result) {
    return <Alert type="info" showIcon message={`Selected: ${file.name}`} description="Validate this ZIP before import buttons become available." />;
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Alert type={result.valid ? "success" : "error"} showIcon message={validationTitle(result)} description={`Selected file: ${file.name}`} />
      {result.summary ? (
        <Descriptions size="small" bordered column={2}>
          <Descriptions.Item label="Archive type">{result.archiveType ?? result.summary.format}</Descriptions.Item>
          <Descriptions.Item label="Project or screen name">{result.summary.name}</Descriptions.Item>
          <Descriptions.Item label="Checksum status">{checksumLabel(result)}</Descriptions.Item>
          <Descriptions.Item label="Signature status">{signatureLabel(result)}</Descriptions.Item>
          <Descriptions.Item label="Screens">{result.summary.screens}</Descriptions.Item>
          <Descriptions.Item label="Tags">{result.summary.tags}</Descriptions.Item>
          <Descriptions.Item label="Assets">{result.summary.assets}</Descriptions.Item>
          <Descriptions.Item label="Libraries">{result.summary.libraries}</Descriptions.Item>
          <Descriptions.Item label="Macros">{result.summary.macros}</Descriptions.Item>
          <Descriptions.Item label="Events">{result.summary.events}</Descriptions.Item>
        </Descriptions>
      ) : null}
      {result.dependencies ? (
        <Descriptions size="small" bordered column={5}>
          <Descriptions.Item label="Assets to import">{result.dependencies.assets}</Descriptions.Item>
          <Descriptions.Item label="Libraries to import">{result.dependencies.libraries}</Descriptions.Item>
          <Descriptions.Item label="Macros to import">{result.dependencies.macros}</Descriptions.Item>
          <Descriptions.Item label="Tags to keep/import">{result.dependencies.tags}</Descriptions.Item>
          <Descriptions.Item label="Events/messages to import">{result.dependencies.events}</Descriptions.Item>
        </Descriptions>
      ) : null}
      {result.warnings.length > 0 ? (
        <Alert type="warning" showIcon message="Warnings" description={result.warnings.map((item) => `${item.message}${item.path ? ` (${item.path})` : ""}`).join("\n")} />
      ) : null}
      {result.errors.length > 0 ? (
        <Alert type="error" showIcon message="Errors" description={result.errors.map((item) => `${item.message}${item.path ? ` (${item.path})` : ""}`).join("\n")} />
      ) : null}
    </Space>
  );
}

function ResourceList({
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
    <Checkbox.Group
      style={{ width: "100%" }}
      value={selectedIds}
      onChange={(values) => onSelectedIdsChange(values.map(String))}
    >
      <List
        size="small"
        bordered
        dataSource={items}
        locale={{ emptyText }}
        renderItem={(item) => (
          <List.Item>
            <Checkbox value={item.id}>
              <Space>
                <Typography.Text>{item.name}</Typography.Text>
                <Typography.Text type="secondary">{item.id}</Typography.Text>
                {item.kind ? <Tag>{item.kind}</Tag> : null}
              </Space>
            </Checkbox>
          </List.Item>
        )}
      />
    </Checkbox.Group>
  );
}

function ConflictPreview({ items }: { items: ArchiveConflictPreviewItem[] }) {
  if (items.length === 0) {
    return <Alert type="success" showIcon message="No conflicts detected for this selection" />;
  }
  return (
    <List
      size="small"
      bordered
      dataSource={items}
      renderItem={(item) => (
        <List.Item>
          <Space direction="vertical" size={0}>
            <Space wrap>
              <Typography.Text strong>{item.name}</Typography.Text>
              <Typography.Text type="secondary">{item.id}</Typography.Text>
              <Tag>{item.status}</Tag>
            </Space>
            <Typography.Text type="secondary">{item.message}</Typography.Text>
          </Space>
        </List.Item>
      )}
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
  const [busy, setBusy] = useState(false);

  const currentScreen = useMemo(
    () => project?.screens.find((screen) => screen.id === selectedScreenId) ?? project?.screens.find((screen) => screen.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project?.screens, selectedScreenId],
  );

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

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

  const importProject = async (): Promise<void> => {
    const file = files.project;
    const result = inspections.project;
    if (!file || !result?.valid || result.archiveType !== "project") {
      void message.warning("Validate a project ZIP first");
      return;
    }
    Modal.confirm({
      title: "Import and replace current project?",
      content: `The current project will be replaced with "${result.summary?.name ?? file.name}". A backup ZIP will be created first.`,
      okText: "Replace project",
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          const imported = await api.importProjectArchive(file, { mode: "replace-current" });
          setLastBackupPath(imported.backupPath ?? null);
          await reloadAfterImport();
          void message.success("Project imported");
        } finally {
          setBusy(false);
        }
      },
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

  const deleteScreen = (): void => {
    if (!currentScreen || project.screens.length <= 1) {
      return;
    }
    Modal.confirm({
      title: "Delete selected screen?",
      content: `Delete "${currentScreen.name}"?`,
      okText: "Delete screen",
      okButtonProps: { danger: true },
      onOk: async () => {
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
      },
    });
  };

  const importScreenZip = async (): Promise<void> => {
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

  const importScreensFromProject = async (mode: ScreenArchiveImportOptions["mode"]): Promise<void> => {
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

  const importLibraryZip = async (): Promise<void> => {
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

  const importLibrariesFromProject = async (): Promise<void> => {
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

  const deleteLibrary = (): void => {
    if (!selectedLibraryId) {
      return;
    }
    Modal.confirm({
      title: "Delete selected library?",
      content: "Library files will be removed. If it is attached to the project, it will be detached first.",
      okText: "Delete library",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteLibrary(selectedLibraryId, { force: true });
        await loadLibraries();
        void message.success("Library deleted");
      },
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

  const importMacrosFromProject = async (): Promise<void> => {
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

  const deleteMacro = (): void => {
    if (!selectedMacroId) {
      return;
    }
    Modal.confirm({
      title: "Delete selected macro?",
      okText: "Delete macro",
      okButtonProps: { danger: true },
      onOk: async () => {
        updateProjectJson({ ...project, macros: (project.macros ?? []).filter((macro) => macro.id !== selectedMacroId) });
        await saveProject();
        await loadMacros();
        void message.success("Macro deleted");
      },
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

  const exportSelectedAssets = (): void => {
    const selected = assets.filter((asset) => selectedAssetIds.includes(asset.id));
    if (selected.length === 0) {
      void message.warning("Select assets first");
      return;
    }
    const blob = new Blob([JSON.stringify({ format: "mywebscada-assets-selection", assets: selected }, null, 2)], { type: "application/json" });
    downloadBlob(blob, "selected-assets.webscada-assets.json");
    void message.info("Asset metadata exported. Use full Project ZIP for portable asset files.");
  };

  const deleteUnusedAssets = async (): Promise<void> => {
    const serializedScreens = JSON.stringify(project.screens);
    const unused = assets.filter((asset) => !serializedScreens.includes(asset.id));
    if (unused.length === 0) {
      void message.info("No unused assets found");
      return;
    }
    Modal.confirm({
      title: "Delete unused assets?",
      content: `${unused.length} assets are not referenced by current screens.`,
      okText: "Delete unused assets",
      okButtonProps: { danger: true },
      onOk: async () => {
        for (const asset of unused) {
          await api.deleteAsset(asset.id).catch(() => undefined);
        }
        await loadAssets();
        void message.success("Unused assets deleted");
      },
    });
  };

  const resetProject = async (): Promise<void> => {
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

  const fileInput = (slot: ArchiveFileSlot) => (
    <input
      ref={fileRefs[slot]}
      type="file"
      accept=".zip,application/zip"
      hidden
      onChange={(event) => setArchiveFile(slot, event.target.files?.[0] ?? null)}
    />
  );

  const projectItems = [
    {
      key: "project",
      label: "Project",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <ProjectSummary project={project} />
          <Space wrap>
            <Button type="primary" loading={busy} onClick={() => void exportProject()}>Export full project ZIP</Button>
            <Button onClick={() => fileRefs.project.current?.click()}>Choose project ZIP</Button>
            <Button disabled={!files.project} loading={busy} onClick={() => void inspectFile("project")}>Validate project ZIP</Button>
            <Button danger disabled={!files.project || !inspections.project?.valid || inspections.project.archiveType !== "project"} loading={busy} onClick={() => void importProject()}>
              Import and replace current project
            </Button>
          </Space>
          {fileInput("project")}
          <ArchiveValidationPanel file={files.project} result={inspections.project} />
        </Space>
      ),
    },
    {
      key: "screens",
      label: "Screens",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Row gutter={12}>
            <Col span={10}>
              <Card size="small" title="Current project screens">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Select
                    value={currentScreen?.id}
                    style={{ width: "100%" }}
                    onChange={(value) => {
                      setSelectedScreenId(value);
                      setCurrentScreen(value);
                    }}
                    options={project.screens.map((screen) => ({ value: screen.id, label: `${screen.name} (${screen.id})` }))}
                  />
                  <Radio.Group
                    value={dependencyMode}
                    onChange={(event) => setDependencyMode(event.target.value)}
                    optionType="button"
                    options={[
                      { label: "Full safe export/import: include all required project resources", value: "safe" },
                      { label: "Minimal export/import: include only detected dependencies", value: "minimal" },
                    ]}
                  />
                  <Space wrap>
                    <Button type="primary" disabled={!currentScreen} loading={busy} onClick={() => void exportScreen()}>Export selected screen ZIP</Button>
                    <Button disabled={!currentScreen} onClick={() => void duplicateScreen()}>Duplicate selected screen</Button>
                    <Button danger disabled={!currentScreen || project.screens.length <= 1} onClick={deleteScreen}>Delete selected screen</Button>
                  </Space>
                </Space>
              </Card>
            </Col>
            <Col span={14}>
              <Card size="small" title="Import screen from Screen ZIP">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space wrap>
                    <Button onClick={() => fileRefs.screenZip.current?.click()}>Choose Screen ZIP</Button>
                    <Button disabled={!files.screenZip} loading={busy} onClick={() => void inspectFile("screenZip")}>Validate Screen ZIP</Button>
                    <Select value={screenMode} style={{ width: 190 }} onChange={setScreenMode} options={[{ label: "Add as new screen", value: "add" }, { label: "Replace selected screen", value: "replace" }]} />
                    <Button disabled={!files.screenZip || !inspections.screenZip?.valid || inspections.screenZip.archiveType !== "screen"} loading={busy} onClick={() => void importScreenZip()}>
                      {screenMode === "replace" ? "Replace selected screen" : "Add as new screen"}
                    </Button>
                  </Space>
                  {fileInput("screenZip")}
                  <ArchiveValidationPanel file={files.screenZip} result={inspections.screenZip} />
                  <ConflictPreview items={inspections.screenZip?.conflicts?.assets ?? []} />
                </Space>
              </Card>
            </Col>
          </Row>
          <Card size="small" title="Import screen from Project ZIP">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Button onClick={() => fileRefs.screenProject.current?.click()}>Choose Project ZIP</Button>
                <Button disabled={!files.screenProject} loading={busy} onClick={() => void inspectFile("screenProject")}>Validate Project ZIP</Button>
                <Button disabled={!inspections.screenProject?.valid || archiveScreenIds.length === 0} loading={busy} onClick={() => void importScreensFromProject("add")}>Add selected as new screens</Button>
                <Button disabled={!inspections.screenProject?.valid || archiveScreenIds.length !== 1 || !currentScreen} loading={busy} onClick={() => void importScreensFromProject("replace")}>Replace selected current screen</Button>
              </Space>
              {fileInput("screenProject")}
              <ArchiveValidationPanel file={files.screenProject} result={inspections.screenProject} />
              <ResourceList items={inspections.screenProject?.screens ?? []} selectedIds={archiveScreenIds} onSelectedIdsChange={setArchiveScreenIds} emptyText="Validate a Project ZIP to show screens" />
              <ConflictPreview items={inspections.screenProject?.conflicts?.screens.filter((item) => archiveScreenIds.includes(item.id)) ?? []} />
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      key: "libraries",
      label: "Libraries",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Card size="small" title="Current libraries">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select value={selectedLibraryId} style={{ width: "100%" }} onChange={setSelectedLibraryId} options={libraries.map((library) => ({ value: library.id, label: `${library.name} (${library.id})` }))} />
              <Space wrap>
                <Button type="primary" disabled={!selectedLibraryId} loading={busy} onClick={() => void exportLibrary()}>Export selected library ZIP</Button>
                <Button danger disabled={!selectedLibraryId} onClick={deleteLibrary}>Delete selected library</Button>
              </Space>
            </Space>
          </Card>
          <Card size="small" title="Import libraries">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Radio.Group
                value={libraryConflictMode}
                onChange={(event) => setLibraryConflictMode(event.target.value)}
                options={[{ label: "Keep existing", value: "keep-existing" }, { label: "Replace", value: "replace" }, { label: "Import as copy", value: "copy" }]}
              />
              <Space wrap>
                <Button onClick={() => fileRefs.libraryZip.current?.click()}>Import library from Library ZIP</Button>
                <Button disabled={!files.libraryZip} loading={busy} onClick={() => void importLibraryZip()}>Validate and import Library ZIP</Button>
                <Button onClick={() => fileRefs.libraryProject.current?.click()}>Choose Project ZIP</Button>
                <Button disabled={!files.libraryProject} loading={busy} onClick={() => void inspectFile("libraryProject")}>Validate Project ZIP</Button>
                <Button disabled={!inspections.libraryProject?.valid || archiveLibraryIds.length === 0} loading={busy} onClick={() => void importLibrariesFromProject()}>Import selected libraries</Button>
              </Space>
              {fileInput("libraryZip")}
              {fileInput("libraryProject")}
              <ArchiveValidationPanel file={files.libraryProject} result={inspections.libraryProject} />
              <ResourceList items={inspections.libraryProject?.libraries ?? []} selectedIds={archiveLibraryIds} onSelectedIdsChange={setArchiveLibraryIds} emptyText="Validate a Project ZIP to show libraries" />
              <ConflictPreview items={inspections.libraryProject?.conflicts?.libraries.filter((item) => archiveLibraryIds.includes(item.id)) ?? []} />
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      key: "macros",
      label: "Macros",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Card size="small" title="Current macros">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select value={selectedMacroId} style={{ width: "100%" }} onChange={setSelectedMacroId} options={macros.map((macro) => ({ value: macro.id, label: `${macro.name} (${macro.id})` }))} />
              <Space wrap>
                <Button disabled={!selectedMacroId} onClick={exportMacro}>Export selected macro ZIP</Button>
                <Button disabled={!selectedMacroId} onClick={() => void duplicateMacro()}>Duplicate macro</Button>
                <Button danger disabled={!selectedMacroId} onClick={deleteMacro}>Delete macro</Button>
              </Space>
            </Space>
          </Card>
          <Card size="small" title="Import macros from Project ZIP">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Radio.Group
                value={macroConflictMode}
                onChange={(event) => setMacroConflictMode(event.target.value)}
                options={[{ label: "Keep existing", value: "keep-existing" }, { label: "Replace", value: "replace" }, { label: "Import as copy", value: "copy" }]}
              />
              <Space wrap>
                <Button disabled>Import macro from Macro ZIP</Button>
                <Button onClick={() => fileRefs.macroProject.current?.click()}>Choose Project ZIP</Button>
                <Button disabled={!files.macroProject} loading={busy} onClick={() => void inspectFile("macroProject")}>Validate Project ZIP</Button>
                <Button disabled={!inspections.macroProject?.valid || archiveMacroIds.length === 0} loading={busy} onClick={() => void importMacrosFromProject()}>Import selected macros</Button>
              </Space>
              {fileInput("macroProject")}
              <ArchiveValidationPanel file={files.macroProject} result={inspections.macroProject} />
              <ResourceList items={inspections.macroProject?.macros ?? []} selectedIds={archiveMacroIds} onSelectedIdsChange={setArchiveMacroIds} emptyText="Validate a Project ZIP to show macros" />
              <ConflictPreview items={inspections.macroProject?.conflicts?.macros.filter((item) => archiveMacroIds.includes(item.id)) ?? []} />
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      key: "assets",
      label: "Assets / Images",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Card size="small" title="Current assets/images">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Checkbox.Group value={selectedAssetIds} onChange={(values: CheckboxValue[]) => setSelectedAssetIds(values.map(String))} style={{ width: "100%" }}>
                <List
                  size="small"
                  bordered
                  dataSource={assets}
                  locale={{ emptyText: "No assets" }}
                  renderItem={(asset) => (
                    <List.Item>
                      <Checkbox value={asset.id}>
                        <Space>
                          <Typography.Text>{asset.name}</Typography.Text>
                          <Typography.Text type="secondary">{asset.id}</Typography.Text>
                          <Tag>{asset.mimeType}</Tag>
                        </Space>
                      </Checkbox>
                    </List.Item>
                  )}
                />
              </Checkbox.Group>
              <Space wrap>
                <Button disabled>Import image/assets from ZIP</Button>
                <Button disabled={selectedAssetIds.length === 0} onClick={exportSelectedAssets}>Export selected assets</Button>
                <Button danger onClick={() => void deleteUnusedAssets()}>Delete unused assets</Button>
              </Space>
            </Space>
          </Card>
          <Card size="small" title="Import images/assets from Project ZIP">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Button onClick={() => fileRefs.assetsProject.current?.click()}>Choose Project ZIP</Button>
                <Button disabled={!files.assetsProject} loading={busy} onClick={() => void inspectFile("assetsProject")}>Validate Project ZIP</Button>
                <Button disabled={!inspections.assetsProject?.valid || archiveAssetIds.length === 0} loading={busy} onClick={() => void importAssetsFromProject()}>Import selected assets</Button>
              </Space>
              {fileInput("assetsProject")}
              <ArchiveValidationPanel file={files.assetsProject} result={inspections.assetsProject} />
              <ResourceList items={inspections.assetsProject?.assets ?? []} selectedIds={archiveAssetIds} onSelectedIdsChange={setArchiveAssetIds} emptyText="Validate a Project ZIP to show assets" />
              <ConflictPreview items={inspections.assetsProject?.conflicts?.assets.filter((item) => archiveAssetIds.includes(item.id)) ?? []} />
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      key: "backups",
      label: "Backups / Reset",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Card size="small" title="Backups created by project import">
            <Space direction="vertical" style={{ width: "100%" }}>
              {lastBackupPath ? <Alert type="info" showIcon message="Latest backup ZIP" description={lastBackupPath} /> : <Typography.Text type="secondary">No import backup has been created in this session.</Typography.Text>}
              <Space wrap>
                <Button disabled={!lastBackupPath}>Restore backup</Button>
                <Button disabled={!lastBackupPath}>Download backup ZIP</Button>
              </Space>
            </Space>
          </Card>
          <Card size="small" title="Danger zone">
            <Typography.Paragraph type="secondary">
              Reset clears screens, tags, assets, libraries, events, variables, and macros in the editable project.
            </Typography.Paragraph>
            <Divider />
            <Space>
              <Input placeholder="Type RESET" value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} style={{ width: 180 }} />
              <Button danger disabled={resetConfirm !== "RESET"} onClick={() => void resetProject()}>Reset project</Button>
            </Space>
          </Card>
        </Space>
      ),
    },
  ];

  return <Tabs tabPosition="left" items={projectItems} style={{ height: "100%" }} />;
}
