import type { HTMLAttributes, ReactNode } from "react";

export type AppToolbarProps = HTMLAttributes<HTMLDivElement> & {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
};

export function AppToolbar({ left, center, right, className, ...props }: AppToolbarProps) {
  return (
    <div className={["app-toolbar", "workbench-panel-toolbar", className ?? ""].filter(Boolean).join(" ")} {...props}>
      <div className="workbench-panel-toolbar__left">{left}</div>
      <div className="workbench-panel-toolbar__center">{center}</div>
      <div className="workbench-panel-toolbar__right">{right}</div>
    </div>
  );
}
