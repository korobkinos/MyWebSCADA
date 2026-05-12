import { useCallback, useState } from "react";
import type { ScreenEditorLogEntry } from "../types";

export function useEditorLog() {
  const [editorLog, setEditorLog] = useState<ScreenEditorLogEntry[]>([]);

  const appendEditorLog = useCallback((level: ScreenEditorLogEntry["level"], messageText: string) => {
    const now = new Date();
    const entry: ScreenEditorLogEntry = {
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      time: now.toLocaleTimeString(),
      level,
      message: messageText,
    };
    setEditorLog((prev) => [...prev.slice(-199), entry]);
  }, []);

  const clearEditorLog = useCallback(() => {
    setEditorLog([]);
  }, []);

  return {
    editorLog,
    appendEditorLog,
    clearEditorLog,
  };
}
