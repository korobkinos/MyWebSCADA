import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "@web-scada/shared";
import { message } from "antd";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";
import { getAssetDisplayPath, normalizeAssetFolderPath } from "../../../utils/asset-path";

const ASSET_FOLDERS_STORAGE_KEY = "screenEditor.assets.folders";
const ASSET_FOLDER_ICONS_STORAGE_KEY = "screenEditor.assets.folderIcons";

type AssetContextMenuState =
  | { type: "asset"; assetId: string; x: number; y: number }
  | { type: "folder"; folderPath: string; x: number; y: number }
  | null;

type FolderRenameState = {
  folderPath: string;
  value: string;
};

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

function getFolderName(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

function replaceFolderPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  const normalized = normalizeFolderPath(path);
  if (normalized === oldPrefix) {
    return newPrefix;
  }
  if (normalized.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${normalized.slice(oldPrefix.length)}`;
  }
  return normalized;
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

function readFolderIcons(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(ASSET_FOLDER_ICONS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [path, value]) => {
        if (typeof value === "string" && value.trim()) {
          const normalizedPath = normalizeFolderPath(path);
          if (normalizedPath) {
            acc[normalizedPath] = value;
          }
        }
        return acc;
      },
      {},
    );
  } catch {
    return {};
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
  onBulkMoveAssetsToFolder?: (
    updates: Array<{ assetId: string; folderPath: string }>,
  ) => Promise<void> | void;
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
    onBulkMoveAssetsToFolder,
    onRefreshAssets,
  } = props;

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [assetScalePercent, setAssetScalePercent] = useState(100);
  const [currentFolder, setCurrentFolder] = useState("");
  const [storedFolders, setStoredFolders] = useState<string[]>(() => readStoredFolders());
  const [folderIcons, setFolderIcons] = useState<Record<string, string>>(() => readFolderIcons());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [operationText, setOperationText] = useState<string | null>(null);
  const [renameAssetId, setRenameAssetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [assetContextMenu, setAssetContextMenu] = useState<AssetContextMenuState>(null);
  const [assetContextMenuPosition, setAssetContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [folderRename, setFolderRename] = useState<FolderRenameState | null>(null);
  const [folderImagePickerPath, setFolderImagePickerPath] = useState<string | null>(null);

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

  const runAssetOperation = useCallback(async (label: string, action: () => Promise<void>) => {
    setOperationText(label);
    try {
      await action();
    } finally {
      setOperationText(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ASSET_FOLDERS_STORAGE_KEY, JSON.stringify(storedFolders));
  }, [storedFolders]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ASSET_FOLDER_ICONS_STORAGE_KEY, JSON.stringify(folderIcons));
  }, [folderIcons]);

  useEffect(() => {
    setFolderIcons((prev) => {
      const validAssetIds = new Set(assets.map((item) => item.id));
      const validFolders = new Set(allFolderPaths);
      let changed = false;
      const next: Record<string, string> = {};
      for (const [folderPath, assetId] of Object.entries(prev)) {
        if (!validFolders.has(folderPath) || !validAssetIds.has(assetId)) {
          changed = true;
          continue;
        }
        next[folderPath] = assetId;
      }
      return changed ? next : prev;
    });
  }, [allFolderPaths, assets]);

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

  useEffect(() => {
    if (!assetContextMenu) {
      setAssetContextMenuPosition(null);
      return;
    }
    setAssetContextMenuPosition({ x: assetContextMenu.x, y: assetContextMenu.y });
    const frame = window.requestAnimationFrame(() => {
      const menu = contextMenuRef.current;
      if (!menu) {
        return;
      }
      const pad = 6;
      const x = Math.min(
        Math.max(pad, assetContextMenu.x),
        Math.max(pad, window.innerWidth - menu.offsetWidth - pad),
      );
      const y = Math.min(
        Math.max(pad, assetContextMenu.y),
        Math.max(pad, window.innerHeight - menu.offsetHeight - pad),
      );
      setAssetContextMenuPosition({ x, y });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assetContextMenu]);

  useEffect(() => {
    if (!assetContextMenu) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) {
        return;
      }
      setAssetContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAssetContextMenu(null);
      }
    };
    const closeOnResize = () => setAssetContextMenu(null);
    window.addEventListener("mousedown", closeOnOutside, true);
    window.addEventListener("contextmenu", closeOnOutside, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside, true);
      window.removeEventListener("contextmenu", closeOnOutside, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [assetContextMenu]);

  const zoomOutAssets = () => {
    setAssetScalePercent((prev) => Math.max(80, prev - 10));
  };

  const zoomInAssets = () => {
    setAssetScalePercent((prev) => Math.min(140, prev + 10));
  };

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

  const applyFolderPathChange = useCallback(
    async (sourceFolderPath: string, targetFolderPath: string, successText: string) => {
      const oldPrefix = normalizeFolderPath(sourceFolderPath);
      const newPrefix = normalizeFolderPath(targetFolderPath);
      if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) {
        return;
      }
      if (allFolderPaths.includes(newPrefix) && oldPrefix !== newPrefix) {
        void message.error("Folder already exists");
        return;
      }

      const affectedAssets = assets
        .map((asset) => {
          const current = normalizeFolderPath(asset.folderPath ?? "");
          const next = replaceFolderPrefix(current, oldPrefix, newPrefix);
          if (next === current) {
            return null;
          }
          return { assetId: asset.id, folderPath: next };
        })
        .filter((item): item is { assetId: string; folderPath: string } => Boolean(item));

      if (affectedAssets.length > 0) {
        if (onBulkMoveAssetsToFolder) {
          await Promise.resolve(onBulkMoveAssetsToFolder(affectedAssets));
        } else if (onMoveAssetToFolder) {
          for (const update of affectedAssets) {
            await Promise.resolve(onMoveAssetToFolder(update.assetId, update.folderPath));
          }
        } else {
          void message.error("Folder move is not available");
          return;
        }
      }

      setStoredFolders((prev) =>
        Array.from(
          new Set(
            prev.map((path) => replaceFolderPrefix(path, oldPrefix, newPrefix)).filter(Boolean),
          ),
        ),
      );
      setFolderIcons((prev) => {
        const next: Record<string, string> = {};
        for (const [path, assetId] of Object.entries(prev)) {
          next[replaceFolderPrefix(path, oldPrefix, newPrefix)] = assetId;
        }
        return next;
      });
      setCurrentFolder((prev) => replaceFolderPrefix(prev, oldPrefix, newPrefix));
      setFolderRename(null);
      void message.success(successText);
    },
    [allFolderPaths, assets, onBulkMoveAssetsToFolder, onMoveAssetToFolder],
  );

  const renameFolder = useCallback(() => {
    if (!folderRename) {
      return;
    }
    const oldPath = normalizeFolderPath(folderRename.folderPath);
    const nextName = folderRename.value.trim();
    if (!oldPath || !nextName || nextName.includes("/") || nextName.includes("\\") || nextName === "." || nextName === "..") {
      return;
    }
    const parent = getParentFolder(oldPath);
    const nextPath = joinFolder(parent, nextName);
    if (!nextPath || nextPath === oldPath) {
      setFolderRename(null);
      return;
    }
    void runAssetOperation("Renaming folder...", async () => {
      await applyFolderPathChange(oldPath, nextPath, "Folder renamed");
    });
  }, [applyFolderPathChange, folderRename, runAssetOperation]);

  const moveFolderUp = useCallback(
    (folderPath: string) => {
      const normalized = normalizeFolderPath(folderPath);
      if (!normalized) {
        return;
      }
      const parent = getParentFolder(normalized);
      if (!parent) {
        return;
      }
      const grandParent = getParentFolder(parent);
      const target = joinFolder(grandParent, getFolderName(normalized));
      if (!target || target === normalized) {
        return;
      }
      void runAssetOperation("Moving folder...", async () => {
        await applyFolderPathChange(normalized, target, "Folder moved");
      });
    },
    [applyFolderPathChange, runAssetOperation],
  );

  const moveFolderToRoot = useCallback(
    (folderPath: string) => {
      const normalized = normalizeFolderPath(folderPath);
      if (!normalized) {
        return;
      }
      const target = normalizeFolderPath(getFolderName(normalized));
      if (!target || target === normalized) {
        return;
      }
      void runAssetOperation("Moving folder...", async () => {
        await applyFolderPathChange(normalized, target, "Folder moved");
      });
    },
    [applyFolderPathChange, runAssetOperation],
  );

  const isFolderEmpty = useCallback(
    (folderPath: string) => {
      const normalized = normalizeFolderPath(folderPath);
      if (!normalized) {
        return false;
      }
      const hasAssets = assets.some((asset) => {
        const assetFolder = normalizeFolderPath(asset.folderPath ?? "");
        return assetFolder === normalized || assetFolder.startsWith(`${normalized}/`);
      });
      if (hasAssets) {
        return false;
      }
      return !allFolderPaths.some((path) => path !== normalized && path.startsWith(`${normalized}/`));
    },
    [allFolderPaths, assets],
  );

  const deleteFolder = useCallback(
    (folderPath: string) => {
      const normalized = normalizeFolderPath(folderPath);
      if (!normalized) {
        return;
      }
      if (!isFolderEmpty(normalized)) {
        void message.warning("Folder is not empty");
        return;
      }
      setStoredFolders((prev) => prev.filter((path) => path !== normalized));
      setFolderIcons((prev) => {
        const next = { ...prev };
        delete next[normalized];
        return next;
      });
      setCurrentFolder((prev) => (prev === normalized ? getParentFolder(normalized) : prev));
      void message.success("Folder deleted");
    },
    [isFolderEmpty],
  );

  const openAssetContextMenu = (event: React.MouseEvent<HTMLElement>, assetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setAssetContextMenu({ type: "asset", assetId, x: event.clientX, y: event.clientY });
  };

  const openFolderContextMenu = (event: React.MouseEvent<HTMLElement>, folderPath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setAssetContextMenu({ type: "folder", folderPath, x: event.clientX, y: event.clientY });
  };

  const assetMenuAsset = useMemo(
    () =>
      assetContextMenu?.type === "asset"
        ? assets.find((asset) => asset.id === assetContextMenu.assetId) ?? null
        : null,
    [assetContextMenu, assets],
  );

  const folderMenuPath = assetContextMenu?.type === "folder" ? assetContextMenu.folderPath : null;

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

        {folderRename ? (
          <div className="screen-editor-assets-inline-panel">
            <div className="screen-editor-assets-inline-panel__title">Rename Folder</div>
            <div className="screen-editor-assets-inline-panel__row">
              <input
                className="workbench-input"
                value={folderRename.value}
                onChange={(event) =>
                  setFolderRename((prev) => (prev ? { ...prev, value: event.target.value } : prev))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    renameFolder();
                  }
                  if (event.key === "Escape") {
                    setFolderRename(null);
                  }
                }}
                autoFocus
              />
            </div>
            <div className="screen-editor-assets-inline-panel__actions">
              <WorkbenchButton variant="primary" onClick={renameFolder}>
                Save
              </WorkbenchButton>
              <WorkbenchButton onClick={() => setFolderRename(null)}>
                Cancel
              </WorkbenchButton>
            </div>
          </div>
        ) : null}

        {folderImagePickerPath ? (
          <div className="screen-editor-assets-inline-panel">
            <div className="screen-editor-assets-inline-panel__title">
              Set Folder Image: {getFolderName(folderImagePickerPath)}
            </div>
            <div className="screen-editor-folder-image-picker">
              {assets.map((asset) => (
                <button
                  key={`folder-icon-${asset.id}`}
                  type="button"
                  className={`screen-editor-folder-image-picker__item${folderIcons[folderImagePickerPath] === asset.id ? " screen-editor-folder-image-picker__item--active" : ""}`}
                  onClick={() => {
                    setFolderIcons((prev) => ({ ...prev, [folderImagePickerPath]: asset.id }));
                    setFolderImagePickerPath(null);
                    void message.success("Folder image set");
                  }}
                >
                  <div className="screen-editor-folder-image-picker__thumb">
                    {asset.previewUrl ? <img src={asset.previewUrl} alt={asset.name} draggable={false} /> : <span>No preview</span>}
                  </div>
                  <span className="screen-editor-folder-image-picker__name">{asset.name}</span>
                </button>
              ))}
            </div>
            <div className="screen-editor-assets-inline-panel__actions">
              <WorkbenchButton
                onClick={() => {
                  setFolderIcons((prev) => {
                    const next = { ...prev };
                    delete next[folderImagePickerPath];
                    return next;
                  });
                  setFolderImagePickerPath(null);
                  void message.success("Folder image removed");
                }}
              >
                Remove Image
              </WorkbenchButton>
              <WorkbenchButton onClick={() => setFolderImagePickerPath(null)}>
                Close
              </WorkbenchButton>
            </div>
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
            const name = getFolderName(folderPath);
            const isDragOver = dragOverFolder === folderPath;
            const folderIconAssetId = folderIcons[folderPath];
            const folderIconAsset = folderIconAssetId ? assets.find((asset) => asset.id === folderIconAssetId) ?? null : null;
            return (
              <div
                key={`folder-${folderPath}`}
                className={`screen-editor-asset-folder-tile${isDragOver ? " screen-editor-asset-folder-tile--drag-over" : ""}`}
                title={folderPath}
                onDoubleClick={() => setCurrentFolder(folderPath)}
                onContextMenu={(event) => openFolderContextMenu(event, folderPath)}
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
                <div className="screen-editor-asset-folder-icon">
                  {folderIconAsset?.previewUrl ? (
                    <img src={folderIconAsset.previewUrl} alt={folderIconAsset.name} draggable={false} />
                  ) : (
                    "DIR"
                  )}
                </div>
                <div className="screen-editor-asset-folder-name">{name}</div>
                <div className="screen-editor-asset-folder-meta">Folder</div>
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
              return (
                <div
                  key={asset.id}
                  className="screen-editor-asset-tile"
                  draggable
                  onContextMenu={(event) => openAssetContextMenu(event, asset.id)}
                  onDoubleClick={() => onViewAsset?.(asset)}
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
                </div>
              );
            })
          )}
        </div>
      </WorkbenchSection>

      {assetContextMenu ? (
        <div
          ref={contextMenuRef}
          className="screen-editor-asset-context-menu"
          style={{
            top: assetContextMenuPosition?.y ?? assetContextMenu.y,
            left: assetContextMenuPosition?.x ?? assetContextMenu.x,
          }}
        >
          {assetContextMenu.type === "asset" && assetMenuAsset ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setAssetContextMenu(null);
                  onAddAssetAsImage(assetMenuAsset);
                }}
              >
                Add to Screen
              </button>
              {onViewAsset ? (
                <button
                  type="button"
                  onClick={() => {
                    setAssetContextMenu(null);
                    onViewAsset(assetMenuAsset);
                  }}
                >
                  View
                </button>
              ) : null}
              {onRenameAsset ? (
                <button
                  type="button"
                  onClick={() => {
                    setAssetContextMenu(null);
                    startRenameAsset(assetMenuAsset);
                  }}
                >
                  Rename
                </button>
              ) : null}
              {onMoveAssetToFolder ? (
                <button
                  type="button"
                  disabled={!normalizeFolderPath(assetMenuAsset.folderPath ?? "")}
                  onClick={() => {
                    const assetFolder = normalizeFolderPath(assetMenuAsset.folderPath ?? "");
                    if (!assetFolder) {
                      return;
                    }
                    const parent = getParentFolder(assetFolder);
                    setAssetContextMenu(null);
                    void runAssetOperation("Moving asset...", async () => {
                      await Promise.resolve(onMoveAssetToFolder(assetMenuAsset.id, parent));
                    });
                  }}
                >
                  Move Up
                </button>
              ) : null}
              {onMoveAssetToFolder ? (
                <button
                  type="button"
                  disabled={!normalizeFolderPath(assetMenuAsset.folderPath ?? "")}
                  onClick={() => {
                    const assetFolder = normalizeFolderPath(assetMenuAsset.folderPath ?? "");
                    if (!assetFolder) {
                      return;
                    }
                    setAssetContextMenu(null);
                    void runAssetOperation("Moving asset...", async () => {
                      await Promise.resolve(onMoveAssetToFolder(assetMenuAsset.id, ""));
                    });
                  }}
                >
                  Move to Root
                </button>
              ) : null}
              {onDeleteAsset ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setAssetContextMenu(null);
                    void runAssetOperation("Deleting asset...", async () => {
                      await Promise.resolve(onDeleteAsset(assetMenuAsset.id));
                    });
                  }}
                >
                  Delete
                </button>
              ) : null}
            </>
          ) : null}

          {assetContextMenu.type === "folder" && folderMenuPath ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setAssetContextMenu(null);
                  setCurrentFolder(folderMenuPath);
                }}
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssetContextMenu(null);
                  setFolderRename({
                    folderPath: folderMenuPath,
                    value: getFolderName(folderMenuPath),
                  });
                }}
              >
                Rename Folder
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssetContextMenu(null);
                  setFolderImagePickerPath(folderMenuPath);
                }}
              >
                Set Folder Image
              </button>
              {getParentFolder(folderMenuPath) ? (
                <button
                  type="button"
                  onClick={() => {
                    setAssetContextMenu(null);
                    moveFolderUp(folderMenuPath);
                  }}
                >
                  Move Folder Up
                </button>
              ) : null}
              {getParentFolder(folderMenuPath) ? (
                <button
                  type="button"
                  onClick={() => {
                    setAssetContextMenu(null);
                    moveFolderToRoot(folderMenuPath);
                  }}
                >
                  Move Folder to Root
                </button>
              ) : null}
              <button
                type="button"
                className="danger"
                disabled={!isFolderEmpty(folderMenuPath)}
                onClick={() => {
                  setAssetContextMenu(null);
                  deleteFolder(folderMenuPath);
                }}
              >
                Delete Folder
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
