import type { ReactNode } from "react";
import { AppStatusBadge } from "../../../ui";

export type WorkbenchStatusVariant = "info" | "success" | "warning" | "error";

export type WorkbenchStatusRow = {
  label: string;
  value: ReactNode;
};

type WorkbenchStatusBlockProps = {
  variant?: WorkbenchStatusVariant;
  title: string;
  description?: ReactNode;
  rows?: WorkbenchStatusRow[];
  children?: ReactNode;
  className?: string;
};

export function WorkbenchStatusBlock({
  variant = "info",
  title,
  description,
  rows,
  children,
  className,
}: WorkbenchStatusBlockProps) {
  return (
    <div className={["workbench-status-block", `workbench-status-block--${variant}`, className ?? ""].filter(Boolean).join(" ")}>
      <div className="workbench-status-block__title">
        <AppStatusBadge variant={variant}>{title}</AppStatusBadge>
      </div>
      {description ? <div className="workbench-status-block__description">{description}</div> : null}
      {rows && rows.length > 0 ? (
        <div className="workbench-status-block__grid">
          {rows.map((row) => (
            <div key={row.label} className="workbench-status-block__row">
              <span className="workbench-status-block__label">{row.label}</span>
              <span className="workbench-status-block__value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {children ? <div className="workbench-status-block__content">{children}</div> : null}
    </div>
  );
}
