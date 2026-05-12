import { useCallback, useMemo, useState, type ReactNode } from "react";

type WorkbenchSectionProps = {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  storageKey?: string;
};

export function WorkbenchSection({
  title,
  actions,
  children,
  className,
  collapsible = false,
  defaultCollapsed = false,
  collapsed,
  onCollapsedChange,
  storageKey,
}: WorkbenchSectionProps) {
  const initialCollapsed = useMemo(() => {
    if (!collapsible) {
      return false;
    }
    if (typeof collapsed === "boolean") {
      return collapsed;
    }
    if (storageKey && typeof window !== "undefined") {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "1") {
        return true;
      }
      if (raw === "0") {
        return false;
      }
    }
    return defaultCollapsed;
  }, [collapsed, collapsible, defaultCollapsed, storageKey]);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState<boolean>(initialCollapsed);
  const isCollapsed = collapsible ? (typeof collapsed === "boolean" ? collapsed : uncontrolledCollapsed) : false;

  const setNextCollapsed = useCallback((next: boolean) => {
    if (typeof collapsed !== "boolean") {
      setUncontrolledCollapsed(next);
    }
    if (storageKey && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    }
    onCollapsedChange?.(next);
  }, [collapsed, onCollapsedChange, storageKey]);

  const toggleCollapsed = useCallback(() => {
    if (!collapsible) {
      return;
    }
    setNextCollapsed(!isCollapsed);
  }, [collapsible, isCollapsed, setNextCollapsed]);

  return (
    <section
      className={[
        "workbench-section",
        collapsible ? "workbench-section--collapsible" : "",
        isCollapsed ? "workbench-section--collapsed" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {title || actions ? (
        <div
          className={["workbench-section__header", collapsible ? "workbench-section__header--clickable" : ""].filter(Boolean).join(" ")}
          onClick={toggleCollapsed}
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={(event) => {
            if (!collapsible) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleCollapsed();
            }
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {collapsible ? <span className="workbench-section__caret">{isCollapsed ? "▸" : "▾"}</span> : null}
            {title ? <div className="workbench-section__title">{title}</div> : <span />}
          </div>
          {actions ? <div className="workbench-section__actions" onClick={(event) => event.stopPropagation()}>{actions}</div> : null}
        </div>
      ) : null}
      {!isCollapsed ? <div className="workbench-section__content">{children}</div> : null}
    </section>
  );
}
