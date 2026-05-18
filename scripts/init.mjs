import { execFile, spawn } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";
const dockerCommand = "docker";

const DEV_CONTAINER_NAME = "mywebscada-timescale-dev";
const DEV_IMAGE = "timescale/timescaledb:latest-pg16";
const DEV_DB_NAME = "mywebscada_archive";
const DEV_DB_USER = "postgres";
const DEV_DB_PASSWORD = "postgres";
const DEV_PORT = "55432";
const READY_TIMEOUT_MS = 90_000;

const frames = ["-", "\\", "|", "/"];

function printStep(index, total, text) {
  process.stdout.write(`[init] ${index}/${total} ${text}\n`);
}

async function runCommandOk(command, args) {
  try {
    await execFileAsync(command, args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function runInherited(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function ensureDocker() {
  return runCommandOk(dockerCommand, ["version", "--format", "{{.Server.Version}}"]);
}

async function ensureImage() {
  const imageExists = await runCommandOk(dockerCommand, ["image", "inspect", DEV_IMAGE]);
  if (imageExists) {
    process.stdout.write(`[init] Image is available: ${DEV_IMAGE}\n`);
    return true;
  }
  process.stdout.write(`[init] Pulling image: ${DEV_IMAGE}\n`);
  return runInherited(dockerCommand, ["pull", DEV_IMAGE]);
}

async function ensureContainer() {
  const containerExists = await runCommandOk(dockerCommand, ["container", "inspect", DEV_CONTAINER_NAME]);
  if (containerExists) {
    process.stdout.write(`[init] Starting container: ${DEV_CONTAINER_NAME}\n`);
    return runInherited(dockerCommand, ["start", DEV_CONTAINER_NAME]);
  }
  process.stdout.write(`[init] Creating container: ${DEV_CONTAINER_NAME}\n`);
  return runInherited(dockerCommand, [
    "run",
    "-d",
    "--name",
    DEV_CONTAINER_NAME,
    "-e",
    `POSTGRES_PASSWORD=${DEV_DB_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${DEV_DB_NAME}`,
    "-p",
    `${DEV_PORT}:5432`,
    DEV_IMAGE,
  ]);
}

async function waitForReady() {
  const startedAt = Date.now();
  let frameIndex = 0;

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    const ok = await runCommandOk(dockerCommand, [
      "exec",
      DEV_CONTAINER_NAME,
      "pg_isready",
      "-U",
      DEV_DB_USER,
      "-d",
      DEV_DB_NAME,
    ]);
    if (ok) {
      process.stdout.write("\r[init] Database is ready.                           \n");
      return true;
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`\r[init] Waiting for database ${frames[frameIndex % frames.length]} ${elapsed}s`);
    frameIndex += 1;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  process.stdout.write("\r[init] Database readiness timeout.                 \n");
  return false;
}

async function runInit() {
  const steps = 4;
  printStep(1, steps, "Checking Docker...");
  const dockerReady = await ensureDocker();
  if (!dockerReady) {
    process.stderr.write("[init] Docker is not available. Start Docker Desktop and try again.\n");
    process.exit(1);
  }

  printStep(2, steps, "Checking archive database image...");
  const imageReady = await ensureImage();
  if (!imageReady) {
    process.stderr.write("[init] Failed to pull archive database image.\n");
    process.exit(1);
  }

  printStep(3, steps, "Checking archive database container...");
  const containerReady = await ensureContainer();
  if (!containerReady) {
    process.stderr.write(`[init] Failed to prepare container ${DEV_CONTAINER_NAME}. Check port ${DEV_PORT}.\n`);
    process.exit(1);
  }

  printStep(4, steps, "Waiting for database readiness...");
  const ready = await waitForReady();
  if (!ready) {
    process.stderr.write("[init] Database did not become ready in time.\n");
    process.exit(1);
  }

  process.stdout.write("[init] Done. ARCHIVE_DATABASE_URL=postgres://postgres:postgres@localhost:55432/mywebscada_archive\n");
}

void runInit();
