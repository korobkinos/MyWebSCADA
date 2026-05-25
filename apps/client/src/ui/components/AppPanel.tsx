import { Card } from "@blueprintjs/core";
import type { HTMLAttributes, ReactNode } from "react";

export type AppPanelProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  actions?: ReactNode;
};

export function AppPanel({ title, actions, className, children, ...props }: AppPanelProps) {
  return (
    <Card className={["app-panel", "workbench-panel", className ?? ""].filter(Boolean).join(" ")} {...props}>
      {title || actions ? (
        <div className="app-panel__header workbench-panel-header">
          <div className="workbench-panel-header__title">{title}</div>
          {actions ? <div className="workbench-panel-header__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="app-panel__content workbench-panel__content">{children}</div>
    </Card>
  );
}
