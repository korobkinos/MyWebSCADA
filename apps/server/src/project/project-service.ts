import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScadaProject } from "@web-scada/shared";
import { ensureDefaultEventSounds, projectSchema } from "@web-scada/shared";

export class ProjectService {
  private project: ScadaProject | undefined;

  public constructor(private readonly projectFile: string) {}

  public getProjectFile(): string {
    return this.projectFile;
  }

  public async loadProject(): Promise<ScadaProject> {
    const raw = await readFile(this.projectFile, "utf8");
    const rawJson = JSON.parse(raw);
    const normalized = normalizeLegacyMacroLanguages(rawJson);
    const parsed = projectSchema.parse(normalized);
    const withDefaults = withEventSoundDefaults(parsed);
    this.project = withDefaults;
    return withDefaults;
  }

  public getProject(): ScadaProject {
    if (!this.project) {
      throw new Error("Project is not loaded");
    }
    return this.project;
  }

  public async saveProject(project: ScadaProject): Promise<ScadaProject> {
    const validated = withEventSoundDefaults(projectSchema.parse(normalizeLegacyMacroLanguages(project)));
    const dir = path.dirname(this.projectFile);
    await mkdir(dir, { recursive: true });
    await writeFile(this.projectFile, JSON.stringify(validated, null, 2), "utf8");
    this.project = validated;
    return validated;
  }
}

function withEventSoundDefaults(project: ScadaProject): ScadaProject {
  return {
    ...project,
    eventSounds: ensureDefaultEventSounds(project.eventSounds),
  };
}

function normalizeLegacyMacroLanguages(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }
  const project = input as { macros?: unknown[]; drivers?: unknown[]; tags?: unknown[] };
  const opcuaDriverIds = new Set<string>();
  if (Array.isArray(project.drivers)) {
    project.drivers = project.drivers.filter((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const type = (item as { type?: unknown }).type;
      if (type === "opcua") {
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && id.trim().length > 0) {
          opcuaDriverIds.add(id);
        }
      }
      return type === "opcua" || type === "simulated";
    });
  }
  if (Array.isArray(project.tags)) {
    project.tags = project.tags.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }
      const tag = item as {
        sourceType?: unknown;
        driverId?: unknown;
        nodeId?: unknown;
        address?: unknown;
      };
      const isOpcUa = tag.sourceType === "opcua" || (typeof tag.driverId === "string" && opcuaDriverIds.has(tag.driverId));
      if (!isOpcUa) {
        return item;
      }

      const inlineNodeId = typeof tag.nodeId === "string" && tag.nodeId.trim().length > 0 ? tag.nodeId.trim() : undefined;
      const addressNodeId =
        tag.address && typeof tag.address === "object"
          ? (() => {
              const candidate = (tag.address as Record<string, unknown>).nodeId ?? (tag.address as Record<string, unknown>).raw;
              return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
            })()
          : undefined;
      const resolvedNodeId = inlineNodeId ?? addressNodeId;
      if (!resolvedNodeId) {
        return item;
      }
      return {
        ...item,
        sourceType: "opcua",
        nodeId: resolvedNodeId,
        address: { nodeId: resolvedNodeId },
      };
    });
  }
  if (!Array.isArray(project.macros)) {
    return input;
  }
  project.macros = project.macros.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const macro = item as { language?: unknown; code?: unknown };
    if (macro.language === "expression" || macro.language === "blockly" || macro.language === "ts") {
      const existingCode = typeof macro.code === "string" ? macro.code : "";
      return {
        ...macro,
        language: "javascript-lite",
        code:
          existingCode.includes("Migrated from legacy language")
            ? existingCode
            : `// Migrated from legacy language: ${String(macro.language)}\n${existingCode}`,
      };
    }
    return item;
  });
  return input;
}
