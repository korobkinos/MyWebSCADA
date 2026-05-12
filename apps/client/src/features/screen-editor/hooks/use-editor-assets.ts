import { useCallback, useMemo, useState } from "react";
import type { Asset, HmiObject, HmiScreen, ScadaProject } from "@web-scada/shared";
import { normalizeObjectsToGroup } from "@web-scada/shared";
import { message } from "antd";
import { createObjectByType } from "../../../hmi/editor/default-object-factory";
import { importSvgAssetToPrimitives } from "../../../hmi/editor/svg-primitive-import";
import { useScadaStore } from "../../../store/scada-store";
import { normalizeAssetFolderPath } from "../../../utils/asset-path";

type EditorApiClient = {
  uploadAsset: (file: File, name?: string) => Promise<Asset>;
  deleteAsset: (assetId: string) => Promise<{ ok: boolean; used?: boolean }>;
  updateAsset: (assetId: string, patch: { folderPath?: string; name?: string }) => Promise<unknown>;
};

type UseEditorAssetsParams = {
  project: ScadaProject | null;
  screen: HmiScreen | null | undefined;
  assets: Asset[];
  addObjectWithHistory: (object: HmiObject) => void;
  loadAssets: () => Promise<void>;
  loadProject: () => Promise<void>;
  appendEditorLog: (level: "info" | "success" | "warning" | "error", messageText: string) => void;
  closeWindow: (id: string) => void;
  apiClient: EditorApiClient;
};

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useEditorAssets({
  project,
  screen,
  assets,
  addObjectWithHistory,
  loadAssets,
  loadProject,
  appendEditorLog,
  closeWindow,
  apiClient,
}: UseEditorAssetsParams) {
  const [assetUploadName, setAssetUploadName] = useState("");
  const [viewAssetId, setViewAssetId] = useState<string | null>(null);

  const viewAsset = useMemo(
    () => assets.find((asset) => asset.id === viewAssetId) ?? null,
    [assets, viewAssetId],
  );

  const onUploadProjectAsset = useCallback(
    async (file: File) => {
      try {
        if (!project) {
          return;
        }
        const maxAssetSizeBytes = 10 * 1024 * 1024;
        if (file.size > maxAssetSizeBytes) {
          appendEditorLog("error", `action=asset-upload status=ERROR file=${file.name} error=file-too-large`);
          void message.error("File is too large. Max size is 10 MB.");
          return;
        }
        appendEditorLog("info", `action=asset-upload status=START file=${file.name}`);
        const uploaded = await apiClient.uploadAsset(file, assetUploadName.trim() || undefined);
        await loadAssets();
        await loadProject();
        setAssetUploadName("");
        appendEditorLog("success", `action=asset-upload status=OK asset=${uploaded.name} id=${uploaded.id}`);
        void message.success(`Asset uploaded: ${uploaded.name}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-upload status=ERROR file=${file.name} error=${text || "unknown error"}`);
        if (text.toLowerCase().includes("too large") || text.toLowerCase().includes("file size")) {
          void message.error("File is too large. Max size is 10 MB.");
        } else {
          void message.error(text || "Failed to upload asset");
        }
      }
    },
    [apiClient, appendEditorLog, assetUploadName, loadAssets, loadProject, project],
  );

  const addAssetAsImage = useCallback(
    (asset: Asset, position?: { x: number; y: number }) => {
      if (!screen) {
        return;
      }
      const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
      image.assetId = asset.id;
      image.width = asset.width ?? 80;
      image.height = asset.height ?? 80;
      if (position) {
        const nextX = position.x - image.width / 2;
        const nextY = position.y - image.height / 2;
        image.x = Math.min(Math.max(0, nextX), Math.max(0, screen.width - image.width));
        image.y = Math.min(Math.max(0, nextY), Math.max(0, screen.height - image.height));
      }
      addObjectWithHistory(image);
    },
    [addObjectWithHistory, screen],
  );

  const addSvgAssetAsPrimitives = useCallback(
    async (asset: Asset) => {
      if (!screen) {
        return;
      }
      try {
        const imported = await importSvgAssetToPrimitives(asset);
        const { groupBounds, normalizedObjects } = normalizeObjectsToGroup(imported.objects);
        const group: Extract<HmiObject, { type: "group" }> = {
          id: createId("group"),
          type: "group",
          name: `svg:${asset.name}`,
          x: 10,
          y: 10,
          width: Math.max(1, groupBounds.width),
          height: Math.max(1, groupBounds.height),
          minWidth: 10,
          minHeight: 10,
          objects: normalizedObjects,
        };
        addObjectWithHistory(group);
        if (imported.warnings.length) {
          void message.warning(imported.warnings.join(" | "));
        } else {
          void message.success(`SVG imported as primitives: ${asset.name}`);
        }
      } catch (error) {
        void message.error(error instanceof Error ? error.message : "Failed to import SVG as primitives");
      }
    },
    [addObjectWithHistory, screen],
  );

  const handleDeleteAsset = useCallback(
    async (assetId: string) => {
      try {
        const target = useScadaStore.getState().assets.find((item) => item.id === assetId);
        appendEditorLog("info", `action=asset-delete status=START assetId=${assetId} name=${target?.name ?? ""}`);

        const result = await apiClient.deleteAsset(assetId);

        await loadAssets();
        await loadProject();

        if (viewAssetId === assetId) {
          setViewAssetId(null);
          closeWindow("assetViewer");
        }

        if (result.used) {
          appendEditorLog("warning", `action=asset-delete status=OK assetId=${assetId} used=true`);
          void message.warning("Asset deleted. Some objects now reference missing asset.");
        } else {
          appendEditorLog("success", `action=asset-delete status=OK assetId=${assetId} used=false`);
          void message.success(`Asset deleted${target?.name ? `: ${target.name}` : ""}`);
        }
      } catch (error) {
        const err = error as Error & { status?: number };
        const text = err.message || String(error);
        const normalized = text.toLowerCase();
        appendEditorLog("error", `action=asset-delete status=ERROR assetId=${assetId} error=${text || "unknown error"}`);

        console.error("Asset delete failed", error);

        if (
          err.status === 403 ||
          normalized.includes("403") ||
          normalized.includes("forbidden") ||
          normalized.includes("assets.delete")
        ) {
          void message.error("No permission to delete assets. Required: assets.delete");
          return;
        }

        if (
          err.status === 401 ||
          normalized.includes("401") ||
          normalized.includes("unauthorized")
        ) {
          void message.error("Authorization required. Please login again.");
          return;
        }

        void message.error(text || "Failed to delete asset");
      }
    },
    [apiClient, appendEditorLog, closeWindow, loadAssets, loadProject, viewAssetId],
  );

  const moveAssetToFolder = useCallback(
    async (assetId: string, folderPath: string) => {
      try {
        const normalized = normalizeAssetFolderPath(folderPath);
        const current = useScadaStore.getState().assets.find((item) => item.id === assetId);
        if (!current) {
          return;
        }
        if (normalizeAssetFolderPath(current.folderPath ?? "") === normalized) {
          return;
        }
        const targetFolderLabel = normalized || "root";
        appendEditorLog("info", `action=asset-move status=START asset=${current.name} id=${assetId} to=${targetFolderLabel}`);
        await apiClient.updateAsset(assetId, { folderPath: normalized });
        await loadAssets();
        await loadProject();
        appendEditorLog("success", `action=asset-move status=OK asset=${current.name} id=${assetId} to=${targetFolderLabel}`);
        void message.success("Asset moved");
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-move status=ERROR assetId=${assetId} error=${text || "unknown error"}`);
        void message.error(text || "Failed to move asset");
      }
    },
    [apiClient, appendEditorLog, loadAssets, loadProject],
  );

  const bulkMoveAssetsToFolder = useCallback(
    async (updates: Array<{ assetId: string; folderPath: string }>) => {
      if (!updates.length) {
        return;
      }
      try {
        appendEditorLog("info", `action=asset-folder-bulk-move status=START updates=${updates.length}`);
        for (const update of updates) {
          await apiClient.updateAsset(update.assetId, {
            folderPath: normalizeAssetFolderPath(update.folderPath),
          });
        }
        await loadAssets();
        await loadProject();
        appendEditorLog("success", `action=asset-folder-bulk-move status=OK updates=${updates.length}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-folder-bulk-move status=ERROR error=${text || "unknown error"}`);
        throw error;
      }
    },
    [apiClient, appendEditorLog, loadAssets, loadProject],
  );

  const renameAsset = useCallback(
    async (assetId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) {
        void message.warning("Asset name is required");
        return;
      }
      try {
        const current = useScadaStore.getState().assets.find((item) => item.id === assetId);
        appendEditorLog("info", `action=asset-rename status=START assetId=${assetId} from=${current?.name ?? ""} to=${nextName}`);
        await apiClient.updateAsset(assetId, { name: nextName });
        await loadAssets();
        await loadProject();
        appendEditorLog("success", `action=asset-rename status=OK assetId=${assetId} from=${current?.name ?? ""} to=${nextName}`);
        void message.success("Asset renamed");
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-rename status=ERROR assetId=${assetId} to=${nextName} error=${text || "unknown error"}`);
        void message.error(text || "Failed to rename asset");
      }
    },
    [apiClient, appendEditorLog, loadAssets, loadProject],
  );

  const refreshAssets = useCallback(async () => {
    try {
      appendEditorLog("info", "action=asset-refresh status=START");
      await loadAssets();
      appendEditorLog("success", "action=asset-refresh status=OK");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      appendEditorLog("error", `action=asset-refresh status=ERROR error=${text || "unknown error"}`);
      void message.error(text || "Failed to refresh assets");
    }
  }, [appendEditorLog, loadAssets]);

  return {
    assetUploadName,
    setAssetUploadName,
    viewAssetId,
    setViewAssetId,
    viewAsset,
    onUploadProjectAsset,
    addAssetAsImage,
    addSvgAssetAsPrimitives,
    handleDeleteAsset,
    moveAssetToFolder,
    bulkMoveAssetsToFolder,
    renameAsset,
    refreshAssets,
  };
}
