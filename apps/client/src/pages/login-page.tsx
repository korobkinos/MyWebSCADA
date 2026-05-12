import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  WorkbenchLoginWindow,
  WorkbenchWindowManager,
  useWorkbenchWindows,
  type WorkbenchWindowDefinition,
} from "../components/workbench";
import { useScadaStore } from "../store/scada-store";

type LoginLocationState = {
  from?: string;
};

const LOGIN_WINDOW_ID = "login";

function createLoginWindowRect() {
  if (typeof window === "undefined") {
    return { x: 140, y: 120, width: 360, height: 260 };
  }
  return {
    x: Math.round(window.innerWidth / 2 - 180),
    y: Math.round(window.innerHeight / 2 - 130),
    width: 360,
    height: 260,
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useScadaStore((s) => s.login);
  const {
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
  } = useWorkbenchWindows();

  const locationState = location.state as LoginLocationState | null;
  const fromPath = locationState?.from;
  const targetPath = typeof fromPath === "string" && fromPath.startsWith("/") ? fromPath : "/runtime";

  const windowDefinition: WorkbenchWindowDefinition = {
    id: LOGIN_WINDOW_ID,
    title: "Authorization",
    defaultRect: createLoginWindowRect(),
    minWidth: 320,
    minHeight: 220,
    render: () => (
      <WorkbenchLoginWindow
        onSubmit={async (username, password) => {
          const ok = await login(username, password);
          if (!ok) {
            return { ok: false, error: "Invalid credentials." };
          }
          navigate(targetPath, { replace: true });
          return { ok: true };
        }}
      />
    ),
  };

  useEffect(() => {
    openWindow(windowDefinition);
  }, [openWindow]);

  return (
    <div className="screen-editor-workbench-page workbench-login-page">
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
