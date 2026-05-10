import { useRef } from "react";
import type { Asset } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorAssetsWindowProps = {
  assets: Asset[];
  onUploadAsset: (file: File) => Promise<void>;
  onAddAssetAsImage: (asset: Asset) => void;
  onViewAsset?: (asset: Asset) => void;
  onDeleteAsset?: (assetId: string) => void | Promise<void>;
};

export function ScreenEditorAssetsWindow(props: ScreenEditorAssetsWindowProps) {
  const {
    assets,
    onUploadAsset,
    onAddAssetAsImage,
    onViewAsset,
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
          <WorkbenchButton onClick={() => uploadInputRef.current?.click()}>
            Upload image
          </WorkbenchButton>
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
        <div className="screen-editor-asset-grid">
          {assets.length === 0 ? (
            <div className="screen-editor-empty-state">
              No assets uploaded yet
            </div>
          ) : (
            assets.map((asset) => (
              <div key={asset.id} className="screen-editor-asset-tile">
                <div className="screen-editor-asset-thumb">
                  {asset.previewUrl ? (
                    <img src={asset.previewUrl} alt={asset.name} />
                  ) : (
                    <div className="screen-editor-asset-thumb__placeholder">
                      No preview
                    </div>
                  )}
                </div>

                <div className="screen-editor-asset-tile__name" title={asset.name}>
                  {asset.name}
                </div>

                <div className="screen-editor-asset-tile__meta">
                  {asset.type?.toUpperCase() ?? ""}
                  {asset.width && asset.height
                    ? ` · ${asset.width}×${asset.height}`
                    : ""}
                  {asset.size ? ` · ${(asset.size / 1024).toFixed(1)} KB` : ""}
                </div>

                <div className="screen-editor-asset-tile__actions">
                  <WorkbenchButton
                    variant="primary"
                    className="screen-editor-asset-action-button"
                    onClick={() => onAddAssetAsImage(asset)}
                  >
                    Add
                  </WorkbenchButton>

                  {onViewAsset ? (
                    <WorkbenchButton
                      className="screen-editor-asset-action-button"
                      onClick={() => onViewAsset(asset)}
                    >
                      View
                    </WorkbenchButton>
                  ) : null}

                  {onDeleteAsset ? (
                    <WorkbenchButton
                      variant="danger"
                      className="screen-editor-asset-action-button"
                      onClick={() => void onDeleteAsset(asset.id)}
                    >
                      Del
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