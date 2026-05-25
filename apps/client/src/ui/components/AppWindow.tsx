import type { HTMLAttributes, ReactNode } from "react";

export type AppWindowProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  onClose?: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function AppWindow({ title, onClose, actions, className, children, ...props }: AppWindowProps) {
  return (
    <div className={["app-window", "workbench-window", className ?? ""].filter(Boolean).join(" ")} {...props}>
      <div className="workbench-window__header">
        <span className="workbench-window__title">{title}</span>
        <div className="workbench-window__actions">
          {actions}
          {onClose ? (
            <button className="workbench-window__close" type="button" onClick={onClose} aria-label="Close window" title="Close">
              x
            </button>
          ) : null}
        </div>
      </div>
      <div className="workbench-window__content">{children}</div>
    </div>
  );
}
