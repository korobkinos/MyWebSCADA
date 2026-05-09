import { PanelResizeHandle } from "react-resizable-panels";

export type WorkbenchResizeHandleProps = {
  orientation: "horizontal" | "vertical";
  className?: string;
};

export function WorkbenchResizeHandle({
  orientation,
  className,
}: WorkbenchResizeHandleProps) {
  return (
    <PanelResizeHandle
      className={[
        "workbench-resize-handle",
        `workbench-resize-handle--${orientation}`,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="workbench-resize-handle__line" />
    </PanelResizeHandle>
  );
}