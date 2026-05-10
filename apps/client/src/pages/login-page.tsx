import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, message } from "antd";
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
    <div className="login-workbench-page">
      <div className="login-workbench-window">
        <div className="login-workbench-window__header">
          <span className="login-workbench-window__title">Web-SCADA Login</span>
        </div>
        <div className="login-workbench-window__body">
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
        </div>
      </div>
    </div>
  );
}
