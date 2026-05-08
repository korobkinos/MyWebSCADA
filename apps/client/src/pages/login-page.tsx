import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useScadaStore } from "../store/scada-store";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useScadaStore((s) => s.login);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<{ username: string; password: string }>();

  const submit = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const ok = await login(values.username, values.password);
      if (!ok) {
        void message.error("Invalid credentials");
        return;
      }
      navigate("/runtime", { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", display: "grid", placeItems: "center", background: "#0f1720" }}>
      <Card style={{ width: 360 }}>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Web-SCADA Login
          </Typography.Title>
          <Form form={form} layout="vertical" onFinish={() => void submit()}>
            <Form.Item label="Username" name="username" rules={[{ required: true }]}>
              <Input autoFocus />
            </Form.Item>
            <Form.Item label="Password" name="password" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Sign In
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
