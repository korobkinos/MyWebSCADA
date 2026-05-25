import { OverlayToaster, Position, type Toaster } from "@blueprintjs/core";
import { useEffect, type ReactNode } from "react";
import { setAppToaster } from "./AppToast";

let toasterInstance: Toaster | null = null;
let creatingPromise: Promise<Toaster> | null = null;

async function ensureToaster(): Promise<Toaster> {
  if (toasterInstance) {
    return toasterInstance;
  }
  if (!creatingPromise) {
    creatingPromise = OverlayToaster.create({
      className: "app-toast-container",
      position: Position.TOP_RIGHT,
      maxToasts: 6,
      usePortal: true,
    }).then((instance) => {
      toasterInstance = instance;
      return instance;
    });
  }
  return creatingPromise;
}

export function AppUiProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let active = true;
    if (typeof document !== "undefined") {
      document.body.classList.add("app-workbench-theme");
    }
    void ensureToaster().then((instance) => {
      if (!active) {
        return;
      }
      setAppToaster(instance);
    });
    return () => {
      active = false;
      if (typeof document !== "undefined") {
        document.body.classList.remove("app-workbench-theme");
      }
    };
  }, []);

  return <div className="bp6-dark workbench-theme app-ui-root">{children}</div>;
}
