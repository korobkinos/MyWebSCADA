import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementLibrary, LibraryElement, MacroDefinition, ProjectLibraryRef } from "@web-scada/shared";
import { api } from "../../../services/api";
import { WorkbenchButton, WorkbenchSection } from "../../../components/workbench";

type ScreenEditorLibrariesWindowProps = {
  libraries: ElementLibrary[];
  attachedLibraries: ProjectLibraryRef[];
  libraryId: string;
  libraryName: string;
  onLibraryIdChange: (value: string) => void;
  onLibraryNameChange: (value: string) => void;
  onCreateLibrary: () => Promise<void>;
  onAttachLibrary: (libraryId: string) => Promise<void>;
  onDetachLibrary: (libraryId: string) => Promise<void>;
  onAddLibraryElementToScreen: (libraryId: string, element: LibraryElement | string) => void;
  onRefreshLibraries?: () => Promise<void>;
  projectMacros: MacroDefinition[];
};

type TabId = "elements" | "assets" | "macros" | "metadata";

function formatOneDecimal(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "0.0";
  }
  const normalized = Math.trunc((value ?? 0) * 10) / 10;
  return normalized.toFixed(1);
}

export function ScreenEditorLibrariesWindow(props: ScreenEditorLibrariesWindowProps) {
  const {
    libraries,
    attachedLibraries,
    libraryId,
    libraryName,
    onLibraryIdChange,
    onLibraryNameChange,
    onCreateLibrary,
    onAttachLibrary,
    onDetachLibrary,
    onAddLibraryElementToScreen,
    onRefreshLibraries,
    projectMacros,
  } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(libraries[0]?.id ?? "");
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

  useEffect(() => {
    if (!selectedLibraryId || !libraries.some((item) => item.id === selectedLibraryId)) {
      setSelectedLibraryId(libraries[0]?.id ?? "");
    }
  }, [libraries, selectedLibraryId]);

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

  const deleteSelectedLibrary = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    const confirmed = window.confirm(`Delete library ${selectedLibrary.name}?`);
    if (!confirmed) {
      return;
    }
    try {
      await api.deleteLibrary(selectedLibrary.id);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to delete";
      if (!window.confirm(`${text}. Force delete?`)) {
        return;
      }
      await api.deleteLibrary(selectedLibrary.id, { force: true });
    }
    await refresh();
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
          <WorkbenchButton onClick={() => void deleteSelectedLibrary()} disabled={!selectedLibrary}>Delete</WorkbenchButton>
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
                  <div key={element.id} className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">{element.name}</div>
                    <div className="screen-editor-item-meta">
                      {element.category ?? "General"} · {formatOneDecimal(element.width)}x{formatOneDecimal(element.height)}
                    </div>
                    {element.description?.trim() ? (
                      <div className="screen-editor-item-meta">{element.description.trim()}</div>
                    ) : null}
                    <div className="screen-editor-item-actions">
                      <WorkbenchButton
                        variant="primary"
                        disabled={!attachedIds.has(selectedLibrary.id)}
                        onClick={() => onAddLibraryElementToScreen(selectedLibrary.id, element)}
                      >
                        Add to screen
                      </WorkbenchButton>
                    </div>
                  </div>
                ))}
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
    </div>
  );
}

