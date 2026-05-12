import { UserManagementPanel } from "../../../components/workbench/user-management-panel";

type ScreenEditorUserManagementWindowProps = {
  canWrite: boolean;
  canDelete: boolean;
  canChangePassword: boolean;
};

export function ScreenEditorUserManagementWindow({
  canWrite,
  canDelete,
  canChangePassword,
}: ScreenEditorUserManagementWindowProps) {
  return (
    <div className="screen-editor-window-content">
      <UserManagementPanel
        canWrite={canWrite}
        canDelete={canDelete}
        canChangePassword={canChangePassword}
      />
    </div>
  );
}
