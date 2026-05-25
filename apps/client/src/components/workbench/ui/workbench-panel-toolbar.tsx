import { AppToolbar } from "../../../ui";
import type { ReactNode } from "react";

type WorkbenchPanelToolbarProps = {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
};

export function WorkbenchPanelToolbar({ left, center, right, className }: WorkbenchPanelToolbarProps) {
  return <AppToolbar left={left} center={center} right={right} className={className} />;
}
