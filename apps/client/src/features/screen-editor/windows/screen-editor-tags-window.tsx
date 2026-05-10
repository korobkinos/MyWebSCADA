import type { InternalVariableDefinition, MacroDefinition, TagValue } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
  WorkbenchTreeItem,
} from "../../../components/workbench";

type ScreenEditorTagsWindowProps = {
  tags: Record<string, TagValue>;
  macros: MacroDefinition[];
  internalVariables: InternalVariableDefinition[];
  newVarName: string;
  newVarType: InternalVariableDefinition["dataType"];
  onNewVarNameChange: (value: string) => void;
  onNewVarTypeChange: (value: InternalVariableDefinition["dataType"]) => void;
  onAddVariable: (
    name: string,
    dataType: InternalVariableDefinition["dataType"],
    initialValue?: boolean | number | string | null,
  ) => void;
};

export function ScreenEditorTagsWindow(props: ScreenEditorTagsWindowProps) {
  const {
    tags,
    macros,
    internalVariables,
    newVarName,
    newVarType,
    onNewVarNameChange,
    onNewVarTypeChange,
    onAddVariable,
  } = props;

  const tagKeys = Object.keys(tags);

  return (
    <div className="screen-editor-window-content screen-editor-tags-window">
      <WorkbenchSection title="TAGS">
        <div style={{ padding: "0 10px" }}>
          <div style={{ color: "#969696", fontSize: 12, marginBottom: 8 }}>
            Total tags: {tagKeys.length}
          </div>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="INTERNAL VARIABLES (LW)">
        <div style={{ padding: "0 10px" }}>
          <input
            className="workbench-input"
            value={newVarName}
            onChange={(e) => onNewVarNameChange(e.target.value)}
            placeholder="Variable name"
          />
          <div style={{ display: "flex", gap: 4, marginTop: 4, marginBottom: 6 }}>
            <select
              className="workbench-select"
              style={{ flex: 1 }}
              value={newVarType}
              onChange={(e) =>
                onNewVarTypeChange(
                  e.target.value as InternalVariableDefinition["dataType"],
                )
              }
            >
              <option value="BOOL">BOOL</option>
              <option value="INT">INT</option>
              <option value="DINT">DINT</option>
              <option value="REAL">REAL</option>
              <option value="STRING">STRING</option>
            </select>
            <WorkbenchButton
              onClick={() =>
                onAddVariable(
                  newVarName.trim(),
                  newVarType,
                  newVarType === "BOOL" ? false : 0,
                )
              }
            >
              Add
            </WorkbenchButton>
          </div>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {internalVariables.slice(0, 50).map((v) => (
              <WorkbenchTreeItem key={v.name}>
                <span>
                  {v.name} ({v.dataType})
                </span>
              </WorkbenchTreeItem>
            ))}
          </div>
        </div>
      </WorkbenchSection>

      {macros.length > 0 ? (
        <WorkbenchSection title="MACROS">
          <div style={{ padding: "0 10px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {macros.map((macro) => (
                <WorkbenchTreeItem key={macro.id}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span>▶ {macro.name}</span>
                    <span
                      style={{
                        fontSize: 10,
                        lineHeight: "16px",
                        padding: "0 4px",
                        borderRadius: 2,
                        background: macro.enabled ?? true ? "#2d5a2d" : "#3c3c3c",
                        color: macro.enabled ?? true ? "#4ec94e" : "#969696",
                      }}
                    >
                      {macro.enabled ?? true ? "EN" : "DIS"}
                    </span>
                  </span>
                </WorkbenchTreeItem>
              ))}
            </div>
          </div>
        </WorkbenchSection>
      ) : null}
    </div>
  );
}