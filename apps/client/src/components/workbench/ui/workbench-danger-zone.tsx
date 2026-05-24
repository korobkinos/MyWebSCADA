import type { ReactNode } from "react";

type WorkbenchDangerZoneProps = {
  title?: string;
  children: ReactNode;
};

export function WorkbenchDangerZone({ title = "Danger Zone", children }: WorkbenchDangerZoneProps) {
  return (
    <section className="workbench-danger-zone">
      <div className="workbench-danger-zone__title">{title}</div>
      <div className="workbench-danger-zone__content">{children}</div>
    </section>
  );
}
