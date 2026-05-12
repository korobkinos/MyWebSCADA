import type { ReactNode } from "react";
import { WorkbenchSection } from "./workbench-section";

export type WorkbenchCollapsibleSectionProps = {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultCollapsed?: boolean;
  storageKey?: string;
  className?: string;
};

export function WorkbenchCollapsibleSection({
  title,
  children,
  actions,
  defaultCollapsed = false,
  storageKey,
  className,
}: WorkbenchCollapsibleSectionProps) {
  return (
    <WorkbenchSection
      title={title}
      actions={actions}
      collapsible
      defaultCollapsed={defaultCollapsed}
      storageKey={storageKey}
      className={className}
    >
      {children}
    </WorkbenchSection>
  );
}
