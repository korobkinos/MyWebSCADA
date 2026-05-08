export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target.closest(".monaco-editor")) {
    return true;
  }

  if (target.closest(".cm-editor")) {
    return true;
  }

  if (target.closest("[contenteditable=\"true\"]")) {
    return true;
  }

  if (target.closest("[data-code-editor='true']")) {
    return true;
  }

  return false;
}

