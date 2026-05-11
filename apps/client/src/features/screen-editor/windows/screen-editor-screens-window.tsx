import type { HmiScreen, ScreenKind } from "@web-scada/shared";
import { ScreenListSection } from "../components/screen-list-section";

type ScreenListViewMode = "grid" | "list";

type ScreenEditorScreensWindowProps = {
  screens: HmiScreen[];
  currentScreenId?: string;
  startScreenId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  kindFilter: "all" | ScreenKind;
  onKindFilterChange: (value: "all" | ScreenKind) => void;
  viewMode: ScreenListViewMode;
  onViewModeChange: (value: ScreenListViewMode) => void;
  newScreenKind: ScreenKind;
  onNewScreenKindChange: (value: ScreenKind) => void;
  onCreateScreen: (kind: ScreenKind) => void;
  onSelectScreen: (id: string) => void;
  onDuplicateScreen: (screen: HmiScreen) => void;
  onSetStartScreen: (id: string) => void;
  onDeleteScreen: (id: string) => void;
  onOpenScreenSettings: () => void;
};

export function ScreenEditorScreensWindow(props: ScreenEditorScreensWindowProps) {
  return (
    <div className="screen-editor-window-content">
      <ScreenListSection {...props} />
    </div>
  );
}
