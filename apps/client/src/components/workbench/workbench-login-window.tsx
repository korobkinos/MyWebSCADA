import { WorkbenchLoginForm } from "./workbench-login-form";

type WorkbenchLoginWindowProps = {
  onSubmit: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
};

export function WorkbenchLoginWindow({ onSubmit }: WorkbenchLoginWindowProps) {
  return (
    <div className="workbench-login-window">
      <WorkbenchLoginForm onSubmit={onSubmit} />
    </div>
  );
}
