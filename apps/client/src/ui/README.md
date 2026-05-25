# UI Layer

Use `apps/client/src/ui` as the default UI import entry point for client code.

Rules:
- Prefer `App*` wrappers from this folder for buttons, inputs, selects, dialogs, tabs, panels, forms, windows, and toasts.
- Keep VS Code-like dark theme values in CSS variables (`--app-*`) and reuse those tokens instead of hardcoded colors.
- Avoid random one-off UI CSS when existing `App*` components or shared classes already cover the use case.
- Direct `@blueprintjs/*` imports should normally stay inside this UI layer.
- Existing features can migrate incrementally; new shared UI should start from this layer.

Toast:
- Use `useAppToast()` in React components.
- Use `appToast` for non-React modules (for example store/services) when needed.
