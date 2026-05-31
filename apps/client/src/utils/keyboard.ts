export function isTextEditingTarget(target: EventTarget | null): boolean {
  let element: HTMLElement | null = null;
  if (target instanceof HTMLElement) {
    element = target;
  } else if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
    element = document.activeElement;
  }

  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  if (element.closest(".monaco-editor")) {
    return true;
  }

  if (element.closest(".cm-editor")) {
    return true;
  }

  if (element.closest("[contenteditable=\"true\"]")) {
    return true;
  }

  if (element.closest("[data-code-editor='true']")) {
    return true;
  }

  return false;
}

