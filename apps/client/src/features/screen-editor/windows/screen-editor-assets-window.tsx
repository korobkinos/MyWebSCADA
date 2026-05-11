import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";
import { getAssetDisplayPath, normalizeAssetFolderPath } from "../../../utils/asset-path";

const ASSET_FOLDERS_STORAGE_KEY = "screenEditor.assets.folders";

function normalizeFolderPath(path: string): string {
  return normalizeAssetFolderPath(path);
}

function joinFolder(parent: string, name: string): string {
  const next = name.trim().replace(/[\\/]+/g, "/");
  if (!next) {
    return normalizeFolderPath(parent);
  }
  return normalizeFolderPath(parent ? `${parent}/${next}` : next);
}

function getFolderSegments(path: string): string[] {
  const normalized = normalizeFolderPath(path);
  return normalized ? normalized.split("/") : [];
}

function getParentFolder(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
}

function readStoredFolders(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(ASSET_FOLDERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return Array.from(
      new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => normalizeFolderPath(item))
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }
}

function collectChildFolderPaths(allFolders: string[], currentFolder: string): string[] {
  const currentSegments = getFolderSegments(currentFolder);
  const currentDepth = currentSegments.length;
  const children = new Set<string>();
  for (const path of allFolders) {
    const segments = getFolderSegments(path);
    if (segments.length <= currentDepth) {
      continue;
    }
    const sameParent = currentSegments.every((segment, index) => segments[index] === segment);
    if (!sameParent) {
      continue;
    }
    const childName = segments[currentDepth]!;
    children.add(joinFolder(currentFolder, childName));
  }
  return [...children].sort((a, b) => a.localeCompare(b));
}

type ScreenEditorAssetsWindowProps = {
  assets: Asset[];
  onUploadAsset: (file: File) => Promise<void>;
  onAddAssetAsImage: (asset: Asset) => void;
  onViewAsset?: (asset: Asset) => void;
  onDeleteAsset?: (assetId: string) => void | Promise<void>;
  onMoveAssetToFolder?: (assetId: string, folderPath: string) => Promise<void> | void;
  onRenameAsset?: (assetId: string, name: string) => Promise<void> | void;
  onRefreshAssets?: () => Promise<void> | void;
};

