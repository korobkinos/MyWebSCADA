import type { DriverStatus } from "@web-scada/shared";
import {
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorDriversWindowProps = {
  drivers?: DriverStatus[];
};

function isOpcUaClockWarning(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes("node-opcua-w33") ||
    normalized.includes("clock discrepancy") ||
    normalized.includes("time discrepancy") ||
    normalized.includes("server token creation date exposes time discrepancy")
  );
}

export function ScreenEditorDriversWindow({ drivers = [] }: ScreenEditorDriversWindowProps) {
  const opcUaDrivers = drivers.filter((driver) => driver.type === "opcua");
  const clockWarningDriver = opcUaDrivers.find((driver) => isOpcUaClockWarning(driver.message));

  return (
    <div className="screen-editor-window-content screen-editor-drivers-window">
      <WorkbenchSection title="OPC UA">
        <div style={{ padding: "0 10px" }}>
          <div style={{ color: "#969696", fontSize: 12, marginBottom: 8 }}>
            OPC UA connection settings, security policies, and endpoint URLs
            are configured in the project settings.
          </div>
          <div className="screen-editor-drivers-note">
            If OPC UA disconnects with NODE-OPCUA-W33, check server/client clock and timezone.
          </div>
          {clockWarningDriver ? (
            <div className="screen-editor-drivers-warning">
              OPC UA server/client clocks differ by about 3 hours. Check PLC/VM/server time and timezone.
            </div>
          ) : null}
          {opcUaDrivers.length ? (
            <div className="screen-editor-drivers-status-list">
              {opcUaDrivers.map((driver) => (
                <div
                  key={driver.id}
                  className={`screen-editor-drivers-status-item${isOpcUaClockWarning(driver.message) ? " screen-editor-drivers-status-item--warning" : ""}`}
                >
                  <strong>{driver.id}</strong>: {driver.health}
                  {driver.message ? ` - ${driver.message}` : ""}
                </div>
              ))}
            </div>
          ) : null}
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
