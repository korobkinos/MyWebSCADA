import type { ReactNode } from "react";

export type WorkbenchPanelHeaderProps = {
  title: string;
  actions?: ReactNode;
  className?: string;
};

export function WorkbenchPanelHeader({
  title,
  actions,
  className,
}: WorkbenchPanelHeaderProps) {
  return (
    <header className={["workbench-panel-header", className].filter(Boolean).join(" ")}>
      <span className="workbench-panel-header__title">{title}</span>
      {actions ? (
        <div className="workbench-panel-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}