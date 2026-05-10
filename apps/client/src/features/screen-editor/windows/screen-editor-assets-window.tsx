import { useRef, type RefObject } from "react";
import type { Asset } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorAssetsWindowProps = {
  assets: Asset[];
  assetName: string;
  onAssetNameChange: (value: string) => void;
  onUploadAsset: (file: File) => Promise<void>;
  onAddAssetAsImage: (asset: Asset) => void;
  onRefreshAssets?: () => void;
  onDeleteAsset?: (assetId: string) => void;
};

export function ScreenEditorAssetsWindow(props: ScreenEditorAssetsWindowProps) {
  const {
    assets,
    assetName,
    onAssetNameChange,
    onUploadAsset,
    onAddAssetAsImage,
    onRefreshAssets,
    onDeleteAsset,
  } = props;

  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      void onUploadAsset(file);
    }
  };

  return (
    <div className="screen-editor-window-content screen-editor-assets-window">
      <WorkbenchSection title="UPLOAD ASSET">
        <div style={{ padding: "0 10px" }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              className="workbench-input"
              value={assetName}
              onChange={(e) => onAssetNameChange(e.target.value)}
              placeholder="Asset name"
              style={{ flex: 1 }}
            />
            <WorkbenchButton onClick={() => uploadInputRef.current?.click()}>
              Upload
            </WorkbenchButton>
            {onRefreshAssets ? (
              <WorkbenchButton onClick={() => void onRefreshAssets()}>
                Refresh
              </WorkbenchButton>
            ) : null}
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="ASSETS">
        <div className="screen-editor-asset-list">
          {assets.length === 0 ? (
            <div className="screen-editor-empty-state" style={{ padding: "0 10px" }}>
              No assets uploaded yet
            </div>
          ) : (
            assets.map((asset) => (
              <div key={asset.id} className="screen-editor-asset-item">
                {asset.previewUrl ? (
                  <img
                    src={asset.previewUrl}
                    alt={asset.name}
                    className="screen-editor-asset-preview"
                  />
                ) : null}
                <div className="screen-editor-item-title">{asset.name}</div>
                <div className="screen-editor-item-meta">
                  {asset.type?.toUpperCase() ?? ""}
                  {asset.width && asset.height
                    ? ` · ${asset.width}×${asset.height}`
                    : ""}
                  {asset.size ? ` · ${(asset.size / 1024).toFixed(1)} KB` : ""}
                </div>
                <div className="screen-editor-item-actions">
                  <WorkbenchButton
                    variant="primary"
                    onClick={() => onAddAssetAsImage(asset)}
                  >
                    Add
                  </WorkbenchButton>
                  {onDeleteAsset ? (
                    <WorkbenchButton
                      variant="danger"
                      onClick={() => onDeleteAsset(asset.id)}
                    >
                      Delete
                    </WorkbenchButton>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </WorkbenchSection>
    </div>
  );
}