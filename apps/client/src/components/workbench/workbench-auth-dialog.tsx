import { useMemo, useState } from "react";
import { WorkbenchWindow } from "./windows/workbench-window";
import type { WorkbenchWindowRect } from "./windows/workbench-window.types";
import { WorkbenchLoginForm } from "./workbench-login-form";

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
  const initialRect = useMemo<WorkbenchWindowRect>(() => {
    if (typeof window === "undefined") {
      return { x: 120, y: 80, width: 380, height: 250 };
    }
    const width = 380;
    const height = 250;
    return {
      x: Math.round(window.innerWidth / 2 - width / 2),
      y: Math.round(window.innerHeight / 2 - height / 2),
      width,
      height,
    };
  }, []);
  const [rect, setRect] = useState<WorkbenchWindowRect>(initialRect);

  if (!open) {
    return null;
  }

  return (
    <div className="workbench-auth-window-layer">
      <WorkbenchWindow
        id="runtime-auth-dialog"
        title="Authorization Required"
        rect={rect}
        zIndex={2000}
        minWidth={340}
        minHeight={220}
        onClose={onClose}
        onFocus={() => undefined}
        onMove={(x, y) => setRect((prev) => ({ ...prev, x, y }))}
        onResize={(nextRect) => setRect(nextRect)}
      >
        <div className="workbench-login-window">
          <WorkbenchLoginForm
            submitLabel="Login"
            showCancel
            onCancel={onClose}
            onSubmit={async (username, password) => {
              const result = await onSubmit(username, password);
              if (result.ok) {
                onClose();
              }
              return result;
            }}
          />
        </div>
      </WorkbenchWindow>
    </div>
  );
}
