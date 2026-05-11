import type { ElementLibrary, HmiObject } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorSaveSelectionWindowProps = {
  selectedObjects: HmiObject[];
  libraries: ElementLibrary[];
  targetLibraryId: string;
  setTargetLibraryId: (value: string) => void;
  elementName: string;
  setElementName: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  width: number;
  height: number;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onOpenLibraries: () => void;
};

export function ScreenEditorSaveSelectionWindow({
  selectedObjects,
  libraries,
  targetLibraryId,
  setTargetLibraryId,
  elementName,
  setElementName,
  category,
  setCategory,
  description,
  setDescription,
  width,
  height,
  onSave,
  onCancel,
  onOpenLibraries,
}: ScreenEditorSaveSelectionWindowProps) {
  const canSave = selectedObjects.length > 0 && Boolean(targetLibraryId) && Boolean(elementName.trim());

  return (
    <div className="screen-editor-window-content">
      <WorkbenchSection title="SAVE SELECTION">
        <div className="screen-editor-save-selection-form">
          <div className="screen-editor-item-meta">Selected objects: {selectedObjects.length}</div>
          {selectedObjects.length === 0 ? (
            <div className="screen-editor-empty-state" style={{ padding: 0 }}>
              Select one or more objects on canvas
            </div>
          ) : null}

          <label className="workbench-field__label" htmlFor="save-selection-library">Library</label>
          <select
            id="save-selection-library"
            className="workbench-select"
            value={targetLibraryId}
            onChange={(event) => setTargetLibraryId(event.target.value)}
            disabled={libraries.length === 0}
          >
            <option value="">Select library</option>
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </select>

          <label className="workbench-field__label" htmlFor="save-selection-name">Element name</label>
          <input
            id="save-selection-name"
            className="workbench-input"
            value={elementName}
            onChange={(event) => setElementName(event.target.value)}
            placeholder="Element name"
          />

          <label className="workbench-field__label" htmlFor="save-selection-category">Category</label>
          <input
            id="save-selection-category"
            className="workbench-input"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Category"
          />

          <label className="workbench-field__label" htmlFor="save-selection-description">Description</label>
          <textarea
            id="save-selection-description"
            className="workbench-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description"
            style={{ minHeight: 72, paddingTop: 6 }}
          />

          <div className="screen-editor-item-meta">Element size: {width} x {height}</div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <WorkbenchButton variant="primary" onClick={() => void onSave()} disabled={!canSave}>
              Save Element
            </WorkbenchButton>
            <WorkbenchButton onClick={onCancel}>Cancel</WorkbenchButton>
            <WorkbenchButton onClick={onOpenLibraries}>Open Libraries</WorkbenchButton>
          </div>

          {libraries.length === 0 ? (
            <div className="screen-editor-empty-state" style={{ padding: 0 }}>
              No libraries available
            </div>
          ) : null}
        </div>
      </WorkbenchSection>
    </div>
  );
}
