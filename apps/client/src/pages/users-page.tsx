import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ScreenEditorUserManagementWindow,
} from "../features/screen-editor/windows";
import {
  WorkbenchWindowManager,
  useWorkbenchWindows,
  type WorkbenchWindowDefinition,
} from "../components/workbench";
import { useScadaStore } from "../store/scada-store";

const USER_MANAGEMENT_WINDOW_ID = "userManagement";

function createUsersWindowRect() {
  if (typeof window === "undefined") {
    return { x: 60, y: 60, width: 980, height: 660 };
  }
  const width = Math.min(1100, Math.max(900, window.innerWidth - 120));
  const height = Math.min(720, Math.max(600, window.innerHeight - 120));
  return {
    x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

export function UsersPage() {
  const navigate = useNavigate();
  const canWrite = useScadaStore((s) => s.hasPermission("users.write"));
  const canDelete = useScadaStore((s) => s.hasPermission("users.delete"));
  const canChangePassword = useScadaStore((s) => s.hasPermission("users.changePassword"));
  const {
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
  } = useWorkbenchWindows();

  const windowDefinition: WorkbenchWindowDefinition = {
    id: USER_MANAGEMENT_WINDOW_ID,
    title: "User Management",
    defaultRect: createUsersWindowRect(),
    minWidth: 700,
    minHeight: 420,
    render: () => (
      <ScreenEditorUserManagementWindow
        canWrite={canWrite}
        canDelete={canDelete}
        canChangePassword={canChangePassword}
      />
    ),
  };

  useEffect(() => {
    openWindow(windowDefinition);
  }, [openWindow]);

  return (
    <div className="screen-editor-workbench-page users-workbench-page">
      <WorkbenchWindowManager
        windows={openWindows}
        definitions={[windowDefinition]}
        onClose={(id) => {
          closeWindow(id);
          navigate("/runtime", { replace: true });
        }}
        onFocus={focusWindow}
        onMove={moveWindow}
        onResize={resizeWindow}
      />
    </div>
  );
}
