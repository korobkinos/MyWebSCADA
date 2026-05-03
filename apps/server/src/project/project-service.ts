import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScadaProject } from "@web-scada/shared";
import { projectSchema } from "@web-scada/shared";

export class ProjectService {
  private project: ScadaProject | undefined;

  public constructor(private readonly projectFile: string) {}

  public getProjectFile(): string {
    return this.projectFile;
  }

  public async loadProject(): Promise<ScadaProject> {
    const raw = await readFile(this.projectFile, "utf8");
    const parsed = projectSchema.parse(JSON.parse(raw));
    this.project = parsed;
    return parsed;
  }

  public getProject(): ScadaProject {
    if (!this.project) {
      throw new Error("Project is not loaded");
    }
    return this.project;
  }

  public async saveProject(project: ScadaProject): Promise<ScadaProject> {
    const validated = projectSchema.parse(project);
    const dir = path.dirname(this.projectFile);
    await mkdir(dir, { recursive: true });
    await writeFile(this.projectFile, JSON.stringify(validated, null, 2), "utf8");
    this.project = validated;
    return validated;
  }
}
