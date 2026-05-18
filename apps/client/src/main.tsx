import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/app";
import "antd/dist/reset.css";
import "./app/styles.css";

const STYLE_GUARD_KEY = "__scadaInvalidStyleGuardInstalled__";

function installInvalidStyleGuard(): void {
  if (typeof window === "undefined") {
    return;
  }
  const scopedWindow = window as Window & { [STYLE_GUARD_KEY]?: boolean };
  if (scopedWindow[STYLE_GUARD_KEY]) {
    return;
  }
  scopedWindow[STYLE_GUARD_KEY] = true;

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function patchedSetAttribute(name: string, value: string): void {
    if (name === "style" && typeof value === "string" && value.trimStart().startsWith("[")) {
      originalSetAttribute.call(this, name, "");
      return;
    }
    originalSetAttribute.call(this, name, value);
  };

  const cssTextDescriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, "cssText");
  const cssTextSetter = cssTextDescriptor?.set;
  if (!cssTextSetter) {
    return;
  }
  Object.defineProperty(CSSStyleDeclaration.prototype, "cssText", {
    configurable: true,
    enumerable: cssTextDescriptor?.enumerable ?? false,
    get: cssTextDescriptor?.get,
    set(value: string) {
      if (typeof value === "string" && value.trimStart().startsWith("[")) {
        cssTextSetter.call(this, "");
        return;
      }
      cssTextSetter.call(this, value);
    },
  });
}

installInvalidStyleGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
