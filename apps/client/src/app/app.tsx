import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DashboardOutlined, EditOutlined, HddOutlined, LockOutlined, LogoutOutlined, SettingOutlined, TagsOutlined } from "@ant-design/icons";
import { Button, Form, Input, Layout, Menu, Modal, Spin, Typography, message } from "antd";
import { createRuntimeSocket } from "../services/ws";
import { useScadaStore } from "../store/scada-store";

const { Header, Sider, Content } = Layout;
const RuntimePage = lazy(() => import("../pages/runtime-page").then((m) => ({ default: m.RuntimePage })));
const EditorPage = lazy(() => import("../pages/editor-page").then((m) => ({ default: m.EditorPage })));
const TagsPage = lazy(() => import("../pages/tags-page").then((m) => ({ default: m.TagsPage })));
const DriversPage = lazy(() => import("../pages/drivers-page").then((m) => ({ default: m.DriversPage })));
const ProjectPage = lazy(() => import("../pages/project-page").then((m) => ({ default: m.ProjectPage })));

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
      <div style={{ height: "100vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isRuntimeRoute) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#0b1016" }}>
        <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1000, display: "flex", gap: 8 }}>
          <Button
            icon={<LockOutlined />}
            onClick={() => setEngineerModalOpen(true)}
          >
            Engineer
          </Button>
          {engineerAuthorized ? (
            <>
              <Button icon={<EditOutlined />} type="primary" onClick={() => navigate("/editor")}>Editor</Button>
              <Button icon={<LogoutOutlined />} onClick={() => logoutEngineer()}>
                Logout
              </Button>
            </>
          ) : null}
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
      <Sider theme="dark" width={240}>
        <div style={{ color: "#fff", padding: 16, fontWeight: 600 }}>Web SCADA Lite</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={[
            { key: "/runtime", icon: <DashboardOutlined />, label: <Link to="/runtime">Runtime</Link> },
            { key: "/editor", icon: <EditOutlined />, label: <Link to="/editor">Editor</Link> },
            { key: "/tags", icon: <TagsOutlined />, label: <Link to="/tags">Tags</Link> },
            { key: "/drivers", icon: <HddOutlined />, label: <Link to="/drivers">Drivers</Link> },
            { key: "/project", icon: <SettingOutlined />, label: <Link to="/project">Project</Link> },
          ]}
        />
      </Sider>

      <Layout>
        <Header style={{ background: "#fff", paddingInline: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography.Title style={{ margin: 0 }} level={4}>
            {project.name}
          </Typography.Title>
          <Button icon={engineerAuthorized ? <LogoutOutlined /> : <LockOutlined />} onClick={() => (engineerAuthorized ? logoutEngineer() : setEngineerModalOpen(true))}>
            {engineerAuthorized ? "Engineer Logout" : "Engineer Login"}
          </Button>
        </Header>
        <Content style={{ margin: 16 }}>
          <Suspense
            fallback={
              <div style={{ height: "50vh", display: "grid", placeItems: "center" }}>
                <Spin size="large" />
              </div>
            }
          >
            <Routes>
              <Route path="/editor" element={engineerAuthorized ? <EditorPage /> : <Navigate to="/runtime" replace />} />
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/drivers" element={<DriversPage />} />
              <Route path="/project" element={<ProjectPage />} />
            </Routes>
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
