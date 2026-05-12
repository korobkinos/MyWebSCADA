export type ScreenEditorLogEntry = {
  id: string;
  time: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};
