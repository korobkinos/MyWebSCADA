/**
 * Global monotonically increasing z-index counter.
 * Used by standalone windows (TagPicker, IndexedAddressEditor) that render
 * outside the WorkbenchWindowManager to ensure proper stacking order.
 *
 * The counter starts at 5000 to stay above the WorkbenchWindowManager's range
 * (which starts at 10 and increments per window open/focus).
 */
let globalZIndex = 5000;

export function nextGlobalZIndex(): number {
  globalZIndex += 1;
  return globalZIndex;
}

/** For testing only */
export function resetGlobalZIndex(value = 5000): void {
  globalZIndex = value;
}
