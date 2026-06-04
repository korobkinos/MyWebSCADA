import { lazy, startTransition, Suspense, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  EditOutlined,
  LogoutOutlined,
  MenuOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider, Dropdown, Spin, Typography, message, theme as antdTheme } from "antd";
import type { MenuProps } from "antd";
import type { AppPermission, ProjectTheme } from "@web-scada/shared";
import {
  AUTH_INTENT_REDIRECT_EDITOR,
  buildStateWithAuthIntent,
  createAuthIntent,
} from "./auth-intent";
import { startRuntimePerformanceDiagnostics } from "../services/performance-diagnostics";
import { createTagValueBatcher } from "../services/tag-value-batcher";
import { createRuntimeSocket } from "../services/ws";
import { isAbortError } from "../services/api";
import { useScadaStore } from "../store/scada-store";
const RuntimePage = lazy(() => import("../pages/runtime-page").then((m) => ({ default: m.RuntimePage })));
const EditorPage = lazy(() => import("../pages/editor-page").then((m) => ({ default: m.EditorPage })));
const RUNTIME_FULLSCREEN_PREF_KEY = "scada.runtime.fullscreenPreferred";

function readRuntimeFullscreenPreferred(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(RUNTIME_FULLSCREEN_PREF_KEY) === "1";
}

function setRuntimeFullscreenPreferred(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  if (enabled) {
    window.localStorage.setItem(RUNTIME_FULLSCREEN_PREF_KEY, "1");
    return;
  }
  window.localStorage.removeItem(RUNTIME_FULLSCREEN_PREF_KEY);
}

