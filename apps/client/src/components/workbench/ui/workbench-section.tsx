import type { ReactNode } from "react";

type WorkbenchSectionProps = {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function WorkbenchSection({
  title,
  actions,
  children,
  className,
}: WorkbenchSectionProps) {
  return (
    <section className={["workbench-section", className ?? ""].filter(Boolean).join(" ")}>
      {title || actions ? (
        <div className="workbench-section__header">
          {title ? <div className="workbench-section__title">{title}</div> : <span />}
          {actions ? <div className="workbench-section__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="workbench-section__content">{children}</div>
    </section>
  );
}