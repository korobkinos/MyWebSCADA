import { useEffect, useRef, useState } from "react";
import { WorkbenchButton } from "./ui/workbench-button";
import { WorkbenchInput } from "./ui/workbench-input";

type WorkbenchLoginWindowProps = {
  onSubmit: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
};

export function WorkbenchLoginWindow({ onSubmit }: WorkbenchLoginWindowProps) {
  const usernameRef = useRef<HTMLInputElement | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const submit = async () => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setErrorText("Enter username and password.");
      return;
    }
    setSubmitting(true);
    setErrorText(null);
    try {
      const result = await onSubmit(normalizedUsername, password);
      if (result.ok) {
        return;
      }
      setErrorText(result.error ?? "Invalid credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="workbench-login-window">
      <form
        className="workbench-login-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <WorkbenchInput
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
          autoComplete="username"
          ref={usernameRef}
        />
        <WorkbenchInput
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete="current-password"
        />
        {errorText ? <div className="workbench-login-error">{errorText}</div> : null}
        <div className="workbench-login-actions">
          <WorkbenchButton variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign In"}
          </WorkbenchButton>
        </div>
      </form>
    </div>
  );
}
