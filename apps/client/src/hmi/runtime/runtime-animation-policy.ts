export function shouldRunRuntimeAnimationTick(
  configActive: boolean,
  animationActive: boolean,
  speed: number,
): boolean {
  return configActive && animationActive && Number.isFinite(speed) && speed !== 0;
}

const HEAVY_FLOW_MARKER_COUNT = 120;
const HEAVY_FLOW_FRAME_INTERVAL_MS = 1000 / 30;

export function shouldUpdateRuntimeFlowFrame(
  time: number,
  previousFrameTime: number | null,
  usesMarkerNodes: boolean,
  markerCount: number,
): boolean {
  if (!usesMarkerNodes || markerCount < HEAVY_FLOW_MARKER_COUNT || previousFrameTime === null) {
    return true;
  }
  return time - previousFrameTime >= HEAVY_FLOW_FRAME_INTERVAL_MS;
}
