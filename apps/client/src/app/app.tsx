import { lazy, Suspense, type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  DashboardOutlined,
  EditOutlined,
  FileImageOutlined,
  HddOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Form, Input, Layout, Menu, Modal, Spin, Typography, message } from "antd";
import type { MenuProps } from "antd";
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

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadTags = useScadaStore((s) => s.loadTags);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);
  const loadMacros = useScadaStore((s) => s.loadMacros);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const setTagValue = useScadaStore((s) => s.setTagValue);
  const project = useScadaStore((s) => s.project);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const engineerAuthorized = useScadaStore((s) => s.engineerAuthorized);
  const loginEngineer = useScadaStore((s) => s.loginEngineer);
  const logoutEngineer = useScadaStore((s) => s.logoutEngineer);

  const [engineerModalOpen, setEngineerModalOpen] = useState(false);
  const isRuntimeRoute = location.pathname === "/" || location.pathname === "/runtime";

  useEffect(() => {
    void (async () => {
      await loadProject();
      await Promise.all([loadTags(), loadDrivers(), loadMacros(), loadAssets(), loadLibraries()]);
    })();
  }, [loadAssets, loadDrivers, loadLibraries, loadMacros, loadProject, loadTags]);

  useEffect(() => {
    const socket = createRuntimeSocket({
      onTagValue: (value) => setTagValue(value),
    });
    return () => socket.close();
  }, [setTagValue]);

  if (!project) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isRuntimeRoute) {
    const runtimeMenuItems: MenuProps["items"] = [
      {
        key: "editor",
        label: "Войти в редактор",
        icon: <EditOutlined />,
        onClick: () => {
          if (!engineerAuthorized) {
            setEngineerModalOpen(true);
            return;
          }
          navigate("/editor");
        },
      },
      {
        key: "screen",
        label: "Выбор экрана",
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
        key: "runtime-settings",
        label: "Настройки runtime",
        icon: <SettingOutlined />,
        disabled: true,
      },
      {
        key: "fullscreen",
        label: "Полноэкранный режим",
        icon: <MenuOutlined />,
        onClick: () => {
          if (document.fullscreenElement) {
            void document.exitFullscreen();
            return;
          }
          void document.documentElement.requestFullscreen();
        },
      },
      engineerAuthorized
        ? {
            key: "logout",
            label: "Выйти из режима инженера",
            icon: <LogoutOutlined />,
            onClick: () => logoutEngineer(),
          }
        : {
            key: "login",
            label: "Вход инженера",
            icon: <LockOutlined />,
            onClick: () => setEngineerModalOpen(true),
          },
    ];

    return (
      <div style={{ width: "100vw", height: "100vh", background: "#0b1016", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1100 }}>
          <Dropdown
            menu={{
              items: runtimeMenuItems,
              style: { maxHeight: "calc(100vh - 72px)", overflow: "auto", maxWidth: "min(320px, calc(100vw - 24px))" },
            }}
            trigger={["click"]}
            placement="bottomRight"
            overlayStyle={{ maxWidth: "calc(100vw - 24px)" }}
            getPopupContainer={(node) => node?.parentElement ?? document.body}
          >
            <Button
              shape="circle"
              size="small"
              icon={<MenuOutlined />}
              style={{
                opacity: 0.32,
                transition: "opacity 0.2s ease",
                borderColor: "#7f8ea3",
                color: "#dce7f7",
                background: "rgba(15, 23, 32, 0.45)",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.opacity = "0.9";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.opacity = "0.32";
              }}
            />
          </Dropdown>
        </div>

        <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center" }}><Spin size="large" /></div>}>
          <Routes>
            <Route path="/" element={<RuntimePage fullscreen />} />
            <Route path="/runtime" element={<RuntimePage fullscreen />} />
          </Routes>
        </Suspense>

        <EngineerLoginModal
          open={engineerModalOpen}
          onClose={() => setEngineerModalOpen(false)}
          onSubmit={async (password) => {
            const ok = await loginEngineer(password);
            if (!ok) {
              void message.error("Invalid engineer password");
              return;
            }
            void message.success("Engineer mode enabled");
            setEngineerModalOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" theme="dark" width={240}>
        <div style={{ color: "#fff", padding: 16, fontWeight: 600 }}>Web SCADA Lite</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={[
            { key: "/runtime", icon: <DashboardOutlined />, label: <Link to="/runtime">Runtime</Link> },
            { key: "/editor", icon: <EditOutlined />, label: <Link to="/editor">Editor</Link> },
            { key: "/screens", icon: <DashboardOutlined />, label: <Link to="/screens">Screens</Link> },
            { key: "/tags", icon: <TagsOutlined />, label: <Link to="/tags">Tags</Link> },
            { key: "/drivers", icon: <HddOutlined />, label: <Link to="/drivers">Drivers</Link> },
            { key: "/assets", icon: <FileImageOutlined />, label: <Link to="/assets">Assets</Link> },
            { key: "/libraries", icon: <SettingOutlined />, label: <Link to="/libraries">Libraries</Link> },
            { key: "/macros", icon: <TagsOutlined />, label: <Link to="/macros">Macros</Link> },
            { key: "/element-editor", icon: <EditOutlined />, label: <Link to="/element-editor">Element Editor</Link> },
            { key: "/settings", icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> },
          ]}
        />
      </Sider>

      <Layout className="app-root-layout">
        <Header className="app-header" style={{ background: "#fff", paddingInline: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography.Title style={{ margin: 0 }} level={4}>
            {project.name}
          </Typography.Title>
          <Button icon={engineerAuthorized ? <LogoutOutlined /> : <LockOutlined />} onClick={() => (engineerAuthorized ? logoutEngineer() : setEngineerModalOpen(true))}>
            {engineerAuthorized ? "Engineer Logout" : "Engineer Login"}
          </Button>
        </Header>
        <Content className="app-content">
          <Suspense
            fallback={
              <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
                <Spin size="large" />
              </div>
            }
          >
            <div className="app-content-inner">
              <Routes>
                <Route
                  path="/editor"
                  element={
                    engineerAuthorized ? (
                      <FillPage>
                        <EditorPage />
                      </FillPage>
                    ) : (
                      <Navigate to="/runtime" replace />
                    )
                  }
                />
                <Route
                  path="/screens"
                  element={
                    engineerAuthorized ? (
                      <ScrollPage>
                        <ScreensPage />
                      </ScrollPage>
                    ) : (
                      <Navigate to="/runtime" replace />
                    )
                  }
                />
                <Route
                  path="/tags"
                  element={
                    <FillPage>
                      <TagsPage />
                    </FillPage>
                  }
                />
                <Route
                  path="/drivers"
                  element={
                    <FillPage>
                      <DriversPage />
                    </FillPage>
                  }
                />
                <Route
                  path="/assets"
                  element={
                    engineerAuthorized ? (
                      <FillPage>
                        <AssetsPage />
                      </FillPage>
                    ) : (
                      <Navigate to="/runtime" replace />
                    )
                  }
                />
                <Route
                  path="/libraries"
                  element={
                    engineerAuthorized ? (
                      <FillPage>
                        <LibrariesPage />
                      </FillPage>
                    ) : (
                      <Navigate to="/runtime" replace />
                    )
                  }
                />
                <Route
                  path="/macros"
                  element={
                    engineerAuthorized ? (
                      <FillPage>
                        <MacrosPage />
                      </FillPage>
                    ) : (
                      <Navigate to="/runtime" replace />
                    )
                  }
                />
                <Route
                  path="/element-editor"
                  element={
                    engineerAuthorized ? (
                      <FillPage>
                        <ElementEditorPage />
                      </FillPage>
                    ) : (
                      <Navigate to="/runtime" replace />
                    )
                  }
                />
                <Route
                  path="/project"
                  element={
                    <ScrollPage>
                      <ProjectPage />
                    </ScrollPage>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ScrollPage>
                      <SettingsPage />
                    </ScrollPage>
                  }
                />
              </Routes>
            </div>
          </Suspense>
        </Content>
      </Layout>

      <EngineerLoginModal
        open={engineerModalOpen}
        onClose={() => setEngineerModalOpen(false)}
        onSubmit={async (password) => {
          const ok = await loginEngineer(password);
          if (!ok) {
            void message.error("Invalid engineer password");
            return;
          }
          void message.success("Engineer mode enabled");
          setEngineerModalOpen(false);
        }}
      />
    </Layout>
  );
}

function ScrollPage({ children }: { children: ReactNode }) {
  return <div className="route-page-scroll">{children}</div>;
}

function FillPage({ children }: { children: ReactNode }) {
  return <div className="route-page-fill">{children}</div>;
}

type EngineerLoginModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
};

function EngineerLoginModal({ open, onClose, onSubmit }: EngineerLoginModalProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <Modal
      title="Engineer Authorization"
      open={open}
      onCancel={onClose}
      okText="Login"
      onOk={() => {
        void (async () => {
          setLoading(true);
          try {
            await onSubmit(password);
            setPassword("");
          } finally {
            setLoading(false);
          }
        })();
      }}
      confirmLoading={loading}
    >
      <Form layout="vertical">
        <Form.Item label="Engineer Password" required>
          <Input.Password value={password} onChange={(e) => setPassword(e.target.value)} onPressEnter={() => void onSubmit(password)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
