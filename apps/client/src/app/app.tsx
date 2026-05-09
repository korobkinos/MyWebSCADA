import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  DashboardOutlined,
  EditOutlined,
  FileImageOutlined,
  HddOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TagsOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider, Dropdown, Layout, Menu, Space, Spin, Typography, message, theme as antdTheme } from "antd";
import type { MenuProps } from "antd";
import type { AppPermission, ProjectTheme } from "@web-scada/shared";
import { createRuntimeSocket } from "../services/ws";
import { useScadaStore } from "../store/scada-store";

const { Header, Sider, Content } = Layout;
const RuntimePage = lazy(() => import("../pages/runtime-page").then((m) => ({ default: m.RuntimePage })));
const EditorPage = lazy(() => import("../pages/editor-page").then((m) => ({ default: m.EditorPage })));
const TagsPage = lazy(() => import("../pages/tags-page").then((m) => ({ default: m.TagsPage })));
const DriversPage = lazy(() => import("../pages/drivers-page").then((m) => ({ default: m.DriversPage })));
const ProjectPage = lazy(() => import("../pages/project-page").then((m) => ({ default: m.ProjectPage })));
const ScreensPage = lazy(() => import("../pages/screens-page").then((m) => ({ default: m.ScreensPage })));
const AssetsPage = lazy(() => import("../pages/assets-page").then((m) => ({ default: m.AssetsPage })));
const LibrariesPage = lazy(() => import("../pages/libraries-page").then((m) => ({ default: m.LibrariesPage })));
const MacrosPage = lazy(() => import("../pages/macros-page").then((m) => ({ default: m.MacrosPage })));
const ElementEditorPage = lazy(() => import("../pages/element-editor-page").then((m) => ({ default: m.ElementEditorPage })));
const SettingsPage = lazy(() => import("../pages/settings-page").then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import("../pages/users-page").then((m) => ({ default: m.UsersPage })));
const LoginPage = lazy(() => import("../pages/login-page").then((m) => ({ default: m.LoginPage })));
const WorkbenchDemoPage = lazy(() => import("../pages/workbench-demo-page").then((m) => ({ default: m.WorkbenchDemoPage })));

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadTags = useScadaStore((s) => s.loadTags);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);
  const loadMacros = useScadaStore((s) => s.loadMacros);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const initializeAuth = useScadaStore((s) => s.initializeAuth);
  const setTagValues = useScadaStore((s) => s.setTagValues);
  const project = useScadaStore((s) => s.project);
  const authUser = useScadaStore((s) => s.authUser);
  const authResolved = useScadaStore((s) => s.authResolved);
  const logout = useScadaStore((s) => s.logoutEngineer);
  const hasPermission = useScadaStore((s) => s.hasPermission);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const isRuntimeRoute = location.pathname === "/" || location.pathname === "/runtime";
  const isLoginRoute = location.pathname === "/login";
  const isWorkbenchDemoRoute = location.pathname === "/workbench-demo";
  const [bootError, setBootError] = useState<string | null>(null);
  const [mainMenuHidden, setMainMenuHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("scada.mainMenuHidden") === "1";
  });
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
    window.localStorage.setItem("scada.mainMenuHidden", mainMenuHidden ? "1" : "0");
  }, [mainMenuHidden]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("scada.uiTheme", uiTheme);
  }, [uiTheme]);

  const bootstrapApp = useCallback(async () => {
    setBootError(null);
    await initializeAuth();

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await loadProject();
        await Promise.all([loadTags(), loadDrivers(), loadMacros(), loadAssets(), loadLibraries()]);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }

    const text = lastError instanceof Error ? lastError.message : String(lastError);
    setBootError(text || "Failed to connect to backend");
  }, [initializeAuth, loadAssets, loadDrivers, loadLibraries, loadMacros, loadProject, loadTags]);

  useEffect(() => {
    void bootstrapApp();
  }, [bootstrapApp]);

  useEffect(() => {
    if (!isRuntimeRoute) {
      return;
    }
    const socket = createRuntimeSocket({
      onTagValues: (values) => setTagValues(values),
    });
    return () => socket.close();
  }, [isRuntimeRoute, setTagValues]);

  useEffect(() => {
    const onInvalidAuth = () => {
      logout();
      navigate("/login");
    };
    window.addEventListener("scada-auth-invalid", onInvalidAuth);
    return () => window.removeEventListener("scada-auth-invalid", onInvalidAuth);
  }, [logout, navigate]);

  useEffect(() => {
    const projectTheme = project?.uiSettings?.theme;
    if (projectTheme === "dark" || projectTheme === "light") {
      setUiTheme(projectTheme);
    }
  }, [project?.uiSettings?.theme]);

  useEffect(() => {
    if (typeof project?.uiSettings?.hideMainMenu === "boolean") {
      setMainMenuHidden(project.uiSettings.hideMainMenu);
    }
  }, [project?.uiSettings?.hideMainMenu]);

  const themeConfig = useMemo(() => {
    if (uiTheme === "dark") {
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
  }, [uiTheme]);

  if (!authResolved) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isLoginRoute) {
    return (
      <Suspense fallback={<CenteredSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  if (isWorkbenchDemoRoute) {
    return (
      <Suspense fallback={<CenteredSpinner />}>
        <Routes>
          <Route path="/workbench-demo" element={<WorkbenchDemoPage />} />
          <Route path="*" element={<Navigate to="/workbench-demo" replace />} />
        </Routes>
      </Suspense>
    );
  }

  if (!project) {
    if (bootError) {
      return (
        <div style={{ width: "100vw", height: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
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

  if (isRuntimeRoute) {
    const runtimeMenuItems: MenuProps["items"] = [
      {
        key: "editor",
        label: "Open Editor",
        icon: <EditOutlined />,
        onClick: () => {
          if (!authUser) {
            navigate("/login");
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
        key: "screen",
        label: "Select Screen",
        icon: <DashboardOutlined />,
        children: project.screens
          .filter((screen) => screen.kind === "screen")
          .map((screen) => ({
            key: `screen_${screen.id}`,
            label: screen.name,
            onClick: () => setCurrentScreen(screen.id),
          })),
      },
      {
        key: "fullscreen",
        label: "Fullscreen",
        icon: <MenuOutlined />,
        onClick: () => {
          if (document.fullscreenElement) {
            void document.exitFullscreen();
            return;
          }
          void document.documentElement.requestFullscreen();
        },
      },
      authUser
        ? {
            key: "logout",
            label: "Logout",
            icon: <LogoutOutlined />,
            onClick: () => {
              logout();
              navigate("/login");
            },
          }
        : {
            key: "login",
            label: "Login",
            icon: <UserOutlined />,
            onClick: () => navigate("/login"),
          },
    ];

    return (
      <ConfigProvider theme={themeConfig}>
      <div
        className={`app-theme-${uiTheme}`}
        style={{ width: "100vw", height: "100vh", background: uiTheme === "dark" ? "#191A1B" : "#0b1016", overflow: "hidden", position: "relative" }}
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
            <Route path="/" element={<RuntimePage fullscreen />} />
            <Route path="/runtime" element={<RuntimePage fullscreen />} />
          </Routes>
        </Suspense>
      </div>
      </ConfigProvider>
    );
  }

  const menuItems = [
    { key: "/runtime", icon: <DashboardOutlined />, label: <Link to="/runtime">Runtime</Link> },
    hasPermission("editor.view") ? { key: "/editor", icon: <EditOutlined />, label: <Link to="/editor">Editor</Link> } : null,
    hasPermission("screens.view") ? { key: "/screens", icon: <DashboardOutlined />, label: <Link to="/screens">Screens</Link> } : null,
    hasPermission("tags.view") ? { key: "/tags", icon: <TagsOutlined />, label: <Link to="/tags">Tags</Link> } : null,
    hasPermission("drivers.view") ? { key: "/drivers", icon: <HddOutlined />, label: <Link to="/drivers">Drivers</Link> } : null,
    hasPermission("assets.view") ? { key: "/assets", icon: <FileImageOutlined />, label: <Link to="/assets">Assets</Link> } : null,
    hasPermission("libraries.view") ? { key: "/libraries", icon: <SettingOutlined />, label: <Link to="/libraries">Libraries</Link> } : null,
    hasPermission("macros.view") ? { key: "/macros", icon: <TagsOutlined />, label: <Link to="/macros">Macros</Link> } : null,
    hasPermission("elements.view") ? { key: "/element-editor", icon: <EditOutlined />, label: <Link to="/element-editor">Element Editor</Link> } : null,
    hasPermission("users.view") ? { key: "/users", icon: <UserOutlined />, label: <Link to="/users">Users</Link> } : null,
    hasPermission("settings.view") ? { key: "/settings", icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <ConfigProvider theme={themeConfig}>
    <Layout className={`app-shell app-theme-${uiTheme}`}>
      {!mainMenuHidden ? (
        <Sider className="app-sidebar" theme="dark" width={240}>
          <div style={{ color: "#f3f5f8", padding: 16, fontWeight: 600 }}>
            {project.projectInfo?.title?.trim() || "Web SCADA Lite"}
          </div>
          <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={menuItems} />
        </Sider>
      ) : null}

      <Layout className="app-root-layout">
        <Header className="app-header" style={{ paddingInline: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space align="center">
            <Button
              icon={mainMenuHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setMainMenuHidden((prev) => !prev)}
              title={mainMenuHidden ? "Show main menu" : "Hide main menu"}
            />
            <Typography.Title style={{ margin: 0 }} level={4}>
              {project.projectInfo?.title?.trim() || project.name}
            </Typography.Title>
          </Space>
          <Space align="center">
            {project.projectInfo?.subtitle ? <Typography.Text type="secondary">{project.projectInfo.subtitle}</Typography.Text> : null}
            <Button
              size="small"
              onClick={() => setUiTheme((prev) => (prev === "light" ? "dark" : "light"))}
              title={uiTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {uiTheme === "dark" ? "Dark" : "Light"}
            </Button>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout ({authUser?.username ?? "anonymous"})
          </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Suspense fallback={<CenteredSpinner />}>
            <div className="app-content-inner">
              <Routes>
                <Route path="/editor" element={<RequirePermission permission="editor.view"><FillPage><EditorPage /></FillPage></RequirePermission>} />
                <Route path="/screens" element={<RequirePermission permission="screens.view"><ScrollPage><ScreensPage /></ScrollPage></RequirePermission>} />
                <Route path="/tags" element={<RequirePermission permission="tags.view"><FillPage><TagsPage /></FillPage></RequirePermission>} />
                <Route path="/drivers" element={<RequirePermission permission="drivers.view"><FillPage><DriversPage /></FillPage></RequirePermission>} />
                <Route path="/assets" element={<RequirePermission permission="assets.view"><FillPage><AssetsPage /></FillPage></RequirePermission>} />
                <Route path="/libraries" element={<RequirePermission permission="libraries.view"><FillPage><LibrariesPage /></FillPage></RequirePermission>} />
                <Route path="/macros" element={<RequirePermission permission="macros.view"><FillPage><MacrosPage /></FillPage></RequirePermission>} />
                <Route path="/element-editor" element={<RequirePermission permission="elements.view"><FillPage><ElementEditorPage /></FillPage></RequirePermission>} />
                <Route path="/project" element={<RequirePermission permission="settings.view"><ScrollPage><ProjectPage /></ScrollPage></RequirePermission>} />
                <Route path="/settings" element={<RequirePermission permission="settings.view"><ScrollPage><SettingsPage /></ScrollPage></RequirePermission>} />
                <Route path="/users" element={<RequirePermission permission="users.view"><ScrollPage><UsersPage /></ScrollPage></RequirePermission>} />
                <Route path="*" element={<Navigate to="/runtime" replace />} />
              </Routes>
            </div>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
    </ConfigProvider>
  );
}

function RequirePermission({ permission, children }: { permission: AppPermission; children: ReactNode }) {
  const authResolved = useScadaStore((s) => s.authResolved);
  const authUser = useScadaStore((s) => s.authUser);
  const hasPermission = useScadaStore((s) => s.hasPermission);

  if (!authResolved) {
    return <CenteredSpinner />;
  }
  if (!authUser) {
    return <Navigate to="/login" replace />;
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

function ScrollPage({ children }: { children: ReactNode }) {
  return <div className="route-page-scroll">{children}</div>;
}

function FillPage({ children }: { children: ReactNode }) {
  return <div className="route-page-fill">{children}</div>;
}

function CenteredSpinner() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
      <Spin size="large" />
    </div>
  );
}
