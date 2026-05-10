import {
  WorkbenchSection,
} from "../../../components/workbench";

export function ScreenEditorDriversWindow() {
  return (
    <div className="screen-editor-window-content screen-editor-drivers-window">
      <WorkbenchSection title="OPC UA">
        <div style={{ padding: "0 10px" }}>
          <div style={{ color: "#969696", fontSize: 12, marginBottom: 8 }}>
            OPC UA connection settings, security policies, and endpoint URLs
            are configured in the project settings.
          </div>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="SIMULATION">
        <div style={{ padding: "0 10px" }}>
          <div style={{ color: "#969696", fontSize: 12, marginBottom: 8 }}>
            Tags can be configured with OPC UA, LW, Internal or Simulated
            sources. Use the Tags window to assign data sources to tags.
          </div>
        </div>
      </WorkbenchSection>
    </div>
  );
}