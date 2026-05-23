import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type EventSound, type ScadaProject, ensureDefaultEventSounds, isDefaultEventSoundId } from "@web-scada/shared";
import { ProjectService } from "../project/project-service.js";

type UploadInput = {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  name?: string;
};

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "ogg"]);
const ALLOWED_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/ogg"]);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSoundName(value: string | undefined, fallbackFileName: string, fallbackId: string): string {
  const direct = (value ?? "").trim();
  if (direct) {
    return direct.slice(0, 120);
  }
  const fromFile = path.parse(fallbackFileName).name.trim();
  if (fromFile) {
    return fromFile.slice(0, 120);
  }
  return fallbackId;
}

function fileExtensionFromName(fileName: string): string {
  return path.extname(fileName).replace(/^\./, "").trim().toLowerCase();
}

function parseStoredFileName(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1);
}

function ensureCustomSound(sound: EventSound): void {
  if (sound.kind !== "custom" || isDefaultEventSoundId(sound.id)) {
    throw new Error("Only custom sounds can be changed.");
  }
}

export class EventSoundService {
  public constructor(
    private readonly projectService: ProjectService,
    private readonly storageDir: string,
  ) {}

  public listProjectEventSounds(): EventSound[] {
    const project = this.projectService.getProject();
    return ensureDefaultEventSounds(project.eventSounds);
  }

  public getProjectEventSound(soundId: string): EventSound | undefined {
    return this.listProjectEventSounds().find((item) => item.id === soundId);
  }

  public resolveProjectEventSoundFile(soundId: string): { sound: EventSound; absolutePath: string } | undefined {
    const sound = this.getProjectEventSound(soundId);
    if (!sound) {
      return undefined;
    }
    const storedFileName = parseStoredFileName(sound.filePath);
    if (!storedFileName) {
      return undefined;
    }
    return {
      sound,
      absolutePath: path.join(this.storageDir, storedFileName),
    };
  }

  public async uploadProjectEventSound(input: UploadInput): Promise<EventSound> {
    const extension = fileExtensionFromName(input.fileName);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("Unsupported sound file extension. Supported: mp3, wav, ogg.");
    }
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new Error("Unsupported sound MIME type. Supported: audio/mpeg, audio/wav, audio/ogg.");
    }

    await mkdir(this.storageDir, { recursive: true });
    const id = randomUUID();
    const storedFileName = `${id}.${extension}`;
    const absolutePath = path.join(this.storageDir, storedFileName);
    await writeFile(absolutePath, input.content);

    const timestamp = nowIso();
    const sound: EventSound = {
      id,
      name: normalizeSoundName(input.name, input.fileName, id),
      kind: "custom",
      fileName: path.basename(input.fileName),
      filePath: path.posix.join("data", "event-sounds", storedFileName),
      mimeType: input.mimeType,
      sizeBytes: input.size,
      url: `/api/event-sounds/${encodeURIComponent(id)}/file`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const project = this.projectService.getProject();
    const nextProject: ScadaProject = {
      ...project,
      eventSounds: [...ensureDefaultEventSounds(project.eventSounds), sound],
    };
    await this.projectService.saveProject(nextProject);
    return sound;
  }

  public async renameProjectEventSound(soundId: string, patch: { name: string }): Promise<EventSound> {
    const nextName = patch.name.trim().slice(0, 120);
    if (!nextName) {
      throw new Error("Sound name is required.");
    }
    const project = this.projectService.getProject();
    const currentSounds = ensureDefaultEventSounds(project.eventSounds);
    const index = currentSounds.findIndex((item) => item.id === soundId);
    if (index < 0) {
      throw new Error("Sound not found");
    }
    const target = currentSounds[index]!;
    ensureCustomSound(target);
    const nextSound: EventSound = {
      ...target,
      name: nextName,
      updatedAt: nowIso(),
    };
    const nextSounds = [...currentSounds];
    nextSounds[index] = nextSound;
    const nextProject: ScadaProject = {
      ...project,
      eventSounds: nextSounds,
    };
    await this.projectService.saveProject(nextProject);
    return nextSound;
  }

  public async deleteProjectEventSound(soundId: string): Promise<void> {
    const project = this.projectService.getProject();
    const currentSounds = ensureDefaultEventSounds(project.eventSounds);
    const index = currentSounds.findIndex((item) => item.id === soundId);
    if (index < 0) {
      throw new Error("Sound not found");
    }
    const target = currentSounds[index]!;
    ensureCustomSound(target);

    const storedFileName = parseStoredFileName(target.filePath);
    if (storedFileName) {
      const absolutePath = path.join(this.storageDir, storedFileName);
      await rm(absolutePath, { force: true });
    }

    const nextProject: ScadaProject = {
      ...project,
      eventSounds: currentSounds.filter((item) => item.id !== soundId),
    };
    await this.projectService.saveProject(nextProject);
  }
}
