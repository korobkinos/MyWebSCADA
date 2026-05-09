import type { ReactNode } from "react";

export type WorkbenchTabItem = {
  id: string;
  title: string;
  active?: boolean;
  dirty?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  onClose?: () => void;
};

type WorkbenchTabsProps = {
  items: WorkbenchTabItem[];
  className?: string;
};

export function WorkbenchTabs({ items, className }: WorkbenchTabsProps) {
  return (
    <div className={["workbench-tabs", className ?? ""].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={[
            "workbench-tab",
            item.active ? "workbench-tab--active" : "",
            item.dirty ? "workbench-tab--dirty" : "",
          ].filter(Boolean).join(" ")}
          onClick={item.onClick}
          title={item.title}
        >
          {item.icon ? <span className="workbench-tab__icon">{item.icon}</span> : null}
          <span className="workbench-tab__title">{item.title}</span>
          {item.dirty ? <span className="workbench-tab__dirty">●</span> : null}
          {item.onClose ? (
            <span
              role="button"
              tabIndex={0}
              className="workbench-tab__close"
              title="Close"
              onClick={(event) => {
                event.stopPropagation();
                item.onClose?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  item.onClose?.();
                }
              }}
            >
              ×
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}