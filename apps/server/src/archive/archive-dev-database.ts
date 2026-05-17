import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import type { ArchiveLogger } from "./archive-repository.js";

const execFileAsync = promisify(execFile);
const { Client } = pg;

const DEV_CONTAINER_NAME = "mywebscada-timescale-dev";
const DEV_IMAGE = "timescale/timescaledb:latest-pg16";
const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:55432/mywebscada_archive";

export async function configureArchiveEnvironment(logger: ArchiveLogger): Promise<void> {
  if (process.env.ARCHIVE_DISABLED === "1" || process.env.NODE_ENV === "production") {
    process.env.ARCHIVE_STATUS_REASON = "Archive is disabled by ARCHIVE_DISABLED=1";
    return;
  }
  if (process.env.ARCHIVE_DATABASE_URL || process.env.DATABASE_URL) {
    process.env.ARCHIVE_ENABLED ??= "1";
    process.env.ARCHIVE_STATUS_REASON = "Archive database URL is configured";
    return;
  }

  const started = await ensureDevDatabase(logger);
  if (!started) {
    process.env.ARCHIVE_STATUS_REASON = "Docker is not available or the development archive database did not start";
    logger.warn(`${process.env.ARCHIVE_STATUS_REASON}. Install Docker Desktop or set ARCHIVE_DATABASE_URL manually.`);
    return;
  }

  process.env.ARCHIVE_DATABASE_URL = DEV_DATABASE_URL;
  process.env.ARCHIVE_ENABLED = "1";
  process.env.ARCHIVE_DEFAULT_ENABLED ??= "1";
  process.env.ARCHIVE_STATUS_REASON = "Development archive database is running";
}

async function ensureDevDatabase(logger: ArchiveLogger): Promise<boolean> {
  if (!(await commandOk("docker", ["version", "--format", "{{.Server.Version}}"]))) {
    logger.warn("Docker CLI is not available or Docker Desktop is not running");
    return false;
  }

  const exists = await commandOk("docker", ["container", "inspect", DEV_CONTAINER_NAME]);
  if (exists) {
    logger.info(`Starting archive database container ${DEV_CONTAINER_NAME}`);
    await commandOk("docker", ["start", DEV_CONTAINER_NAME]);
  } else {
    if (!(await commandOk("docker", ["image", "inspect", DEV_IMAGE]))) {
      logger.info(`Downloading archive database image ${DEV_IMAGE}. This is needed only on the first run.`);
      const pulled = await runLoggedCommand("docker", ["pull", DEV_IMAGE], logger, { showProgress: true });
      if (!pulled) {
        process.env.ARCHIVE_STATUS_REASON = `Docker image ${DEV_IMAGE} was not downloaded`;
        return false;
      }
    }

    logger.info(`Creating archive database container ${DEV_CONTAINER_NAME}`);
    const created = await runLoggedCommand("docker", [
      "run",
      "-d",
      "--name",
      DEV_CONTAINER_NAME,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=mywebscada_archive",
      "-p",
      "55432:5432",
      DEV_IMAGE,
    ], logger, { showProgress: true });
    if (!created) {
      process.env.ARCHIVE_STATUS_REASON = "Archive database container was not created. Check if port 55432 is already busy.";
      return false;
    }
  }

  const ready = await waitForDatabase(DEV_DATABASE_URL, 30_000);
  if (ready) {
    logger.info("Development archive database is ready");
  }
  return ready;
}

async function commandOk(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function runLoggedCommand(
  command: string,
  args: string[],
  logger: ArchiveLogger,
  options?: { showProgress?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let bufferedStdout = "";
    let bufferedStderr = "";
    const writeProgress = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      const current = target === "stdout" ? bufferedStdout + text : bufferedStderr + text;
      const parts = current.split(/\r?\n|\r/g);
      const rest = parts.pop() ?? "";
      if (target === "stdout") {
        bufferedStdout = rest;
      } else {
        bufferedStderr = rest;
      }
      for (const part of parts) {
        const line = part.trim();
        if (line) {
          process.stdout.write(`[archive-db] ${line}\n`);
        }
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      if (options?.showProgress) {
        writeProgress(chunk, "stdout");
        return;
      }
      const text = chunk.toString("utf8").trim();
      if (text) {
        logger.info(text);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (options?.showProgress) {
        writeProgress(chunk, "stderr");
      }
      const text = chunk.toString("utf8").trim();
      if (text) {
        stderr += `${text}\n`;
        if (!options?.showProgress) {
          logger.warn(text);
        }
      }
    });
    child.once("error", (error) => {
      logger.warn(error.message);
      resolve(false);
    });
    child.once("exit", (code) => {
      const stdoutRest = bufferedStdout.trim();
      const stderrRest = bufferedStderr.trim();
      if (stdoutRest) {
        process.stdout.write(`[archive-db] ${stdoutRest}\n`);
      }
      if (stderrRest) {
        process.stdout.write(`[archive-db] ${stderrRest}\n`);
      }
      if (code && stderr.trim()) {
        process.env.ARCHIVE_STATUS_REASON = stderr.trim();
      }
      resolve(code === 0);
    });
  });
}

async function waitForDatabase(connectionString: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return true;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  return false;
}