export function ScreenEditorAssetsWindow(props: ScreenEditorAssetsWindowProps) {
  const {
    assets,
    onUploadAsset,
    onAddAssetAsImage,
    onViewAsset,
    onDeleteAsset,
    onMoveAssetToFolder,
    onRenameAsset,
    onRefreshAssets,
  } = props;

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [assetScalePercent, setAssetScalePercent] = useState(100);
  const [currentFolder, setCurrentFolder] = useState("");
  const [storedFolders, setStoredFolders] = useState<string[]>(() => readStoredFolders());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [operationText, setOperationText] = useState<string | null>(null);
  const [renameAssetId, setRenameAssetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const allFolderPaths = useMemo(() => {
    const fromAssets = assets
      .map((asset) => normalizeFolderPath(asset.folderPath ?? ""))
      .filter(Boolean);
    return Array.from(new Set([...storedFolders, ...fromAssets])).sort((a, b) => a.localeCompare(b));
  }, [assets, storedFolders]);

  const visibleFolders = useMemo(
    () => collectChildFolderPaths(allFolderPaths, currentFolder),
    [allFolderPaths, currentFolder],
  );

  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (asset) => normalizeFolderPath(asset.folderPath ?? "") === currentFolder,
      ),
    [assets, currentFolder],
  );

  const breadcrumbs = useMemo(() => {
    const segments = getFolderSegments(currentFolder);
    const items: Array<{ label: string; path: string }> = [{ label: "Root", path: "" }];
    let path = "";
    for (const segment of segments) {
      path = joinFolder(path, segment);
      items.push({ label: segment, path });
    }
    return items;
  }, [currentFolder]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ASSET_FOLDERS_STORAGE_KEY, JSON.stringify(storedFolders));
  }, [storedFolders]);

  useEffect(() => {
    if (!currentFolder) {
      return;
    }
    if (allFolderPaths.includes(currentFolder)) {
      return;
    }
    const parent = getParentFolder(currentFolder);
    setCurrentFolder(allFolderPaths.includes(parent) ? parent : "");
  }, [allFolderPaths, currentFolder]);

  const zoomOutAssets = () => {
    setAssetScalePercent((prev) => Math.max(80, prev - 10));
  };

  const zoomInAssets = () => {
    setAssetScalePercent((prev) => Math.min(140, prev + 10));
  };

  const runAssetOperation = useCallback(async (label: string, action: () => Promise<void>) => {
    setOperationText(label);
    try {
      await action();
    } finally {
      setOperationText(null);
    }
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      void runAssetOperation("Uploading image...", async () => {
        await onUploadAsset(file);
      });
    }
  };

  const parseAssetDragPayload = (event: React.DragEvent<HTMLElement>): string | null => {
    const raw = event.dataTransfer.getData("application/web-scada-item");
    if (!raw) {
      return null;
    }
    try {
      const payload = JSON.parse(raw) as { kind?: string; assetId?: string };
      if (payload.assetId && (!payload.kind || payload.kind === "asset")) {
        return payload.assetId;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const canAcceptAssetDrag = (event: React.DragEvent<HTMLElement>): boolean => {
    const types = Array.from(event.dataTransfer.types ?? []);
    return (
      types.includes("application/web-scada-item") ||
      types.includes("application/web-scada-asset") ||
      types.includes("text/plain")
    );
  };

  const moveAsset = (event: React.DragEvent<HTMLElement>, folderPath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolder(null);
    const assetId = parseAssetDragPayload(event);
    if (!assetId || !onMoveAssetToFolder) {
      return;
    }
    void runAssetOperation("Moving asset...", async () => {
      await Promise.resolve(onMoveAssetToFolder(assetId, folderPath));
    });
  };

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      return;
    }
    const path = joinFolder(currentFolder, name);
    if (!path) {
      return;
    }
    setStoredFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setIsCreatingFolder(false);
    setNewFolderName("");
  };

  const startRenameAsset = (asset: Asset) => {
    setRenameAssetId(asset.id);
    setRenameValue(asset.name);
  };

  const cancelRenameAsset = () => {
    setRenameAssetId(null);
    setRenameValue("");
  };

  const saveRenameAsset = (asset: Asset) => {
    if (!onRenameAsset) {
      return;
    }
    const nextName = renameValue.trim();
    if (!nextName || nextName === asset.name) {
      cancelRenameAsset();
      return;
    }
    void runAssetOperation("Renaming asset...", async () => {
      await Promise.resolve(onRenameAsset(asset.id, nextName));
    });
    cancelRenameAsset();
  };

  return (
    <div className="screen-editor-window-content screen-editor-assets-window">
      <WorkbenchSection title="ASSETS">
        <div className="screen-editor-assets-toolbar">
          <WorkbenchButton onClick={() => uploadInputRef.current?.click()}>
            Upload Image
          </WorkbenchButton>

          {isCreatingFolder ? (
            <div className="screen-editor-assets-folder-create">
              <input
                className="workbench-input screen-editor-assets-folder-create__input"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    createFolder();
                  }
                  if (event.key === "Escape") {
                    setIsCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                placeholder="Folder name"
              />
              <WorkbenchButton className="screen-editor-asset-scale-button" onClick={createFolder}>
                Create
              </WorkbenchButton>
              <WorkbenchButton
                className="screen-editor-asset-scale-button"
                onClick={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName("");
                }}
              >
                Cancel
              </WorkbenchButton>
            </div>
          ) : (
            <WorkbenchButton className="screen-editor-asset-scale-button" onClick={() => setIsCreatingFolder(true)}>
              New Folder
            </WorkbenchButton>
          )}

          {onRefreshAssets ? (
            <WorkbenchButton
              className="screen-editor-asset-scale-button"
              onClick={() => {
                void runAssetOperation("Refreshing assets...", async () => {
                  await Promise.resolve(onRefreshAssets());
                });
              }}
            >
              Refresh
            </WorkbenchButton>
          ) : null}

          <div className="screen-editor-assets-toolbar__spacer" />

          <div className="screen-editor-asset-scale-controls">
            <span className="screen-editor-assets-tile-size-label">Tile: {assetScalePercent}%</span>
            <WorkbenchButton
              className="screen-editor-asset-scale-button"
              onClick={zoomOutAssets}
              disabled={assetScalePercent <= 80}
              title="Decrease tile size"
            >
              -
            </WorkbenchButton>
            <WorkbenchButton
              className="screen-editor-asset-scale-button"
              onClick={zoomInAssets}
              disabled={assetScalePercent >= 140}
              title="Increase tile size"
            >
              +
            </WorkbenchButton>
          </div>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        {operationText ? (
          <div className="screen-editor-operation-bar">
            <div className="screen-editor-operation-bar__spinner" />
            <span>{operationText}</span>
          </div>
        ) : null}

        <div className="screen-editor-assets-breadcrumbs">
          {breadcrumbs.map((item, index) => (
            <button
              key={item.path || "root"}
              type="button"
              className={`screen-editor-assets-breadcrumb${item.path === currentFolder ? " screen-editor-assets-breadcrumb--active" : ""}`}
              onClick={() => setCurrentFolder(item.path)}
            >
              {index > 0 ? <span className="screen-editor-assets-breadcrumb-sep">/</span> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div
          className="screen-editor-asset-grid"
          style={
            {
              "--screen-editor-asset-scale": String(assetScalePercent / 100),
            } as React.CSSProperties
          }
          onDragOver={(event) => {
            if (!onMoveAssetToFolder) {
              return;
            }
            if (canAcceptAssetDrag(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => moveAsset(event, currentFolder)}
        >
          {visibleFolders.map((folderPath) => {
            const parts = folderPath.split("/");
            const name = parts[parts.length - 1] ?? folderPath;
            const isDragOver = dragOverFolder === folderPath;
            return (
              <div
                key={`folder-${folderPath}`}
                className={`screen-editor-asset-folder-tile${isDragOver ? " screen-editor-asset-folder-tile--drag-over" : ""}`}
                title={folderPath}
                onDoubleClick={() => setCurrentFolder(folderPath)}
                onDragOver={(event) => {
                  if (!onMoveAssetToFolder || !canAcceptAssetDrag(event)) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverFolder(folderPath);
                }}
                onDragLeave={() => {
                  if (dragOverFolder === folderPath) {
                    setDragOverFolder(null);
                  }
                }}
                onDrop={(event) => moveAsset(event, folderPath)}
              >
                <div className="screen-editor-asset-folder-icon">DIR</div>
                <div className="screen-editor-asset-folder-name">{name}</div>
              </div>
            );
          })}

          {visibleFolders.length === 0 && visibleAssets.length === 0 ? (
            <div className="screen-editor-empty-state">
              {assets.length === 0 ? "No assets uploaded yet" : "Folder is empty"}
            </div>
          ) : (
            visibleAssets.map((asset) => {
              const isRenaming = renameAssetId === asset.id;
              const currentAssetFolder = normalizeFolderPath(asset.folderPath ?? "");
              const parentFolder = getParentFolder(currentAssetFolder);
              const canMoveAsset = Boolean(onMoveAssetToFolder) && currentAssetFolder.length > 0;

              return (
                <div
                  key={asset.id}
                  className="screen-editor-asset-tile"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copyMove";
                    event.dataTransfer.setData(
                      "application/web-scada-item",
                      JSON.stringify({
                        kind: "asset",
                        assetId: asset.id,
                      }),
                    );
                    event.dataTransfer.setData("text/plain", getAssetDisplayPath(asset));
                  }}
                >
                  <div className="screen-editor-asset-thumb">
                    {asset.previewUrl ? (
                      <img src={asset.previewUrl} alt={asset.name} draggable={false} />
                    ) : (
                      <div className="screen-editor-asset-thumb__placeholder">
                        No preview
                      </div>
                    )}
                  </div>

                  {isRenaming ? (
                    <div className="screen-editor-asset-rename-row">
                      <input
                        className="workbench-input screen-editor-asset-rename-input"
                        value={renameValue}
                        maxLength={120}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            saveRenameAsset(asset);
                          }
                          if (event.key === "Escape") {
                            cancelRenameAsset();
                          }
                        }}
                        autoFocus
                      />
                      <WorkbenchButton className="screen-editor-asset-action-button" onClick={() => saveRenameAsset(asset)}>
                        Save
                      </WorkbenchButton>
                      <WorkbenchButton className="screen-editor-asset-action-button" onClick={cancelRenameAsset}>
                        Cancel
                      </WorkbenchButton>
                    </div>
                  ) : (
                    <div className="screen-editor-asset-tile__name" title={getAssetDisplayPath(asset)}>
                      {asset.name}
                    </div>
                  )}

                  <div className="screen-editor-asset-tile__meta">
                    {asset.type?.toUpperCase() ?? ""}
                    {asset.width && asset.height ? ` · ${asset.width}x${asset.height}` : ""}
                    {asset.size ? ` · ${(asset.size / 1024).toFixed(1)} KB` : ""}
                  </div>

                  <div className="screen-editor-asset-tile__actions">
                    <WorkbenchButton
                      variant="primary"
                      className="screen-editor-asset-action-button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={() => onAddAssetAsImage(asset)}
                    >
                      Add
                    </WorkbenchButton>

                    {onViewAsset ? (
                      <WorkbenchButton
                        className="screen-editor-asset-action-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => onViewAsset(asset)}
                      >
                        View
                      </WorkbenchButton>
                    ) : null}

                    {onDeleteAsset ? (
                      <WorkbenchButton
                        variant="danger"
                        className="screen-editor-asset-action-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => {
                          void runAssetOperation("Deleting asset...", async () => {
                            await Promise.resolve(onDeleteAsset(asset.id));
                          });
                        }}
                      >
                        Del
                      </WorkbenchButton>
                    ) : null}

                    <WorkbenchButton
                      className="screen-editor-asset-action-button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      disabled={!canMoveAsset}
                      onClick={() => {
                        if (!onMoveAssetToFolder) {
                          return;
                        }
                        void runAssetOperation("Moving asset...", async () => {
                          await Promise.resolve(onMoveAssetToFolder(asset.id, parentFolder));
                        });
                      }}
                    >
                      Up
                    </WorkbenchButton>

                    <WorkbenchButton
                      className="screen-editor-asset-action-button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      disabled={!canMoveAsset}
                      onClick={() => {
                        if (!onMoveAssetToFolder) {
                          return;
                        }
                        void runAssetOperation("Moving asset...", async () => {
                          await Promise.resolve(onMoveAssetToFolder(asset.id, ""));
                        });
                      }}
                    >
                      Root
                    </WorkbenchButton>

                    {onRenameAsset ? (
                      <WorkbenchButton
                        className="screen-editor-asset-action-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => startRenameAsset(asset)}
                      >
                        Rename
                      </WorkbenchButton>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </WorkbenchSection>
    </div>
  );
}

