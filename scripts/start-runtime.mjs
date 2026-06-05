import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const isWindows = process.platform === "win32";
const cwd = process.cwd();
const distRoot = resolve(cwd, "apps/client/dist");
const indexFile = join(distRoot, "index.html");
const clientPort = Number(process.env.CLIENT_PORT ?? 3000);
const serverPort = Number(process.env.PORT ?? 3001);
const clientHost = process.env.CLIENT_HOST ?? "0.0.0.0";
const serverUrl = `http://127.0.0.1:${serverPort}`;
const children = new Map();
let staticServer;
let shuttingDown = false;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function ensureClientBuild() {
  if (!existsSync(indexFile)) {
    process.stderr.write("Client build not found. Run: pnpm --filter @web-scada/client build\n");
    process.exit(1);
  }
}

function pipeWithPrefix(stream, label, target) {
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    target.write(`[${label}] ${line}\n`);
  });
}

function runDetachedCommand(command, args) {
  return new Promise((resolveDone) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolveDone(false));
    child.once("exit", () => resolveDone(true));
  });
}

async function killChildTree(childState) {
  if (!childState || childState.exited || !childState.child.pid) {
    return;
  }
  const pid = childState.child.pid;
  if (isWindows) {
    await runDetachedCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.stdout.write(`\nStopping runtime... (${reason})\n`);
  await Promise.all([...children.values()].map(killChildTree));
  if (staticServer) {
    await new Promise((resolveDone) => staticServer.close(resolveDone));
  }
  process.stdout.write("Runtime stopped.\n");
  process.exit(exitCode);
}

function startServer() {
  const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = isWindows
    ? ["/d", "/s", "/c", "pnpm --filter @web-scada/server start"]
    : ["--filter", "@web-scada/server", "start"];
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, PORT: String(serverPort) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: !isWindows,
    windowsHide: true,
  });
  const childState = { child, exited: false };
  children.set("server", childState);
  pipeWithPrefix(child.stdout, "server", process.stdout);
  pipeWithPrefix(child.stderr, "server", process.stderr);
  child.once("exit", async (code) => {
    childState.exited = true;
    if (!shuttingDown) {
      await shutdown(`server exited ${code ?? "unknown"}`, code ?? 1);
    }
  });
  child.once("error", async (error) => {
    process.stderr.write(`[server] failed to start: ${error.message}\n`);
    await shutdown("server failed to start", 1);
  });
}

function resolveStaticPath(requestUrl) {
  const parsed = new URL(requestUrl, `http://127.0.0.1:${clientPort}`);
  const decodedPath = decodeURIComponent(parsed.pathname);
  const candidate = normalize(join(distRoot, decodedPath));
  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${sep}`)) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  return indexFile;
}

function proxyRequest(req, res) {
  const target = new URL(req.url ?? "/", serverUrl);
  const proxy = http.request(
    target,
    {
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxy.once("error", () => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Backend unavailable");
  });
  req.pipe(proxy);
}

function startStaticServer() {
  staticServer = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/")) {
      proxyRequest(req, res);
      return;
    }
    const filePath = resolveStaticPath(url);
    if (!filePath) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
      "cache-control": filePath === indexFile ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
  });
  staticServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    const backendSocket = net.connect(serverPort, "127.0.0.1", () => {
      const headers = [
        `${req.method ?? "GET"} ${req.url} HTTP/${req.httpVersion}`,
        ...Object.entries(req.headers).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value ?? ""}`),
        "",
        "",
      ].join("\r\n");
      backendSocket.write(headers);
      if (head.length > 0) {
        backendSocket.write(head);
      }
      socket.pipe(backendSocket);
      backendSocket.pipe(socket);
    });
    backendSocket.once("error", () => socket.destroy());
    socket.once("error", () => backendSocket.destroy());
  });
  staticServer.listen(clientPort, clientHost, () => {
    process.stdout.write(`Runtime UI: http://127.0.0.1:${clientPort}\n`);
    process.stdout.write(`Backend: ${serverUrl}\n`);
  });
}

ensureClientBuild();
process.once("SIGINT", () => void shutdown("SIGINT", 0));
process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
startServer();
startStaticServer();
