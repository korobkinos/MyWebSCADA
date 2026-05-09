import {
  ScadaWorkbenchLayout,
  WorkbenchInput,
  WorkbenchSection,
  WorkbenchTabs,
  WorkbenchTreeItem,
} from "../components/workbench";

const activityItems = [
  { id: "explorer", title: "Explorer", icon: "📁", active: true },
  { id: "search", title: "Search", icon: "🔎" },
  { id: "tags", title: "Tags", icon: "🏷️" },
  { id: "assets", title: "Assets", icon: "🧩" },
  { id: "runtime", title: "Runtime", icon: "▶️" },
];

function DemoExplorer() {
  return (
    <div>
      <WorkbenchSection title="PROJECT">
        <WorkbenchTreeItem hasChildren expanded>Screens</WorkbenchTreeItem>
        <WorkbenchTreeItem depth={1} active>MainScreen</WorkbenchTreeItem>
        <WorkbenchTreeItem depth={1}>Burner_01</WorkbenchTreeItem>
        <WorkbenchTreeItem depth={1}>Trends</WorkbenchTreeItem>
      </WorkbenchSection>
      <WorkbenchSection title="LIBRARIES">
        <WorkbenchTreeItem hasChildren>Valves</WorkbenchTreeItem>
        <WorkbenchTreeItem hasChildren>Pumps</WorkbenchTreeItem>
        <WorkbenchTreeItem hasChildren>Sensors</WorkbenchTreeItem>
      </WorkbenchSection>
    </div>
  );
}

const editorTabs = [
  { id: "main", title: "MainScreen.hmi", active: true },
  { id: "burner", title: "Burner_01.element" },
];

function DemoEditorArea() {
  return (
    <div className="workbench-demo-editor">
      <WorkbenchTabs items={editorTabs} />
      <div className="workbench-demo-canvas-wrap">
        <div className="workbench-demo-canvas">
          <div className="workbench-demo-object workbench-demo-object--valve">PZK_1</div>
          <div className="workbench-demo-object workbench-demo-object--burner">Burner 1</div>
          <div className="workbench-demo-object workbench-demo-object--sensor">PT-101</div>
        </div>
      </div>
    </div>
  );
}

function DemoProperties() {
  return (
    <div>
      <WorkbenchSection title="SELECTED OBJECT">
        <WorkbenchInput label="Name" value="PZK_1" readOnly />
        <WorkbenchInput label="Visual State Tag" value="Burner.PZK_1.VisualState" readOnly />
        <WorkbenchInput label="Command Tag" value="Burner.PZK_1.Command" readOnly />
      </WorkbenchSection>
      <WorkbenchSection title="LAYERS">
        <WorkbenchTreeItem>✓ Armature</WorkbenchTreeItem>
        <WorkbenchTreeItem>✓ Sensors</WorkbenchTreeItem>
        <WorkbenchTreeItem>✓ Text</WorkbenchTreeItem>
      </WorkbenchSection>
    </div>
  );
}

function DemoBottomPanel() {
  return (
    <div className="workbench-demo-terminal">
      <div>[info] Workbench demo started</div>
      <div>[info] Drag panel borders to resize layout</div>
      <div>[info] Refresh page to check autoSaveId persistence</div>
      <div>[runtime] OPC UA disconnected</div>
      <div>[runtime] Modbus TCP driver idle</div>
    </div>
  );
}

export function WorkbenchDemoPage() {
  return (
    <ScadaWorkbenchLayout
      autoSaveId="my-web-scada-workbench-demo"
      leftTitle="Explorer"
      rightTitle="Properties"
      bottomTitle="Terminal"
      activityItems={activityItems}
      left={<DemoExplorer />}
      center={<DemoEditorArea />}
      right={<DemoProperties />}
      bottom={<DemoBottomPanel />}
    />
  );
}