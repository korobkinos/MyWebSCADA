import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ports = [3001, 5173];

async function killOnWindows() {
  const [tcp, tcpv6] = await Promise.all([
    execFileAsync("netstat", ["-ano", "-p", "tcp"], { windowsHide: true }),
    execFileAsync("netstat", ["-ano", "-p", "tcpv6"], { windowsHide: true }).catch(() => ({ stdout: "" })),
  ]);
  const lines = `${tcp.stdout}\n${tcpv6.stdout}`.split(/\r?\n/);
  const pids = new Set();

  for (const line of lines) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+\S+\s+(\d+)\s*$/i);
    if (!match) {
      continue;
    }
    const port = Number(match[1]);
    const pid = Number(match[2]);
    if (!ports.includes(port) || !Number.isFinite(pid) || pid <= 0) {
      continue;
    }
    pids.add(pid);
  }

  if (pids.size === 0) {
    process.stdout.write(`No TCP listeners found on ports: ${ports.join(", ")}\n`);
    return;
  }

  for (const pid of pids) {
    process.stdout.write(`Killing PID ${pid}...\n`);
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to kill PID ${pid}: ${message}\n`);
    }
  }
}

async function killOnUnix() {
  for (const port of ports) {
    try {
      const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`]);
      const pids = stdout
        .split(/\r?\n/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
      for (const pid of pids) {
        process.stdout.write(`Killing PID ${pid} on port ${port}...\n`);
        process.kill(pid, "SIGKILL");
      }
    } catch {
      // no process or lsof unavailable
    }
  }
}

async function main() {
  if (process.platform === "win32") {
    await killOnWindows();
  } else {
    await killOnUnix();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
