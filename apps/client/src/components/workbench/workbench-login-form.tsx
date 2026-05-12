import { useRef, useState } from "react";
import { WorkbenchButton } from "./ui/workbench-button";
import { WorkbenchInput } from "./ui/workbench-input";

type WorkbenchLoginFormProps = {
  submitLabel?: string;
  submitPendingLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  defaultUsername?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onSubmit: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
};

export function WorkbenchLoginForm({
  submitLabel = "Sign In",
  submitPendingLabel = "Signing in...",
  cancelLabel = "Cancel",
  showCancel = false,
  defaultUsername = "",
  autoFocus = true,
  onCancel,
  onSubmit,
}: WorkbenchLoginFormProps) {
  const usernameRef = useRef<HTMLInputElement | null>(null);
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        setPassword("");
        return;
      }
      setErrorText(result.error ?? "Invalid credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
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
        ref={autoFocus ? usernameRef : undefined}
        autoFocus={autoFocus}
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
        {showCancel ? (
          <WorkbenchButton onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </WorkbenchButton>
        ) : null}
        <WorkbenchButton variant="primary" type="submit" disabled={submitting}>
          {submitting ? submitPendingLabel : submitLabel}
        </WorkbenchButton>
      </div>
    </form>
  );
}

