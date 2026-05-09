import type { ButtonHTMLAttributes, ReactNode } from "react";

type WorkbenchTreeItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  depth?: number;
  active?: boolean;
  expanded?: boolean;
  hasChildren?: boolean;
};

export function WorkbenchTreeItem({
  icon,
  depth = 0,
  active = false,
  expanded,
  hasChildren = false,
  className,
  children,
  type = "button",
  ...props
}: WorkbenchTreeItemProps) {
  const marker = hasChildren ? (expanded ? "▾" : "▸") : "";

  return (
    <button
      type={type}
      className={[
        "workbench-tree-item",
        active ? "workbench-tree-item--active" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      style={{ "--workbench-tree-depth": depth } as React.CSSProperties}
      {...props}
    >
      <span className="workbench-tree-item__marker">{marker}</span>
      {icon ? <span className="workbench-tree-item__icon">{icon}</span> : null}
      <span className="workbench-tree-item__label">{children}</span>
    </button>
  );
}