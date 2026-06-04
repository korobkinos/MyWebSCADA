export function shouldRunRuntimeAnimationTick(
  configActive: boolean,
  animationActive: boolean,
  speed: number,
): boolean {
  return configActive && animationActive && Number.isFinite(speed) && speed !== 0;
}

function getFlowMarkerFrameIntervalMs(markerCount: number): number {
  if (markerCount >= 300) {
    return 1000 / 5;
  }
  if (markerCount >= 150) {
    return 1000 / 10;
  }
  if (markerCount >= 50) {
    return 1000 / 15;
  }
  return 1000 / 30;
}

export function shouldUpdateRuntimeFlowFrame(
  time: number,
  previousFrameTime: number | null,
  usesMarkerNodes: boolean,
  markerCount: number,
): boolean {
  if (!usesMarkerNodes || previousFrameTime === null) {
    return true;
  }
  return time - previousFrameTime >= getFlowMarkerFrameIntervalMs(markerCount);
}
