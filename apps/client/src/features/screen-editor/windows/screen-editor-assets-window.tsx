import { useRef, useState } from "react";
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
  const [assetScalePercent, setAssetScalePercent] = useState(100);

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

      <WorkbenchSection
        title="ASSETS"
        actions={(
          <div className="screen-editor-asset-scale-controls">
            <WorkbenchButton
              className="screen-editor-asset-scale-button"
              onClick={zoomOutAssets}
              disabled={assetScalePercent <= 80}
              title="Zoom out assets"
            >
              -
            </WorkbenchButton>
            <WorkbenchButton
              className="screen-editor-asset-scale-button screen-editor-asset-scale-button--label"
              onClick={() => setAssetScalePercent(100)}
              title="Reset assets zoom"
            >
              {assetScalePercent}%
            </WorkbenchButton>
            <WorkbenchButton
              className="screen-editor-asset-scale-button"
              onClick={zoomInAssets}
              disabled={assetScalePercent >= 140}
              title="Zoom in assets"
            >
              +
            </WorkbenchButton>
          </div>
        )}
      >
        <div
          className="screen-editor-asset-grid"
          style={
            {
              "--screen-editor-asset-scale": String(assetScalePercent / 100),
            } as React.CSSProperties
          }
        >
          {assets.length === 0 ? (
            <div className="screen-editor-empty-state">
              No assets uploaded yet
            </div>
          ) : (
            assets.map((asset) => (
              <div
                key={asset.id}
                className="screen-editor-asset-tile"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    "application/web-scada-item",
                    JSON.stringify({
                      kind: "asset",
                      assetId: asset.id,
                    }),
                  );
                  event.dataTransfer.setData("text/plain", asset.name);
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
