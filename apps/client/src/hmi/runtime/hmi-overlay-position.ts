type RuntimeOverlayViewportInput = {
  wrapRect: Pick<DOMRect, "left" | "top">;
  scrollLeft: number;
  scrollTop: number;
  overlay: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
};

export function resolveRuntimeOverlayViewportRect(input: RuntimeOverlayViewportInput): {
  left: number;
  top: number;
  width?: number;
  height?: number;
} {
  return {
    left: input.wrapRect.left - input.scrollLeft + input.overlay.x,
    top: input.wrapRect.top - input.scrollTop + input.overlay.y,
    width: input.overlay.width,
    height: input.overlay.height,
  };
}
