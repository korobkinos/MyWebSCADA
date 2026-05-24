import { useCallback, useMemo, useRef } from "react";
import type {
  Asset,
  DriverStatus,
  EditorCommand,
  ElementLibrary,
  HmiObject,
  HmiScreen,
  LibraryElement,
  RuntimeState,
  ScadaProject,
  ScreenKind,
  MacroDefinition,
} from "@web-scada/shared";
import { WorkbenchButton, type WorkbenchWindowDefinition } from "../../../components/workbench";
import { ObjectPropertyPanel } from "../../../components/object-property-panel";
import { ArchivePage } from "../../../pages/archive-page";
import { EventsPage } from "../../../pages/events-page";
import { ProjectManagerPage } from "../../../pages/project-manager-page";
import { getAssetDisplayPath } from "../../../utils/asset-path";
import { findLibraryOriginForObject } from "../utils/library-origin";
import {
  ScreenEditorAssetsWindow,
  ScreenEditorDriversWindow,
  ScreenEditorLayersWindow,
  ScreenEditorLibrariesWindow,
  ScreenEditorMacrosWindow,
  ScreenEditorProjectSettingsWindow,
  ScreenEditorRuntimeWindow,
  ScreenEditorSaveSelectionWindow,
  ScreenEditorScreenSettingsWindow,
  ScreenEditorScreensWindow,
  ScreenEditorSearchWindow,
  ScreenEditorTagsWindow,
  ScreenEditorUserManagementWindow,
} from "../windows";

