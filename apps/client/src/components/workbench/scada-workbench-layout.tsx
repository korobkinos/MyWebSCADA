import { Panel, PanelGroup } from "react-resizable-panels";
import type { ScadaWorkbenchLayoutProps, WorkbenchPanelConfig } from "./workbench.types";
import { WorkbenchActivityBar } from "./workbench-activity-bar";
import { WorkbenchPanelHeader } from "./workbench-panel-header";
import { WorkbenchResizeHandle } from "./workbench-resize-handle";

const defaultLeftPanel: Required<WorkbenchPanelConfig> = {
  defaultSize: 22,
  minSize: 12,
  maxSize: 38,
  collapsible: true,
  collapsedSize: 0,
};

const defaultRightPanel: Required<WorkbenchPanelConfig> = {
  defaultSize: 24,
  minSize: 14,
  maxSize: 42,
  collapsible: true,
  collapsedSize: 0,
};

const defaultBottomPanel: Required<WorkbenchPanelConfig> = {
  defaultSize: 24,
  minSize: 10,
  maxSize: 45,
  collapsible: true,
  collapsedSize: 0,
};

function mergePanelConfig(
  defaults: Required<WorkbenchPanelConfig>,
  override?: WorkbenchPanelConfig,
): Required<WorkbenchPanelConfig> {
  return {
    ...defaults,
    ...override,
  };
}

export function ScadaWorkbenchLayout({
  left,
  center,
  right,
  bottom,
  activityItems = [],
  leftTitle,
  rightTitle,
  bottomTitle,
  className,
  autoSaveId = "scada-workbench-layout",
  leftPanel,
  rightPanel,
  bottomPanel,
}: ScadaWorkbenchLayoutProps) {
  const leftConfig = mergePanelConfig(defaultLeftPanel, leftPanel);
  const rightConfig = mergePanelConfig(defaultRightPanel, rightPanel);
  const bottomConfig = mergePanelConfig(defaultBottomPanel, bottomPanel);

  return (
    <div className={["scada-workbench", className].filter(Boolean).join(" ")}>
      <PanelGroup direction="horizontal" autoSaveId={`${autoSaveId}:horizontal`}>
        <Panel
          id="activityBar"
          order={1}
          defaultSize={4}
          minSize={3}
          maxSize={5}
        >
          <WorkbenchActivityBar items={activityItems} />
        </Panel>

        {left ? (
          <>
            <WorkbenchResizeHandle orientation="vertical" />
            <Panel
              id="leftSidebar"
              order={2}
              defaultSize={leftConfig.defaultSize}
              minSize={leftConfig.minSize}
              maxSize={leftConfig.maxSize}
              collapsible={leftConfig.collapsible}
              collapsedSize={leftConfig.collapsedSize}
            >
              <aside className="workbench-panel workbench-panel--left">
                {leftTitle ? <WorkbenchPanelHeader title={leftTitle} /> : null}
                <div className="workbench-panel__content">{left}</div>
              </aside>
            </Panel>
          </>
        ) : null}

        <WorkbenchResizeHandle orientation="vertical" />

        <Panel id="center" order={3} minSize={30}>
          <PanelGroup direction="vertical" autoSaveId={`${autoSaveId}:vertical`}>
            <Panel
              id="centerEditor"
              order={1}
              defaultSize={bottom ? 76 : 100}
              minSize={35}
            >
              <main className="workbench-center">{center}</main>
            </Panel>

            {bottom ? (
              <>
                <WorkbenchResizeHandle orientation="horizontal" />
                <Panel
                  id="bottomPanel"
                  order={2}
                  defaultSize={bottomConfig.defaultSize}
                  minSize={bottomConfig.minSize}
                  maxSize={bottomConfig.maxSize}
                  collapsible={bottomConfig.collapsible}
                  collapsedSize={bottomConfig.collapsedSize}
                >
                  <section className="workbench-panel workbench-panel--bottom">
                    {bottomTitle ? <WorkbenchPanelHeader title={bottomTitle} /> : null}
                    <div className="workbench-panel__content">{bottom}</div>
                  </section>
                </Panel>
              </>
            ) : null}
          </PanelGroup>
        </Panel>

        {right ? (
          <>
            <WorkbenchResizeHandle orientation="vertical" />
            <Panel
              id="rightInspector"
              order={4}
              defaultSize={rightConfig.defaultSize}
              minSize={rightConfig.minSize}
              maxSize={rightConfig.maxSize}
              collapsible={rightConfig.collapsible}
              collapsedSize={rightConfig.collapsedSize}
            >
              <aside className="workbench-panel workbench-panel--right">
                {rightTitle ? <WorkbenchPanelHeader title={rightTitle} /> : null}
                <div className="workbench-panel__content">{right}</div>
              </aside>
            </Panel>
          </>
        ) : null}
      </PanelGroup>
    </div>
  );
}