import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm" : "pnpm";
const cwd = process.cwd();

const commands = [
  { name: "server", args: ["--filter", "@web-scada/server", "dev"] },
  { name: "client", args: ["--filter", "@web-scada/client", "dev"] },
];

const children = new Map();
let shuttingDown = false;
let finalExitCode = 0;

function pipeWithPrefix(stream, label, target) {
  if (!stream) {
    return;
  }
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    target.write(`[${label}] ${line}\n`);
  });
}

function runDetachedCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve(false));
    child.once("exit", () => resolve(true));
  });
}

async function killChildTree(childState) {
  if (!childState || childState.exited || !childState.child.pid) {
    return;
  }
  const pid = childState.child.pid;
  if (!pid) {
    return;
  }

  if (isWindows) {
    await runDetachedCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 3500));
  if (childState.exited) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore forced-kill errors during shutdown
    }
  }
}

async function shutdown(reason, requestedExitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  finalExitCode = requestedExitCode;

  process.stdout.write(`\nStopping dev processes... (${reason})\n`);
  const tasks = [];
  for (const [name, state] of children.entries()) {
    if (!state.exited && state.child.pid) {
      process.stdout.write(`Stopping ${name} pid=${state.child.pid}\n`);
    }
    tasks.push(killChildTree(state));
  }

  await Promise.all(tasks);
  process.stdout.write("Dev processes stopped.\n");
  process.exit(finalExitCode);
}

function startChild(name, args) {
  const spawnConfig = isWindows
    ? {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", `${pnpmCommand} ${args.join(" ")}`],
      }
    : {
        command: pnpmCommand,
        args,
      };

  const child = spawn(spawnConfig.command, spawnConfig.args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: !isWindows,
    windowsHide: true,
  });

  const childState = { name, child, exited: false };
  children.set(name, childState);

  pipeWithPrefix(child.stdout, name, process.stdout);
  pipeWithPrefix(child.stderr, name, process.stderr);

  child.once("error", async (error) => {
    process.stderr.write(`[${name}] failed to start: ${error.message}\n`);
    await shutdown(`${name} failed to start`, 1);
  });

  child.once("exit", async (code, signal) => {
    childState.exited = true;
    const printedCode = code ?? (signal ? `signal ${signal}` : "unknown");
    process.stdout.write(`[${name}] exited (${printedCode})\n`);
    if (shuttingDown) {
      return;
    }
    const nextCode = typeof code === "number" ? code : 1;
    await shutdown(`${name} exited`, nextCode === 0 ? 0 : 1);
  });
}

process.once("SIGINT", () => {
  void shutdown("SIGINT", 0);
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});

for (const command of commands) {
  startChild(command.name, command.args);
}
