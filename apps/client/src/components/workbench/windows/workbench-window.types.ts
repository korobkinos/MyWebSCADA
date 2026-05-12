import type { ReactNode } from "react";

export type WorkbenchWindowId =
  | "login"
  | "tags"
  | "drivers"
  | "assets"
  | "libraries"
  | "macros"
  | "userManagement"
  | "projectSettings"
  | "screenSettings"
  | "objectProperties"
  | (string & {});

export type WorkbenchWindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkbenchWindowState = {
  id: WorkbenchWindowId;
  title: string;
  rect: WorkbenchWindowRect;
  minWidth?: number;
  minHeight?: number;
  zIndex: number;
  isOpen: boolean;
};

export type WorkbenchWindowDefinition = {
  id: WorkbenchWindowId;
  title: string;
  defaultRect: WorkbenchWindowRect;
  minWidth?: number;
  minHeight?: number;
  render: () => ReactNode;
};
