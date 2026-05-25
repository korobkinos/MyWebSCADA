import { message } from "antd";

const CLEANUP_HINT_KEY = "project-cleanup-hint";
let lastHintAt = 0;

export function showProjectCleanupHint(context?: string): void {
  const now = Date.now();
  if (now - lastHintAt < 15_000) {
    return;
  }
  lastHintAt = now;
  const prefix = context ? `${context}. ` : "";
  void message.info({
    key: CLEANUP_HINT_KEY,
    duration: 4,
    content: `${prefix}Open Project Manager > Maintenance > Cleanup to analyze and safely remove stale resources.`,
  });
}
