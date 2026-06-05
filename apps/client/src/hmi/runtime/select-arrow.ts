export function getSelectArrowPoints(centerX: number, centerY: number, open: boolean): number[] {
  return open
    ? [centerX - 5, centerY + 3, centerX, centerY - 2, centerX + 5, centerY + 3]
    : [centerX - 5, centerY - 2, centerX, centerY + 3, centerX + 5, centerY - 2];
}
