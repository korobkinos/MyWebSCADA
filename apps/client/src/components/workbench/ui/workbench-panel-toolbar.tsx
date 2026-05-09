import type { ReactNode } from "react";

type WorkbenchPanelToolbarProps = {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
};

export function WorkbenchPanelToolbar({
  left,
  center,
  right,
  className,
}: WorkbenchPanelToolbarProps) {
  return (
    <div className={["workbench-panel-toolbar", className ?? ""].filter(Boolean).join(" ")}>
      <div className="workbench-panel-toolbar__left">{left}</div>
      <div className="workbench-panel-toolbar__center">{center}</div>
      <div className="workbench-panel-toolbar__right">{right}</div>
    </div>
  );
}