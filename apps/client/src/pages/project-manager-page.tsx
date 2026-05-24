import { useRef, useState } from "react";
import type {
  ProjectArchiveValidationResult,
  ScadaProject,
  ScreenArchiveDependencyMode,
  ScreenArchiveImportOptions,
  ScreenArchiveValidationResult,
} from "@web-scada/shared";
import { Alert, Button, Card, Descriptions, Divider, Modal, Select, Space, Typography, message } from "antd";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";

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

function validationTitle(result: ProjectArchiveValidationResult | ScreenArchiveValidationResult | null): string {
  if (!result) {
    return "No archive checked yet";
  }
  if (result.valid) {
    return "Archive is valid";
  }
  return "Archive is invalid";
}

function ValidationSummary({ result }: { result: ProjectArchiveValidationResult | ScreenArchiveValidationResult | null }) {
  if (!result) {
    return <Typography.Text type="secondary">Choose a ZIP archive to validate before import.</Typography.Text>;
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Alert type={result.valid ? "success" : "error"} showIcon message={validationTitle(result)} />
      {result.summary ? (
        <Descriptions size="small" bordered column={2}>
          <Descriptions.Item label="Format">{result.summary.format}</Descriptions.Item>
          <Descriptions.Item label="Name">{result.summary.name}</Descriptions.Item>
          <Descriptions.Item label="Signed">{result.authenticity?.signed ? (result.authenticity.verified ? "verified" : "yes") : "unsigned"}</Descriptions.Item>
          <Descriptions.Item label="Checksums">{result.checksum?.verified === false ? "failed" : "verified"}</Descriptions.Item>
          <Descriptions.Item label="Screens">{result.summary.screens}</Descriptions.Item>
          <Descriptions.Item label="Tags">{result.summary.tags}</Descriptions.Item>
          <Descriptions.Item label="Assets">{result.summary.assets}</Descriptions.Item>
          <Descriptions.Item label="Libraries">{result.summary.libraries}</Descriptions.Item>
          <Descriptions.Item label="Events">{result.summary.events}</Descriptions.Item>
          <Descriptions.Item label="Macros">{result.summary.macros}</Descriptions.Item>
          <Descriptions.Item label="Variables">{result.summary.variables}</Descriptions.Item>
        </Descriptions>
      ) : null}
      {"conflicts" in result && result.conflicts ? (
        <Alert
          type="warning"
          showIcon
          message="Conflicts"
          description={`screenId: ${result.conflicts.screenIdConflict ? "yes" : "no"}; assets: ${result.conflicts.assetConflicts.length}; tags: ${result.conflicts.tagConflicts.length}; libraries: ${result.conflicts.libraryConflicts.length}`}
        />
      ) : null}
      {result.warnings.length > 0 ? (
        <Alert type="warning" showIcon message="Warnings" description={result.warnings.map((item) => `${item.code}: ${item.message}${item.path ? ` (${item.path})` : ""}`).join("\n")} />
      ) : null}
      {result.errors.length > 0 ? (
        <Alert type="error" showIcon message="Errors" description={result.errors.map((item) => `${item.code}: ${item.message}${item.path ? ` (${item.path})` : ""}`).join("\n")} />
      ) : null}
    </Space>
  );
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
  const projectFileRef = useRef<HTMLInputElement | null>(null);
  const screenFileRef = useRef<HTMLInputElement | null>(null);
  const [projectArchiveFile, setProjectArchiveFile] = useState<File | null>(null);
  const [screenArchiveFile, setScreenArchiveFile] = useState<File | null>(null);
  const [projectValidation, setProjectValidation] = useState<ProjectArchiveValidationResult | null>(null);
  const [screenValidation, setScreenValidation] = useState<ScreenArchiveValidationResult | null>(null);
  const [screenMode, setScreenMode] = useState<ScreenArchiveImportOptions["mode"]>("add");
  const [dependencyMode, setDependencyMode] = useState<ScreenArchiveDependencyMode>("safe");
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const currentScreen = project.screens.find((screen) => screen.id === currentScreenId) ?? project.screens[0];

  const reloadAfterImport = async (): Promise<void> => {
    await loadProject();
    await Promise.all([loadTags(), loadDrivers(), loadMacros(), loadAssets(), loadLibraries()]);
  };

  const exportProject = async (): Promise<void> => {
    setBusy(true);
    try {
      const exported = await api.exportProjectArchive();
      downloadBlob(exported.blob, exported.fileName);
      void message.success("Project archive exported");
    } finally {
      setBusy(false);
    }
  };

  const validateProject = async (file = projectArchiveFile): Promise<ProjectArchiveValidationResult | null> => {
    if (!file) {
      void message.warning("Choose a project ZIP archive first");
      return null;
    }
    setBusy(true);
    try {
      const result = await api.validateProjectArchive(file);
      setProjectValidation(result);
      return result;
    } finally {
      setBusy(false);
    }
  };

  const importProject = async (): Promise<void> => {
    if (!projectArchiveFile) {
      void message.warning("Choose a project ZIP archive first");
      return;
    }
    const result = projectValidation?.valid ? projectValidation : await validateProject(projectArchiveFile);
    if (!result?.valid) {
      void message.error("Project archive is not valid");
      return;
    }
    Modal.confirm({
      title: "Replace current project?",
      content: "The server will create an automatic backup, then replace the current project, assets, libraries, and included sound files.",
      okText: "Replace project",
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          const imported = await api.importProjectArchive(projectArchiveFile, { mode: "replace-current" });
          setLastBackupPath(imported.backupPath ?? null);
          await reloadAfterImport();
          void message.success(imported.backupPath ? `Project imported. Backup: ${imported.backupPath}` : "Project imported");
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
      void message.success("Screen archive exported");
    } finally {
      setBusy(false);
    }
  };

  const validateScreen = async (file = screenArchiveFile): Promise<ScreenArchiveValidationResult | null> => {
    if (!file) {
      void message.warning("Choose a screen ZIP archive first");
      return null;
    }
    setBusy(true);
    try {
      const result = await api.validateScreenArchive(file);
      setScreenValidation(result);
      return result;
    } finally {
      setBusy(false);
    }
  };

  const importScreen = async (): Promise<void> => {
    if (!screenArchiveFile) {
      void message.warning("Choose a screen ZIP archive first");
      return;
    }
    if (screenMode === "replace" && !currentScreen) {
      void message.warning("Select a screen to replace first");
      return;
    }
    const result = screenValidation?.valid ? screenValidation : await validateScreen(screenArchiveFile);
    if (!result?.valid) {
      void message.error("Screen archive is not valid");
      return;
    }
    Modal.confirm({
      title: screenMode === "replace" ? "Replace selected screen?" : "Import screen?",
      content: screenMode === "replace" ? `Replace "${currentScreen?.name}" with the screen archive?` : "The screen and non-conflicting dependencies will be added to this project.",
      okText: screenMode === "replace" ? "Replace screen" : "Import screen",
      okButtonProps: { danger: screenMode === "replace" },
      onOk: async () => {
        setBusy(true);
        try {
          const imported = await api.importScreenArchive(screenArchiveFile, {
            mode: screenMode,
            replaceScreenId: screenMode === "replace" ? currentScreen?.id : undefined,
          });
          updateProjectJson(imported.project);
          setCurrentScreen(imported.screenId);
          await Promise.all([loadTags(), loadAssets(), loadLibraries(), loadMacros()]);
          void message.success(`Screen imported: ${imported.importedScreenName}`);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const resetProject = (): void => {
    Modal.confirm({
      title: "Reset current project?",
      content: "This clears screens, tags, assets, libraries, events, variables, and macros in the editable project. You must type RESET to continue.",
      okText: "Reset project",
      okButtonProps: { danger: true },
      onOk: async () => {
        const typed = window.prompt("Type RESET to reset the project");
        if (typed !== "RESET") {
          void message.info("Reset cancelled");
          return;
        }
        updateProjectJson(makeResetProject(project));
        await saveProject();
        await reloadAfterImport();
        void message.success("Project reset");
      },
    });
  };

  const deleteCurrentScreen = (): void => {
    if (!currentScreen || project.screens.length <= 1) {
      return;
    }
    Modal.confirm({
      title: "Delete selected screen?",
      content: `Delete "${currentScreen.name}"?`,
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
        await saveProject();
        void message.success("Screen deleted");
      },
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Card size="small" title="Project Archive">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Button type="primary" loading={busy} onClick={() => void exportProject()}>Export project ZIP</Button>
            <Button onClick={() => projectFileRef.current?.click()}>Choose project ZIP</Button>
            <Button disabled={!projectArchiveFile} loading={busy} onClick={() => void validateProject()}>Validate</Button>
            <Button danger disabled={!projectArchiveFile} loading={busy} onClick={() => void importProject()}>Import and replace current</Button>
          </Space>
          <input
            ref={projectFileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setProjectArchiveFile(file);
              setProjectValidation(null);
            }}
          />
          <Typography.Text type="secondary">{projectArchiveFile ? projectArchiveFile.name : "No project archive selected"}</Typography.Text>
          {lastBackupPath ? <Alert type="info" showIcon message="Last import backup" description={lastBackupPath} /> : null}
          <ValidationSummary result={projectValidation} />
        </Space>
      </Card>

      <Card size="small" title="Screen Archive">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text>Selected screen: {currentScreen ? `${currentScreen.name} (${currentScreen.id})` : "none"}</Typography.Text>
          <Space wrap>
            <Button type="primary" disabled={!currentScreen} loading={busy} onClick={() => void exportScreen()}>Export selected screen ZIP</Button>
            <Select
              value={dependencyMode}
              style={{ width: 170 }}
              onChange={setDependencyMode}
              options={[{ label: "Safe dependencies", value: "safe" }, { label: "Minimal dependencies", value: "minimal" }]}
            />
            <Button onClick={() => screenFileRef.current?.click()}>Choose screen ZIP</Button>
            <Button disabled={!screenArchiveFile} loading={busy} onClick={() => void validateScreen()}>Validate</Button>
            <Select
              value={screenMode}
              style={{ width: 160 }}
              onChange={setScreenMode}
              options={[{ label: "Add screen", value: "add" }, { label: "Replace selected", value: "replace" }]}
            />
            <Button disabled={!screenArchiveFile} loading={busy} onClick={() => void importScreen()}>{screenMode === "replace" ? "Replace selected screen" : "Import screen"}</Button>
            <Button danger disabled={!currentScreen || project.screens.length <= 1} onClick={deleteCurrentScreen}>Delete selected screen</Button>
          </Space>
          <input
            ref={screenFileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setScreenArchiveFile(file);
              setScreenValidation(null);
            }}
          />
          <Typography.Text type="secondary">{screenArchiveFile ? screenArchiveFile.name : "No screen archive selected"}</Typography.Text>
          <ValidationSummary result={screenValidation} />
        </Space>
      </Card>

      <Card size="small" title="Danger Zone">
        <Typography.Paragraph type="secondary">
          Reset requires explicit confirmation and creates a normal project save. Use full project export first if you need a portable backup.
        </Typography.Paragraph>
        <Divider />
        <Button danger onClick={resetProject}>Reset project</Button>
      </Card>
    </Space>
  );
}
