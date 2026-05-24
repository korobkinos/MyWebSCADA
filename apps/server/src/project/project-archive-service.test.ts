import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import type { Asset, HmiScreen, ScadaProject } from "@web-scada/shared";
import { EventSoundService } from "../events/event-sound-service.js";
import { LibraryService } from "../libraries/library-service.js";
import { ProjectArchiveService } from "./project-archive-service.js";
import { ProjectService } from "./project-service.js";

const roots: string[] = [];
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function makeAsset(id: string, size = PNG_BYTES.byteLength): Asset {
  return {
    id,
    name: id,
    type: "png",
    mimeType: "image/png",
    fileName: `${id}.png`,
    size,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    storagePath: `assets/${id}.png`,
    previewUrl: `/api/assets/${id}/file`,
  };
}

function makeScreen(id: string, assetId = "asset1"): HmiScreen {
  return {
    id,
    name: id === "main" ? "Main" : id,
    kind: "screen",
    width: 800,
    height: 600,
    background: "#111111",
    objects: [
      {
        id: "image1",
        type: "image",
        name: "Image 1",
        x: 10,
        y: 10,
        width: 120,
        height: 80,
        assetId,
        fit: "contain",
      },
    ],
  };
}

function makeProject(name: string, screenId = "main", assetId = "asset1"): ScadaProject {
  return {
    version: 1,
    name,
    assets: [makeAsset(assetId)],
    drivers: [],
    tags: [{ name: "Tank.Level", dataType: "REAL", sourceType: "simulated" }],
    screens: [makeScreen(screenId, assetId)],
    startScreenId: screenId,
    macros: [],
    variables: [],
    libraries: [],
    events: [],
  };
}

async function makeHarness(project: ScadaProject, assetBytes = PNG_BYTES): Promise<{
  root: string;
  service: ProjectArchiveService;
  projectService: ProjectService;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mywebscada-archive-test-"));
  roots.push(root);
  const projectFile = path.join(root, "projects", "demo-project.json");
  await mkdir(path.join(root, "projects", "assets"), { recursive: true });
  await mkdir(path.join(root, "libraries"), { recursive: true });
  await mkdir(path.join(root, "data", "event-sounds"), { recursive: true });
  await writeFile(projectFile, JSON.stringify(project, null, 2), "utf8");
  for (const asset of project.assets ?? []) {
    await writeFile(path.join(root, "projects", asset.storagePath), assetBytes);
  }
  const projectService = new ProjectService(projectFile);
  await projectService.loadProject();
  const eventSoundService = new EventSoundService(projectService, path.join(root, "data", "event-sounds"));
  const libraryService = new LibraryService(path.join(root, "libraries"), projectService);
  return {
    root,
    service: new ProjectArchiveService(projectService, libraryService, eventSoundService),
    projectService,
  };
}

function upload(buffer: Buffer) {
  return {
    fileName: "archive.zip",
    mimeType: "application/zip",
    size: buffer.byteLength,
    content: buffer,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectArchiveService", () => {
  it("validates an exported full project archive", async () => {
    const harness = await makeHarness(makeProject("Portable Project"));
    const exported = await harness.service.exportProjectArchive();

    const result = await harness.service.validateProjectArchive(upload(exported.buffer));

    expect(result.valid).toBe(true);
    expect(result.summary).toMatchObject({
      format: "mywebscada-project",
      name: "Portable Project",
      screens: 1,
      tags: 1,
      assets: 1,
    });
    expect(result.errors).toEqual([]);
  });

  it("rejects checksum mismatches before import", async () => {
    const harness = await makeHarness(makeProject("Checksum Project"));
    const exported = await harness.service.exportProjectArchive();
    const zip = new AdmZip(exported.buffer);
    zip.updateFile("assets/asset1.png", Buffer.from("tampered"));

    const result = await harness.service.validateProjectArchive(upload(zip.toBuffer() as Buffer));

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "CHECKSUM_MISMATCH" && issue.path === "assets/asset1.png")).toBe(true);
  });

  it("rejects unsafe archive paths", async () => {
    const zip = new AdmZip();
    zip.addFile("C:/evil.json", Buffer.from("{}", "utf8"));
    const harness = await makeHarness(makeProject("Unsafe Project"));

    const result = await harness.service.validateProjectArchive(upload(zip.toBuffer() as Buffer));

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "UNSAFE_PATH")).toBe(true);
  });

  it("rejects a project archive with a missing asset file", async () => {
    const harness = await makeHarness(makeProject("Missing Asset Project"));
    const exported = await harness.service.exportProjectArchive();
    const zip = new AdmZip(exported.buffer);
    zip.deleteFile("assets/asset1.png");

    const result = await harness.service.validateProjectArchive(upload(zip.toBuffer() as Buffer));

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "MANIFEST_FILE_MISSING" || issue.code === "MISSING_ASSET_FILE")).toBe(true);
  });

  it("imports a screen as a copy when screen and asset ids conflict", async () => {
    const source = await makeHarness(makeProject("Source Project", "main", "asset1"), Buffer.from("source-image"));
    const target = await makeHarness(makeProject("Target Project", "main", "asset1"), Buffer.from("different-image"));
    const exportedScreen = await source.service.exportScreenArchive("main");

    const result = await target.service.importScreenArchive(upload(exportedScreen.buffer), { mode: "add" });

    expect(result.ok).toBe(true);
    expect(result.screenId).not.toBe("main");
    expect(result.copiedAssets).toBe(1);
    const project = target.projectService.getProject();
    expect(project.screens).toHaveLength(2);
    expect(project.assets ?? []).toHaveLength(2);
    const importedScreen = project.screens.find((screen) => screen.id === result.screenId)!;
    const importedObject = importedScreen.objects[0] as Extract<HmiScreen["objects"][number], { type: "image" }>;
    expect(importedObject.assetId).not.toBe("asset1");
    const importedAsset = (project.assets ?? []).find((asset) => asset.id === importedObject.assetId)!;
    const bytes = await readFile(path.join(target.root, "projects", importedAsset.storagePath));
    expect(bytes.toString()).toBe("source-image");
  });
});