type UseEditorWindowDefinitionsParams = {
  project: ScadaProject | null;
  screen: HmiScreen | null | undefined;
  assets: Asset[];
  libraries: ElementLibrary[];
  drivers: DriverStatus[];
  runtime: RuntimeState;
  selectedObjects: HmiObject[];
  selectedBounds: { width: number; height: number } | null;
  activeObject: HmiObject | null;
  selection: { selectedObjectIds: string[]; activeObjectId?: string | null };
  filteredScreens: HmiScreen[];
  screenSearch: string;
  setScreenSearch: (value: string) => void;
  screenKindFilter: "all" | ScreenKind;
  setScreenKindFilter: (value: "all" | ScreenKind) => void;
  screenViewMode: "grid" | "list";
  setScreenViewMode: (value: "grid" | "list") => void;
  newScreenKind: ScreenKind;
  setNewScreenKind: (value: ScreenKind) => void;
  addScreen: (kind: ScreenKind) => void;
  setCurrentScreen: (screenId: string) => void;
  duplicateScreenLocal: (screen: HmiScreen) => void;
  setStartScreen: (screenId: string) => void;
  requestDeleteScreen: (screenId: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  updateProjectJson: (project: ScadaProject) => void;
  handleSaveProject: () => Promise<void>;
  isSavingProject: boolean;
  canUsersView: boolean;
  canUsersWrite: boolean;
  canUsersDelete: boolean;
  canUsersChangePassword: boolean;
  canMacrosView: boolean;
  updateScreen: (screenId: string, patch: Partial<HmiScreen>) => void;
  startScreenName: string;
  startRuntime: () => Promise<void>;
  stopRuntime: () => Promise<void>;
  refreshRuntimeStatus: () => Promise<void>;
  navigateToRuntime: () => void;
  setSelectedObjects: (ids: string[], activeId?: string) => void;
  deleteSelectionWithHistory: () => void;
  runCommand: (command: EditorCommand) => void;
  canDelete: boolean;
  canLock: boolean;
  canUnlock: boolean;
  saveTargetLibraryId: string;
  setSaveTargetLibraryId: (value: string) => void;
  saveElementName: string;
  setSaveElementName: (value: string) => void;
  saveElementCategory: string;
  setSaveElementCategory: (value: string) => void;
  saveElementDescription: string;
  setSaveElementDescription: (value: string) => void;
  saveSelectionMacroWarningText: string;
  onSaveSelectionAsLibraryElement: () => Promise<void>;
  newLibraryId: string;
  setNewLibraryId: (value: string) => void;
  newLibraryName: string;
  setNewLibraryName: (value: string) => void;
  createLibrary: () => Promise<void>;
  attachLibrary: (libraryId: string) => Promise<void>;
  detachLibrary: (libraryId: string) => Promise<void>;
  addLibraryElementInstance: (libraryId: string, elementOrId: LibraryElement | string, position?: { x: number; y: number }) => void;
  prepareLibraryElementUpdate: (libraryId: string, element: LibraryElement) => Promise<{ libraryId: string; elementId: string; elementName: string; confirmationLines: string[]; flattenedCount: number; flattenedObjects: HmiObject[]; macroIds: string[]; } | null>;
  executeLibraryElementUpdate: (payload: { libraryId: string; elementId: string; elementName: string; flattenedObjects: HmiObject[]; macroIds: string[]; }) => Promise<void>;
  saveLibraryElementCopyFromSelection: (libraryId: string, element: LibraryElement, copyName: string) => Promise<void>;
  loadLibraries: () => Promise<void>;
  projectMacros: MacroDefinition[];
  onUploadProjectAsset: (file: File) => Promise<void>;
  addAssetAsImage: (asset: Asset, position?: { x: number; y: number }) => void;
  moveAssetToFolder: (assetId: string, folderPath: string) => Promise<void>;
  bulkMoveAssetsToFolder: (updates: Array<{ assetId: string; folderPath: string }>) => Promise<void>;
  renameAsset: (assetId: string, name: string) => Promise<void>;
  refreshAssets: () => Promise<void>;
  handleDeleteAsset: (assetId: string) => Promise<void>;
  viewAsset: Asset | null;
  setViewAssetId: (assetId: string | null) => void;
  saveObjectProperties: () => Promise<void>;
  patchActiveObject: (patch: Partial<HmiObject>) => void;
  patchObjectById: (objectId: string, patch: Partial<HmiObject>) => void;
  deleteActiveObject: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
  openWindow: (definition: WorkbenchWindowDefinition) => void;
  closeWindow: (id: string) => void;
};

export function useEditorWindowDefinitions(params: UseEditorWindowDefinitionsParams) {
  const definitionsRef = useRef<WorkbenchWindowDefinition[]>([]);

  const openDefinedWindow = useCallback(
    (id: string) => {
      const definition = definitionsRef.current.find((item) => item.id === id);
      if (definition) {
        params.openWindow(definition);
      }
    },
    [params],
  );

  const windowDefinitions = useMemo<WorkbenchWindowDefinition[]>(
    () => {
      const project = params.project;
      const screen = params.screen;
      if (!project || !screen) {
        return [];
      }
      return [
      {
        id: "screens",
        title: "Screens",
        defaultRect: { x: 90, y: 80, width: 440, height: 620 },
        minWidth: 320,
        minHeight: 360,
        render: () => (
          <ScreenEditorScreensWindow
            screens={params.filteredScreens}
            currentScreenId={screen.id}
            startScreenId={project.startScreenId}
            search={params.screenSearch}
            onSearchChange={params.setScreenSearch}
            kindFilter={params.screenKindFilter}
            onKindFilterChange={params.setScreenKindFilter}
            viewMode={params.screenViewMode}
            onViewModeChange={params.setScreenViewMode}
            newScreenKind={params.newScreenKind}
            onNewScreenKindChange={params.setNewScreenKind}
            onCreateScreen={params.addScreen}
            onSelectScreen={params.setCurrentScreen}
            onDuplicateScreen={params.duplicateScreenLocal}
            onSetStartScreen={params.setStartScreen}
            onDeleteScreen={params.requestDeleteScreen}
            onOpenScreenSettings={() => openDefinedWindow("screenSettings")}
          />
        ),
      },
      {
        id: "search",
        title: "Search",
        defaultRect: { x: 120, y: 100, width: 520, height: 620 },
        minWidth: 360,
        minHeight: 360,
        render: () => (
          <ScreenEditorSearchWindow
            screens={project.screens}
            query={params.searchQuery}
            onQueryChange={params.setSearchQuery}
            onSelectScreen={params.setCurrentScreen}
            onSelectObject={(screenId, objectId) => {
              params.setCurrentScreen(screenId);
              params.setSelectedObjects([objectId], objectId);
              params.closeWindow("search");
            }}
          />
        ),
      },
      {
        id: "projectManager",
        title: "Project Manager",
        defaultRect: { x: 160, y: 90, width: 980, height: 720 },
        minWidth: 720,
        minHeight: 460,
        render: () => <ProjectManagerPage />,
      },
      {
        id: "projectSettings",
        title: "Project Settings",
        defaultRect: { x: 180, y: 100, width: 560, height: 520 },
        minWidth: 420,
        minHeight: 320,
        render: () => (
          <ScreenEditorProjectSettingsWindow
            project={project}
            onUpdateProject={params.updateProjectJson}
            onSaveProject={params.handleSaveProject}
            isSavingProject={params.isSavingProject}
            canUsersView={params.canUsersView}
            onOpenUserManagement={() => openDefinedWindow("userManagement")}
          />
        ),
      },
      {
        id: "userManagement",
        title: "User Management",
        defaultRect: { x: 170, y: 90, width: 980, height: 660 },
        minWidth: 700,
        minHeight: 420,
        render: () => (
          <ScreenEditorUserManagementWindow
            canWrite={params.canUsersWrite}
            canDelete={params.canUsersDelete}
            canChangePassword={params.canUsersChangePassword}
          />
        ),
      },
      {
        id: "screenSettings",
        title: "Screen Settings",
        defaultRect: { x: 220, y: 120, width: 520, height: 520 },
        minWidth: 420,
        minHeight: 320,
        render: () => (
          <ScreenEditorScreenSettingsWindow
            screen={screen}
            onUpdateScreen={(patch) => params.updateScreen(screen.id, patch)}
          />
        ),
      },
      {
        id: "runtime",
        title: "Runtime",
        defaultRect: { x: 160, y: 120, width: 420, height: 360 },
        minWidth: 320,
        minHeight: 260,
        render: () => (
          <ScreenEditorRuntimeWindow
            runtime={params.runtime}
            startScreenName={params.startScreenName}
            currentScreenName={screen.name}
            onOpenRuntime={params.navigateToRuntime}
            onStartRuntime={params.startRuntime}
            onStopRuntime={params.stopRuntime}
            onRefreshStatus={params.refreshRuntimeStatus}
          />
        ),
      },
      {
        id: "layers",
        title: "Layers / Object Tree",
        defaultRect: { x: 220, y: 140, width: 420, height: 620 },
        minWidth: 320,
        minHeight: 360,
        render: () => (
          <ScreenEditorLayersWindow
            screen={screen}
            libraries={params.libraries}
            selectedObjectIds={params.selection.selectedObjectIds}
            activeObjectId={params.selection.activeObjectId ?? undefined}
            onSelectObject={(objectId) => params.setSelectedObjects([objectId], objectId)}
            onOpenObjectPropertiesForObject={(objectId) => {
              params.setSelectedObjects([objectId], objectId);
              openDefinedWindow("objectProperties");
            }}
            onDeleteSelected={params.deleteSelectionWithHistory}
            onLockSelected={() => params.runCommand({ type: "lockSelected" })}
            onUnlockSelected={() => params.runCommand({ type: "unlockSelected" })}
            onBringToFront={params.onBringToFront}
            onSendToBack={params.onSendToBack}
            onMoveForward={params.onMoveForward}
            onMoveBackward={params.onMoveBackward}
            canDelete={params.canDelete}
            canLock={params.canLock}
            canUnlock={params.canUnlock}
          />
        ),
      },
      {
        id: "saveSelectionAsElement",
        title: "Save Selection As Library Element",
        defaultRect: { x: 260, y: 120, width: 520, height: 460 },
        minWidth: 420,
        minHeight: 320,
        render: () => (
          <ScreenEditorSaveSelectionWindow
            selectedObjects={params.selectedObjects}
            libraries={params.libraries}
            targetLibraryId={params.saveTargetLibraryId}
            setTargetLibraryId={params.setSaveTargetLibraryId}
            elementName={params.saveElementName}
            setElementName={params.setSaveElementName}
            category={params.saveElementCategory}
            setCategory={params.setSaveElementCategory}
            description={params.saveElementDescription}
            setDescription={params.setSaveElementDescription}
            width={params.selectedBounds?.width ?? screen.width}
            height={params.selectedBounds?.height ?? screen.height}
            macroWarningText={params.saveSelectionMacroWarningText}
            onSave={params.onSaveSelectionAsLibraryElement}
            onCancel={() => params.closeWindow("saveSelectionAsElement")}
            onOpenLibraries={() => openDefinedWindow("libraries")}
          />
        ),
      },
      {
        id: "tags",
        title: "Tags",
        defaultRect: { x: 120, y: 80, width: 1000, height: 520 },
        minWidth: 360,
        minHeight: 260,
        render: () => <ScreenEditorTagsWindow />,
      },
      {
        id: "archive",
        title: "Archive",
        defaultRect: { x: 140, y: 90, width: 1290, height: 680 },
        minWidth: 1290,
        minHeight: 680,
        render: () => <ArchivePage />,
      },
      {
        id: "events",
        title: "Event Manager",
        defaultRect: { x: 140, y: 90, width: 1100, height: 680 },
        minWidth: 720,
        minHeight: 420,
        render: () => <EventsPage />,
      },
      ...(params.canMacrosView
        ? [{
            id: "macros",
            title: "Macros",
            defaultRect: { x: 140, y: 80, width: 1400, height: 800 },
            minWidth: 720,
            minHeight: 460,
            render: () => <ScreenEditorMacrosWindow />,
          }]
        : []),
      {
        id: "drivers",
        title: "Drivers / OPC UA / Simulation",
        defaultRect: { x: 160, y: 100, width: 800, height: 840 },
        minWidth: 380,
        minHeight: 260,
        render: () => <ScreenEditorDriversWindow drivers={params.drivers} />,
      },
      {
        id: "assets",
        title: "Assets",
        defaultRect: { x: 180, y: 120, width: 620, height: 540 },
        minWidth: 420,
        minHeight: 320,
        render: () => (
          <ScreenEditorAssetsWindow
            assets={params.assets}
            onUploadAsset={params.onUploadProjectAsset}
            onAddAssetAsImage={params.addAssetAsImage}
            onMoveAssetToFolder={params.moveAssetToFolder}
            onBulkMoveAssetsToFolder={params.bulkMoveAssetsToFolder}
            onRenameAsset={params.renameAsset}
            onRefreshAssets={params.refreshAssets}
            onDeleteAsset={params.handleDeleteAsset}
            onViewAsset={(asset) => {
              params.setViewAssetId(asset.id);
              openDefinedWindow("assetViewer");
            }}
          />
        ),
      },
      {
        id: "libraries",
        title: "Libraries",
        defaultRect: { x: 200, y: 140, width: 660, height: 560 },
        minWidth: 460,
        minHeight: 340,
        render: () => (
          <ScreenEditorLibrariesWindow
            libraries={params.libraries}
            attachedLibraries={project.libraries ?? []}
            selectedObjectsCount={params.selectedObjects.length}
            libraryId={params.newLibraryId}
            libraryName={params.newLibraryName}
            project={project}
            onUpdateProjectJson={params.updateProjectJson}
            onLibraryIdChange={params.setNewLibraryId}
            onLibraryNameChange={params.setNewLibraryName}
            onCreateLibrary={params.createLibrary}
            onAttachLibrary={params.attachLibrary}
            onDetachLibrary={params.detachLibrary}
            onAddLibraryElementToScreen={params.addLibraryElementInstance}
            onPrepareLibraryElementUpdate={params.prepareLibraryElementUpdate}
            onExecuteLibraryElementUpdate={params.executeLibraryElementUpdate}
            onSaveLibraryElementCopyFromSelection={params.saveLibraryElementCopyFromSelection}
            onRefreshLibraries={params.loadLibraries}
            projectMacros={params.projectMacros}
          />
        ),
      },
      {
        id: "assetViewer",
        title: params.viewAsset ? `Asset: ${getAssetDisplayPath(params.viewAsset)}` : "Asset Viewer",
        defaultRect: { x: 240, y: 120, width: 640, height: 520 },
        minWidth: 360,
        minHeight: 260,
        render: () =>
          params.viewAsset ? (
            <div className="screen-editor-window-content screen-editor-asset-viewer">
              <div className="screen-editor-asset-viewer__preview">
                {params.viewAsset.previewUrl ? (
                  <img src={params.viewAsset.previewUrl} alt={params.viewAsset.name} />
                ) : (
                  <span>No preview</span>
                )}
              </div>
              <div className="screen-editor-asset-viewer__info">
                <div><strong>Name:</strong> {params.viewAsset.name}</div>
                <div><strong>Path:</strong> {getAssetDisplayPath(params.viewAsset)}</div>
                <div><strong>ID:</strong> {params.viewAsset.id}</div>
                <div><strong>Type:</strong> {params.viewAsset.type?.toUpperCase() ?? "-"}</div>
                <div>
                  <strong>Size:</strong>{" "}
                  {params.viewAsset.width && params.viewAsset.height
                    ? `${params.viewAsset.width} x ${params.viewAsset.height} px`
                    : "-"}
                </div>
                <div>
                  <strong>File size:</strong>{" "}
                  {params.viewAsset.size ? `${(params.viewAsset.size / 1024).toFixed(1)} KB` : "-"}
                </div>
                <div className="screen-editor-asset-viewer__actions">
                  <WorkbenchButton
                    variant="primary"
                    onClick={() => params.addAssetAsImage(params.viewAsset!)}
                  >
                    Add to Screen
                  </WorkbenchButton>
                </div>
              </div>
            </div>
          ) : (
            <div className="screen-editor-empty-state">No asset selected</div>
          ),
      },
      {
        id: "objectProperties",
        title: "Object Properties",
        defaultRect: { x: 280, y: 100, width: 420, height: 620 },
        minWidth: 320,
        minHeight: 360,
        render: () => {
          const libraryOrigin = params.activeObject
            ? findLibraryOriginForObject(screen.objects, params.activeObject.id, params.libraries)
            : null;

          return (
          <div className="screen-editor-window-content screen-editor-object-properties-window">
            <div className="object-property-panel-toolbar">
              <WorkbenchButton
                variant="primary"
                onClick={() => void params.saveObjectProperties()}
                disabled={!params.activeObject || params.isSavingProject}
              >
                Save Object
              </WorkbenchButton>
            </div>
            <div className="screen-editor-object-properties-scroll">
              {libraryOrigin ? (
                <div className="screen-editor-library-origin-note">
                  <div className="screen-editor-library-origin-note__title">
                    {libraryOrigin.kind === "instanceRoot" ? "Library Instance" : "Library Element Child"}
                  </div>
                  <div>Library: {libraryOrigin.libraryName} ({libraryOrigin.libraryId})</div>
                  <div>Element: {libraryOrigin.elementName} ({libraryOrigin.elementId})</div>
                  {libraryOrigin.kind === "instanceChild" ? (
                    <>
                      <div>Parent instance: {libraryOrigin.instanceName || libraryOrigin.instanceId}</div>
                      <div>Child object: {libraryOrigin.childName || libraryOrigin.childId} ({libraryOrigin.childType})</div>
                      <div>Path: {libraryOrigin.childPath}</div>
                    </>
                  ) : null}
                </div>
              ) : null}
              <ObjectPropertyPanel
                project={project}
                screen={screen}
                assets={params.assets}
                libraries={params.libraries}
                object={params.activeObject}
                onPatch={params.patchActiveObject}
                onPatchObjectById={params.patchObjectById}
                onDelete={params.deleteActiveObject}
                onBringToFront={params.onBringToFront}
                onSendToBack={params.onSendToBack}
                onMoveForward={params.onMoveForward}
                onMoveBackward={params.onMoveBackward}
              />
            </div>
          </div>
        );
        },
      },
    ];
    },
    [openDefinedWindow, params],
  );

  definitionsRef.current = windowDefinitions;

  return {
    windowDefinitions,
    openDefinedWindow,
  };
}
