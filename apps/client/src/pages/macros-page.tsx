import { useCallback } from "react";
import { Button, Space, Typography } from "antd";
import { MacroWorkbench } from "../hmi/editor/macro-workbench";
import { useScadaStore } from "../store/scada-store";

export function MacrosPage() {
  const project = useScadaStore((s) => s.project);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const runMacro = useScadaStore((s) => s.runMacro);
  const saveProject = useScadaStore((s) => s.saveProject);
  const updateMacro = useScadaStore((s) => s.updateMacro);

  const handleSaveMacro = useCallback(
    async (macroId: string, payload: Parameters<typeof updateMacro>[1]) => {
      console.debug("[MacrosPage] Saving macro", { macroId, name: payload.name });
      const updated = await updateMacro(macroId, payload);
      console.debug("[MacrosPage] Macro saved successfully", { macroId, name: updated.name });
      return updated;
    },
    [updateMacro],
  );

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const screen = project.screens.find((item) => item.id === currentScreenId) ?? project.screens[0];

  return (
    <div style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
      <Space style={{ flex: "0 0 auto" }}>
        <Button type="primary" onClick={() => void saveProject({ notify: true })}>Save Project</Button>
      </Space>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <MacroWorkbench
          project={project}
          currentScreen={screen}
          onProjectChange={updateProjectJson}
          onRunMacro={runMacro}
          onSaveMacro={handleSaveMacro}
        />
      </div>
    </div>
  );
}
