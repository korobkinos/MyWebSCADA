import type { WorkbenchActivityItem } from "./workbench.types";

export type WorkbenchActivityBarProps = {
  items?: WorkbenchActivityItem[];
  className?: string;
};

export function WorkbenchActivityBar({ items = [], className }: WorkbenchActivityBarProps) {
  return (
    <nav className={["workbench-activity-bar", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.title}
          disabled={item.disabled}
          onClick={item.onClick}
          className={[
            "workbench-activity-bar__button",
            item.active ? "workbench-activity-bar__button--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="workbench-activity-bar__icon">
            {item.icon ?? item.title.slice(0, 1).toUpperCase()}
          </span>
        </button>
      ))}
    </nav>
  );
}