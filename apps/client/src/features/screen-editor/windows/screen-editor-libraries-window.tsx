import type { ElementLibrary, LibraryElement, ProjectLibraryRef } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorLibrariesWindowProps = {
  libraries: ElementLibrary[];
  attachedLibraries: ProjectLibraryRef[];
  libraryId: string;
  libraryName: string;
  onLibraryIdChange: (value: string) => void;
  onLibraryNameChange: (value: string) => void;
  onCreateLibrary: () => Promise<void>;
  onAttachLibrary: (libraryId: string) => Promise<void>;
  onAddLibraryElementToScreen: (libraryId: string, element: LibraryElement | string) => void;
  onRefreshLibraries?: () => Promise<void>;
};

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
    onAddLibraryElementToScreen,
    onRefreshLibraries,
  } = props;

  const attachedIds = new Set(
    attachedLibraries
      .filter((ref) => ref.enabled)
      .map((ref) => ref.libraryId),
  );

  return (
    <div className="screen-editor-window-content screen-editor-libraries-window">
      <WorkbenchSection title="CREATE LIBRARY">
        <div style={{ padding: "0 10px" }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              className="workbench-input"
              value={libraryId}
              onChange={(e) => onLibraryIdChange(e.target.value)}
              placeholder="Library ID"
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              className="workbench-input"
              value={libraryName}
              onChange={(e) => onLibraryNameChange(e.target.value)}
              placeholder="Library name"
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <WorkbenchButton onClick={() => void onCreateLibrary()}>
              Create
            </WorkbenchButton>
            {onRefreshLibraries ? (
              <WorkbenchButton onClick={() => void onRefreshLibraries()}>
                Refresh
              </WorkbenchButton>
            ) : null}
          </div>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="AVAILABLE LIBRARIES">
        <div className="screen-editor-library-list">
          {libraries.length === 0 ? (
            <div className="screen-editor-empty-state" style={{ padding: "0 10px" }}>
              No libraries available
            </div>
          ) : (
            libraries.map((library) => {
              const isAttached = attachedIds.has(library.id);
              return (
                <div key={library.id} className="screen-editor-library-item">
                  <div className="screen-editor-item-title">{library.name}</div>
                  <div className="screen-editor-item-meta">
                    {library.id}
                    {library.version ? ` · v${library.version}` : ""}
                    {library.elements?.length != null
                      ? ` · ${library.elements.length} elements`
                      : ""}
                  </div>
                  <div className="screen-editor-item-actions">
                    {isAttached ? (
                      <span
                        style={{
                          color: "#4ec94e",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        ✓ Attached
                      </span>
                    ) : (
                      <WorkbenchButton
                        variant="primary"
                        onClick={() => void onAttachLibrary(library.id)}
                      >
                        Attach
                      </WorkbenchButton>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="LIBRARY ELEMENTS">
        <div className="screen-editor-library-element-list">
          {attachedLibraries.filter((ref) => ref.enabled).length === 0 ? (
            <div className="screen-editor-empty-state" style={{ padding: "0 10px" }}>
              Attach a library to see its elements
            </div>
          ) : (
            attachedLibraries
              .filter((ref) => ref.enabled)
              .map((ref) => {
                const library = libraries.find(
                  (item) => item.id === ref.libraryId,
                );
                if (!library || !library.elements?.length) {
                  return null;
                }
                return (
                  <div key={ref.libraryId} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        color: "#969696",
                        fontSize: 11,
                        marginBottom: 4,
                        padding: "0 10px",
                      }}
                    >
                      {ref.name}
                    </div>
                    {library.elements.map((element: LibraryElement) => (
                      <div
                        key={element.id}
                        className="screen-editor-library-element-item"
                      >
                        <div className="screen-editor-item-title">
                          {element.name}
                        </div>
                        <div className="screen-editor-item-meta">
                          {element.category ?? "General"}
                          {element.width && element.height
                            ? ` · ${element.width}×${element.height}`
                            : ""}
                        </div>
                        <div className="screen-editor-item-actions">
                          <WorkbenchButton
                            variant="primary"
                            onClick={() =>
                              onAddLibraryElementToScreen(library.id, element)
                            }
                          >
                            Add
                          </WorkbenchButton>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
          )}
        </div>
      </WorkbenchSection>
    </div>
  );
}