function isBootstrapCancellation(error: unknown): boolean {
  return isAbortError(error);
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadTags = useScadaStore((s) => s.loadTags);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);
  const loadMacros = useScadaStore((s) => s.loadMacros);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const loadRuntimeStatus = useScadaStore((s) => s.loadRuntimeStatus);
  const initializeAuth = useScadaStore((s) => s.initializeAuth);
  const setTagValues = useScadaStore((s) => s.setTagValues);
  const setDrivers = useScadaStore((s) => s.setDrivers);
  const project = useScadaStore((s) => s.project);
  const authUser = useScadaStore((s) => s.authUser);
  const authResolved = useScadaStore((s) => s.authResolved);
  const logout = useScadaStore((s) => s.logoutEngineer);
  const hasPermission = useScadaStore((s) => s.hasPermission);
  const isLoginAliasRoute = location.pathname === "/login";
  const isRuntimeRoute = location.pathname === "/" || location.pathname === "/runtime" || isLoginAliasRoute;
  const isMacrosRoute = location.pathname === "/macros";
  const isEditorRoute = location.pathname === "/editor" || isMacrosRoute;
  const isProtectedRoute = isEditorRoute;
  const [bootError, setBootError] = useState<string | null>(null);
  const bootstrapRunIdRef = useRef(0);
  const [uiTheme, setUiTheme] = useState<ProjectTheme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const saved = window.localStorage.getItem("scada.uiTheme");
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("scada.uiTheme", uiTheme);
  }, [uiTheme]);

  const bootstrapApp = useCallback(async () => {
    const runId = bootstrapRunIdRef.current + 1;
    bootstrapRunIdRef.current = runId;
    const isLatestRun = () => bootstrapRunIdRef.current === runId;
    setBootError(null);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("logout") === "1") {
        logout();
        params.delete("logout");
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    }
    await initializeAuth();
    if (!isLatestRun()) {
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await loadProject();
        await Promise.all([loadTags(), loadDrivers(), loadMacros(), loadAssets(), loadLibraries(), loadRuntimeStatus()]);
        if (!isLatestRun()) {
          return;
        }
        return;
      } catch (error) {
        if (!isLatestRun()) {
          return;
        }
        if (isBootstrapCancellation(error)) {
          continue;
        }
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }

    if (!isLatestRun() || !lastError || isBootstrapCancellation(lastError)) {
      return;
    }
    const text = lastError instanceof Error ? lastError.message : String(lastError);
    setBootError(text || "Failed to connect to backend");
  }, [initializeAuth, loadAssets, loadDrivers, loadLibraries, loadMacros, loadProject, loadRuntimeStatus, loadTags, logout]);

  useEffect(() => {
    void bootstrapApp();
  }, [bootstrapApp]);

  useEffect(() => startRuntimePerformanceDiagnostics(), []);

  useEffect(() => {
    if (!isRuntimeRoute) {
      return;
    }
    const tagBatcher = createTagValueBatcher(
      (values) => startTransition(() => setTagValues(values)),
      {
        schedule: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle as number),
      },
    );
    const socket = createRuntimeSocket({
      onTagValues: (values) => tagBatcher.push(values),
      onDriverStatuses: (statuses) => setDrivers(statuses),
    });
    return () => {
      socket.close();
      tagBatcher.close();
    };
  }, [isRuntimeRoute, setDrivers, setTagValues]);

  useEffect(() => {
    if (!isRuntimeRoute || typeof document === "undefined") {
      return;
    }
    if (!readRuntimeFullscreenPreferred()) {
      return;
    }
    if (document.fullscreenElement) {
      return;
    }

    let released = false;
    const requestFullscreen = () => {
      if (released || document.fullscreenElement) {
        return;
      }
      void document.documentElement.requestFullscreen().catch(() => undefined);
    };

    requestFullscreen();
    const onFirstInteraction = () => {
      requestFullscreen();
    };
    window.addEventListener("pointerdown", onFirstInteraction, { once: true });
    window.addEventListener("keydown", onFirstInteraction, { once: true });
    return () => {
      released = true;
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
    };
  }, [isRuntimeRoute]);

  useEffect(() => {
    const onInvalidAuth = () => {
      logout();
      if (isProtectedRoute) {
        navigate("/runtime", { replace: true });
      }
    };
    window.addEventListener("scada-auth-invalid", onInvalidAuth);
    return () => window.removeEventListener("scada-auth-invalid", onInvalidAuth);
  }, [isProtectedRoute, logout, navigate]);

  useEffect(() => {
    const projectTheme = project?.uiSettings?.theme;
    if (projectTheme === "dark" || projectTheme === "light") {
      setUiTheme(projectTheme);
    }
  }, [project?.uiSettings?.theme]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const windowTitle = project?.uiSettings?.windowTitle?.trim()
      || project?.projectInfo?.title?.trim()
      || project?.name?.trim()
      || "Web SCADA";
    document.title = windowTitle;
  }, [project?.name, project?.projectInfo?.title, project?.uiSettings?.windowTitle]);

  const effectiveUiTheme: ProjectTheme = isEditorRoute ? "dark" : uiTheme;

  const themeConfig = useMemo(() => {
    if (effectiveUiTheme === "dark") {
      return {
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorBgBase: "#191A1B",
          colorBgContainer: "#202224",
          colorBgElevated: "#26292c",
          colorBorder: "#34383d",
          colorText: "#d7dbe0",
          colorTextSecondary: "#9aa1a9",
          colorPrimary: "#4b77ff",
        },
      } as const;
    }
    return {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: "#1677ff",
      },
    } as const;
  }, [effectiveUiTheme]);

  useEffect(() => {
    ConfigProvider.config({
      holderRender: (children) => (
        <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>
      ),
    });
  }, [themeConfig]);

  if (!authResolved) {
    return <CenteredSpinner />;
  }

  if (!project) {
    if (bootError) {
      return (
        <div className="app-boot-screen" style={{ padding: 24 }}>
          <div style={{ maxWidth: 680, textAlign: "center" }}>
            <Typography.Title level={4}>Backend is not ready</Typography.Title>
            <Typography.Paragraph type="secondary">
              Runtime cannot load project data from API (`/api/project`).
            </Typography.Paragraph>
            <Typography.Paragraph code>{bootError}</Typography.Paragraph>
            <Button type="primary" onClick={() => void bootstrapApp()}>
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return <CenteredSpinner />;
  }

  if (isEditorRoute) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div className="app-theme-dark" style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
          <Suspense fallback={<CenteredSpinner />}>
            <Routes>
              <Route
                path="/editor"
                element={
                  <RequirePermission permission="editor.view">
                    <EditorPage />
                  </RequirePermission>
                }
              />
              <Route path="/macros" element={<Navigate to="/editor" replace />} />
              <Route path="*" element={<Navigate to="/editor" replace />} />
            </Routes>
          </Suspense>
        </div>
      </ConfigProvider>
    );
  }

  if (isRuntimeRoute) {
    const runtimeMenuItems: MenuProps["items"] = [
      {
        key: "current-user",
        label: authUser ? `User: ${authUser.username}` : "User: not authorized",
        icon: <UserOutlined />,
        disabled: true,
      },
      {
        key: "editor",
        label: "Open Editor",
        icon: <EditOutlined />,
        onClick: () => {
          if (!authUser) {
            navigate("/runtime", {
              state: buildStateWithAuthIntent(
                createAuthIntent("open-editor", { redirectTo: AUTH_INTENT_REDIRECT_EDITOR }),
                location.state,
              ),
            });
            return;
          }
          if (!hasPermission("editor.view")) {
            void message.warning("Insufficient permissions: editor.view");
            return;
          }
          navigate("/editor");
        },
      },
      {
        key: "fullscreen",
        label: "Fullscreen",
        icon: <MenuOutlined />,
        onClick: () => {
          if (document.fullscreenElement) {
            setRuntimeFullscreenPreferred(false);
            void document.exitFullscreen();
            return;
          }
          setRuntimeFullscreenPreferred(true);
          void document.documentElement.requestFullscreen().catch(() => {
            setRuntimeFullscreenPreferred(false);
          });
        },
      },
      {
        key: "login",
        label: "Authorization",
        icon: <UserOutlined />,
        onClick: () => {
          navigate("/runtime", {
            state: buildStateWithAuthIntent(createAuthIntent("manual-auth"), location.state),
          });
        },
      },
      ...(authUser
        ? [{
            key: "logout",
            label: `Logout (${authUser.username})`,
            icon: <LogoutOutlined />,
            onClick: () => {
              logout();
            },
          }]
        : []),
    ];

    return (
      <ConfigProvider theme={themeConfig}>
      <div
        className={`app-theme-${uiTheme}`}
        style={{ width: "100vw", height: "100vh", background: "var(--app-bg)", overflow: "hidden", position: "relative" }}
      >
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1200 }}>
          <div style={{ position: "fixed", top: 12, right: 16, pointerEvents: "auto" }}>
            <Dropdown
              menu={{
                items: runtimeMenuItems,
                style: { maxHeight: "calc(100vh - 64px)", overflow: "auto", maxWidth: 260 },
              }}
              trigger={["click"]}
              placement="bottomRight"
              overlayStyle={{ maxWidth: "calc(100vw - 24px)" }}
            >
              <Button
                icon={<MenuOutlined />}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  opacity: 0.34,
                  transition: "opacity 0.2s ease",
                  borderColor: "#7f8ea3",
                  color: "#dce7f7",
                  background: "rgba(15, 23, 32, 0.52)",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.opacity = "0.34";
                }}
              />
            </Dropdown>
          </div>
        </div>

        <Suspense fallback={<CenteredSpinner />}>
          <Routes>
            <Route
              path="/login"
              element={(
                <Navigate
                  to="/runtime"
                  replace
                  state={buildStateWithAuthIntent(createAuthIntent("login-alias"), location.state)}
                />
              )}
            />
            <Route path="/" element={<RuntimePage fullscreen />} />
            <Route path="/runtime" element={<RuntimePage fullscreen />} />
          </Routes>
        </Suspense>
      </div>
      </ConfigProvider>
    );
  }

  return <Navigate to="/runtime" replace />;
}

function RequirePermission({ permission, children }: { permission: AppPermission; children: ReactNode }) {
  const authResolved = useScadaStore((s) => s.authResolved);
  const authUser = useScadaStore((s) => s.authUser);
  const hasPermission = useScadaStore((s) => s.hasPermission);

  if (!authResolved) {
    return <CenteredSpinner />;
  }
  if (!authUser) {
    return (
      <Navigate
        to="/runtime"
        replace
        state={buildStateWithAuthIntent(
          createAuthIntent("open-editor", { redirectTo: AUTH_INTENT_REDIRECT_EDITOR }),
        )}
      />
    );
  }
  if (!hasPermission(permission)) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Title level={4}>Access denied</Typography.Title>
        <Typography.Text type="secondary">Required permission: {permission}</Typography.Text>
      </div>
    );
  }
  return <>{children}</>;
}

function CenteredSpinner() {
  return (
    <div className="app-boot-screen">
      <Spin size="large" />
    </div>
  );
}
