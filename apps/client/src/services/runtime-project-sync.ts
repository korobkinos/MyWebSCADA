import type { ScadaProject } from "@web-scada/shared";

type RuntimeProjectPollerOptions = {
  fetchProject: () => Promise<ScadaProject>;
  applyProject: (project: ScadaProject) => void;
  getCurrentProjectSignature: () => string | null;
  setCurrentProjectSignature: (signature: string) => void;
  intervalMs: number;
};

export function getRuntimeProjectSignature(project: ScadaProject | null | undefined): string | null {
  return project ? JSON.stringify(project) : null;
}

export function createRuntimeProjectPoller(options: RuntimeProjectPollerOptions): { close: () => void } {
  let closed = false;
  let inFlight = false;

  const poll = () => {
    if (closed || inFlight) {
      return;
    }
    inFlight = true;
    void options.fetchProject()
      .then((project) => {
        const signature = getRuntimeProjectSignature(project);
        if (signature && signature !== options.getCurrentProjectSignature()) {
          options.setCurrentProjectSignature(signature);
          options.applyProject(project);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = setInterval(poll, options.intervalMs);

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
    },
  };
}
