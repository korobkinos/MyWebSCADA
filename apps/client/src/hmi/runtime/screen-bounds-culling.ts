import { intersectsScreenBounds } from "./offscreen-filter";

export function shouldRenderObjectForScreenBounds(
  object: Parameters<typeof intersectsScreenBounds>[0],
  screen: Parameters<typeof intersectsScreenBounds>[1],
  options?: { forceScreenBoundsCulling?: boolean; disableOffscreenCulling?: boolean; mode?: "editor" | "runtime" },
): boolean {
  if (options?.disableOffscreenCulling) {
    return true;
  }
  if (options?.mode !== "runtime" && options?.forceScreenBoundsCulling !== true) {
    return true;
  }
  return intersectsScreenBounds(object, screen);
}
