import { useEffect, useState } from "react";
import { WorkbenchButton } from "./ui/workbench-button";
import { WorkbenchInput } from "./ui/workbench-input";

type WorkbenchAuthDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
};

export function WorkbenchAuthDialog({
  open,
  onClose,
  onSubmit,
}: WorkbenchAuthDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setErrorText(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="workbench-auth-dialog-backdrop" onMouseDown={onClose}>
      <div className="workbench-auth-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workbench-auth-dialog__header">Authorization Required</div>
        <div className="workbench-auth-dialog__body">
          <div className="workbench-auth-dialog__fields">
            <WorkbenchInput
              label="Username"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              autoFocus
              autoComplete="username"
            />
            <WorkbenchInput
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
            />
          </div>
          {errorText ? <div className="workbench-auth-dialog__error">{errorText}</div> : null}
          <div className="workbench-auth-dialog__actions">
            <WorkbenchButton
              variant="primary"
              disabled={submitting}
              onClick={async () => {
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
                    onClose();
                    return;
                  }
                  setErrorText(result.error ?? "Invalid credentials.");
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Signing in..." : "Login"}
            </WorkbenchButton>
            <WorkbenchButton onClick={onClose} disabled={submitting}>
              Cancel
            </WorkbenchButton>
          </div>
        </div>
      </div>
    </div>
  );
}
