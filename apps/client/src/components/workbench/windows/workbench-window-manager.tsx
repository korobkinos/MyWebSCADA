import type { WorkbenchWindowDefinition, WorkbenchWindowRect, WorkbenchWindowState } from "./workbench-window.types";
import { WorkbenchWindow } from "./workbench-window";

type WorkbenchWindowManagerProps = {
  windows: WorkbenchWindowState[];
  definitions: WorkbenchWindowDefinition[];
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, rect: WorkbenchWindowRect) => void;
};

export function WorkbenchWindowManager({
  windows,
  definitions,
  onClose,
  onFocus,
  onMove,
  onResize,
}: WorkbenchWindowManagerProps) {
  if (windows.length === 0) {
    return null;
  }

  return (
    <div className="workbench-window-layer">
      {windows.map((window) => {
        const definition = definitions.find((item) => item.id === window.id);
        if (!definition) {
          return null;
        }

        return (
          <WorkbenchWindow
            key={window.id}
            id={window.id}
            title={window.title}
            rect={window.rect}
            minWidth={window.minWidth}
            minHeight={window.minHeight}
            resizable={window.resizable}
            zIndex={window.zIndex}
            onClose={() => onClose(window.id)}
            onFocus={() => onFocus(window.id)}
            onMove={(x, y) => onMove(window.id, x, y)}
            onResize={(rect) => onResize(window.id, rect)}
          >
            {definition.render()}
          </WorkbenchWindow>
        );
      })}
    </div>
  );
}
