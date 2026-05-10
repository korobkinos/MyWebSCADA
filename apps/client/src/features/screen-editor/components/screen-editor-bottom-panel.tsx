import type { HmiObject, HmiScreen } from "@web-scada/shared";

export type ScreenEditorBottomPanelProps = {
  screen: HmiScreen | null;
  activeObject: HmiObject | null;
  isProjectDirty: boolean;
  saveStatusText: string;
};

export function ScreenEditorBottomPanel({
  screen,
  activeObject,
  isProjectDirty,
  saveStatusText,
}: ScreenEditorBottomPanelProps) {
  return (
    <div className="screen-editor-bottom-panel">
      <div>[screen] {screen?.name ?? "-"} ({screen?.width ?? 0}x{screen?.height ?? 0})</div>
      <div>[objects] {screen?.objects.length ?? 0}</div>
      <div>[selected] {activeObject ? `${activeObject.id} (${activeObject.type})` : "-"}</div>
      <div>[save] {isProjectDirty ? "Unsaved changes" : saveStatusText}</div>
    </div>
  );
}