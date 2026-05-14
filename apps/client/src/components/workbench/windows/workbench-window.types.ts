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
  resizable?: boolean;
  zIndex: number;
  isOpen: boolean;
};

export type WorkbenchWindowDefinition = {
  id: WorkbenchWindowId;
  title: string;
  defaultRect: WorkbenchWindowRect;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  resetRectOnOpen?: boolean;
  render: () => ReactNode;
};
