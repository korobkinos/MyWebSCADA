import type { ReactNode } from "react";

export type WorkbenchPanelId =
  | "activityBar"
  | "leftSidebar"
  | "center"
  | "rightInspector"
  | "bottomPanel";

export type WorkbenchActivityItem = {
  id: string;
  title: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export type WorkbenchPanelConfig = {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
};

export type ScadaWorkbenchLayoutProps = {
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;

  activityItems?: WorkbenchActivityItem[];

  leftTitle?: string;
  rightTitle?: string;
  bottomTitle?: string;

  className?: string;

  autoSaveId?: string;

  leftPanel?: WorkbenchPanelConfig;
  rightPanel?: WorkbenchPanelConfig;
  bottomPanel?: WorkbenchPanelConfig;
};