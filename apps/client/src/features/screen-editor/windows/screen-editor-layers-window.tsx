import type { ElementLibrary, HmiObject, HmiScreen } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";
import { sortObjectsByZIndex } from "../../../hmi/editor/z-order";

type ScreenEditorLayersWindowProps = {
  screen: HmiScreen;
  libraries: ElementLibrary[];
  selectedObjectIds: string[];
  activeObjectId?: string;
  onSelectObject: (id: string) => void;
  onOpenObjectPropertiesForObject?: (objectId: string) => void;
  onDeleteSelected: () => void;
  onLockSelected: () => void;
  onUnlockSelected: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
  canDelete: boolean;
  canLock: boolean;
  canUnlock: boolean;
};

type LayerRow = {
  object: HmiObject;
  depth: number;
  zIndex: number;
};

export function ScreenEditorLayersWindow({
  screen,
  libraries,
  selectedObjectIds,
  activeObjectId,
  onSelectObject,
  onOpenObjectPropertiesForObject,
  onDeleteSelected,
  onLockSelected,
  onUnlockSelected,
  onBringToFront,
  onSendToBack,
  onMoveForward,
  onMoveBackward,
  canDelete,
  canLock,
  canUnlock,
}: ScreenEditorLayersWindowProps) {
  const rows = flattenLayers(sortObjectsByZIndex(screen.objects));
  const hasSelection = selectedObjectIds.length > 0;

  return (
    <div className="screen-editor-window-content">
      <WorkbenchSection title="LAYERS / OBJECT TREE">
        <div style={{ padding: "0 10px 6px", display: "flex", gap: 4, flexWrap: "wrap" }}>
          <WorkbenchButton variant="danger" onClick={onDeleteSelected} disabled={!canDelete}>
            Delete selected
          </WorkbenchButton>
          <WorkbenchButton onClick={onLockSelected} disabled={!canLock}>
            Lock
          </WorkbenchButton>
          <WorkbenchButton onClick={onUnlockSelected} disabled={!canUnlock}>
            Unlock
          </WorkbenchButton>
        </div>
        <div style={{ padding: "0 10px 6px", display: "flex", gap: 4, flexWrap: "wrap" }}>
          <WorkbenchButton onClick={onBringToFront} disabled={!hasSelection} title="Bring to front">
            Front
          </WorkbenchButton>
          <WorkbenchButton onClick={onSendToBack} disabled={!hasSelection} title="Send to back">
            Back
          </WorkbenchButton>
          <WorkbenchButton onClick={onMoveForward} disabled={!hasSelection} title="Move forward">
            Up
          </WorkbenchButton>
          <WorkbenchButton onClick={onMoveBackward} disabled={!hasSelection} title="Move backward">
            Down
          </WorkbenchButton>
        </div>

        <div className="screen-editor-layers-list">
          {rows.length === 0 ? (
            <div className="screen-editor-empty-state">No objects on screen</div>
          ) : (
            rows.map((row) => {
              const item = row.object;
              const isSelected = selectedObjectIds.includes(item.id);
              const isActive = activeObjectId === item.id;
              const libraryMeta = item.type === "libraryElementInstance"
                ? resolveLibraryMeta(item, libraries)
                : null;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    "screen-editor-layer-item",
                    isSelected || isActive ? "screen-editor-layer-item--selected" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ paddingLeft: `${6 + row.depth * 14}px` }}
                  onClick={() => onSelectObject(item.id)}
                  onDoubleClick={() => onOpenObjectPropertiesForObject?.(item.id)}
                  title={`zIndex: ${row.zIndex} | Single click to select. Double click to open object properties.`}
                >
                  <div>{item.name?.trim() || item.id}</div>
                  <div className="screen-editor-item-meta">{item.type} | z={row.zIndex} | {item.id}</div>
                  <div className="screen-editor-layer-badges">
                    {item.type === "libraryElementInstance" ? (
                      <span
                        className={[
                          "screen-editor-layer-badge",
                          libraryMeta?.missing ? "screen-editor-layer-badge--missing" : "screen-editor-layer-badge--library",
                        ].join(" ")}
                      >
                        {libraryMeta?.missing ? "library missing" : "library"}
                      </span>
                    ) : null}
                    {item.locked ? <span className="screen-editor-layer-badge">lock</span> : null}
                  </div>
                  {libraryMeta ? (
                    <div className="screen-editor-item-meta">
                      Library: {libraryMeta.libraryName}
                      <br />
                      Element: {libraryMeta.elementName}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </WorkbenchSection>
    </div>
  );
}

function flattenLayers(objects: HmiObject[], depth = 0): LayerRow[] {
  const rows: LayerRow[] = [];
  const sorted = sortObjectsByZIndex(objects);
  for (let i = 0; i < sorted.length; i++) {
    const object = sorted[i];
    if (!object) continue;
    const zIndex = object.zIndex ?? i;
    rows.push({ object, depth, zIndex });
    if (object.type === "group") {
      rows.push(...flattenLayers(object.objects, depth + 1));
    }
  }
  return rows;
}

function resolveLibraryMeta(
  object: Extract<HmiObject, { type: "libraryElementInstance" }>,
  libraries: ElementLibrary[],
): { libraryName: string; elementName: string; missing: boolean } {
  const library = libraries.find((item) => item.id === object.libraryId);
  const element = library?.elements.find((item) => item.id === object.elementId);
  return {
    libraryName: library?.name ?? object.libraryId,
    elementName: element?.name ?? object.elementId,
    missing: !library || !element,
  };
}
