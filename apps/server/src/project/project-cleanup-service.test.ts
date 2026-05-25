import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, ElementLibrary, ScadaProject } from "@web-scada/shared";
import { EventSoundService } from "../events/event-sound-service.js";
import { LibraryService } from "../libraries/library-service.js";
import { ProjectArchiveService } from "./project-archive-service.js";
import { ProjectCleanupService } from "./project-cleanup-service.js";
import { ProjectService } from "./project-service.js";

const roots: string[] = [];
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function makeAsset(id: string): Asset {
  return {
    id,
    name: id,
    type: "png",
    mimeType: "image/png",
    fileName: `${id}.png`,
    size: PNG_BYTES.byteLength,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    storagePath: `assets/${id}.png`,
    previewUrl: `/api/assets/${id}/file`,
  };
}

function makeProject(name = "Cleanup Project"): ScadaProject {
  return {
    version: 1,
    name,
    drivers: [],
    tags: [{ name: "Tank.Level", dataType: "REAL", sourceType: "simulated" }],
    screens: [
      {
        id: "main",
        name: "Main",
        kind: "screen",
        width: 800,
        height: 600,
        objects: [],
      },
    ],
    assets: [],
    libraries: [],
    macros: [],
    variables: [],
    events: [],
    eventSounds: [],
  };
}

function makeLibrary(id: string): ElementLibrary {
  return {
    id,
    name: id,
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [{ ...makeAsset(`${id}-asset`), storagePath: `assets/${id}-asset.png`, previewUrl: `/api/libraries/${id}/assets/${id}-asset/file` }],
    elements: [
      {
        id: "el1",
        libraryId: id,
        name: "Element",
        width: 100,
        height: 60,
        objects: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    macros: [],
  };
}

async function writeLibrary(root: string, library: ElementLibrary, bytes = PNG_BYTES): Promise<void> {
  const dir = path.join(root, "libraries", library.id);
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "library.json"), JSON.stringify(library, null, 2), "utf8");
  for (const asset of library.assets) {
    await writeFile(path.join(dir, asset.storagePath), bytes);
  }
}

async function makeHarness(project: ScadaProject): Promise<{
  root: string;
  projectService: ProjectService;
  archiveService: ProjectArchiveService;
  cleanupService: ProjectCleanupService;
  libraryService: LibraryService;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mywebscada-cleanup-test-"));
  roots.push(root);
  const projectFile = path.join(root, "projects", "demo-project.json");
  await mkdir(path.join(root, "projects", "assets"), { recursive: true });
  await mkdir(path.join(root, "libraries"), { recursive: true });
  await mkdir(path.join(root, "data", "event-sounds"), { recursive: true });
  await writeFile(projectFile, JSON.stringify(project, null, 2), "utf8");
  for (const asset of project.assets ?? []) {
    await writeFile(path.join(root, "projects", asset.storagePath), PNG_BYTES);
  }

  const projectService = new ProjectService(projectFile);
  await projectService.loadProject();
  const libraryService = new LibraryService(path.join(root, "libraries"), projectService);
  const eventSoundService = new EventSoundService(projectService, path.join(root, "data", "event-sounds"));
  const archiveService = new ProjectArchiveService(projectService, libraryService, eventSoundService);
  const cleanupService = new ProjectCleanupService(projectService, libraryService, archiveService);

  return { root, projectService, archiveService, cleanupService, libraryService };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectCleanupService", () => {
  it("detects unused project asset records", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_used"), makeAsset("asset_unused")];
    project.screens[0]!.objects = [{
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      assetId: "asset_used",
      fit: "contain",
    }];
    const harness = await makeHarness(project);

    const result = await harness.cleanupService.analyzeProjectCleanup();

    expect(result.candidates.some((candidate) => candidate.type === "unused-project-asset-record" && candidate.id === "unused-asset:asset_unused")).toBe(true);
  });

  it("detects orphan physical files", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_used")];
    const harness = await makeHarness(project);
    const orphanPath = path.join(harness.root, "projects", "assets", "orphan.png");
    await writeFile(orphanPath, PNG_BYTES);

    const result = await harness.cleanupService.analyzeProjectCleanup(undefined, { orphanFileMinAgeMs: 0 });

    expect(result.candidates.some((candidate) => candidate.type === "orphan-physical-file" && candidate.path === "assets/orphan.png")).toBe(true);
  });

  it("detects duplicate assets by sha256", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_a"), makeAsset("asset_b")];
    const harness = await makeHarness(project);

    const result = await harness.cleanupService.analyzeProjectCleanup();

    expect(result.candidates.some((candidate) => candidate.type === "duplicate-asset")).toBe(true);
  });

  it("rewrites duplicate asset references and removes duplicate", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_canonical"), makeAsset("asset_dup")];
    project.screens[0]!.objects = [{
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      assetId: "asset_dup",
      fit: "contain",
    }];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();
    const duplicate = analysis.candidates.find((candidate) => candidate.type === "duplicate-asset" && candidate.id.endsWith(":asset_dup"));
    expect(duplicate).toBeTruthy();

    await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: [duplicate!.id],
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: false,
        deleteUnusedReviewItems: false,
      },
    });

    const saved = await harness.projectService.loadProject();
    expect((saved.screens[0]!.objects[0] as { assetId?: string }).assetId).toBe("asset_canonical");
    expect(saved.assets?.some((asset) => asset.id === "asset_dup")).toBe(false);
  });

  it("does not mark referenced asset as unused", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_ref")];
    project.screens[0]!.objects = [{
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      assetId: "asset_ref",
      fit: "contain",
    }];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();

    expect(analysis.candidates.some((candidate) => candidate.type === "unused-project-asset-record")).toBe(false);
  });

  it("detects unused library", async () => {
    const project = makeProject();
    const harness = await makeHarness(project);
    await writeLibrary(harness.root, makeLibrary("lib_unused"));

    const analysis = await harness.cleanupService.analyzeProjectCleanup();

    expect(analysis.candidates.some((candidate) => candidate.type === "unused-library" && candidate.id === "unused-library:lib_unused")).toBe(true);
  });

  it("rewrites duplicate library references and removes duplicate library", async () => {
    const project = makeProject();
    project.screens[0]!.objects = [{
      id: "lib_inst",
      type: "libraryElementInstance",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      libraryId: "lib_b",
      elementId: "el1",
      bindingAssignments: {},
    }];
    const harness = await makeHarness(project);
    const libA = makeLibrary("lib_a");
    const libB = structuredClone(libA);
    libB.id = "lib_b";
    libB.name = "lib_b";
    libB.elements = libB.elements.map((element) => ({ ...element, libraryId: "lib_b" }));
    await writeLibrary(harness.root, libA);
    await writeLibrary(harness.root, libB);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();
    const duplicate = analysis.candidates.find((candidate) => candidate.type === "duplicate-library" && candidate.id.endsWith(":lib_b"));
    expect(duplicate).toBeTruthy();

    await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: [duplicate!.id],
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: false,
        deleteUnusedReviewItems: false,
      },
    });

    const saved = await harness.projectService.loadProject();
    expect((saved.screens[0]!.objects[0] as { libraryId?: string }).libraryId).toBe("lib_a");
  });

  it("detects unused macro", async () => {
    const project = makeProject();
    project.macros = [{ id: "macro_unused", name: "Unused", language: "javascript-lite", code: "return true;", enabled: true }];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();

    expect(analysis.candidates.some((candidate) => candidate.type === "unused-macro" && candidate.id === "unused-macro:macro_unused")).toBe(true);
  });

  it("rewrites duplicate macro references and removes duplicate", async () => {
    const project = makeProject();
    project.macros = [
      { id: "macro_a", name: "A", language: "javascript-lite", code: "return 1;", enabled: true },
      { id: "macro_b", name: "B", language: "javascript-lite", code: "return 1;", enabled: true },
    ];
    project.screens[0]!.objects = [{
      id: "button1",
      type: "button",
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      text: "Run",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "center",
        verticalAlign: "middle",
      },
      fit: "contain",
      action: {
        type: "runMacro",
        macroId: "macro_b",
      },
    } as unknown as ScadaProject["screens"][number]["objects"][number]];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();
    const duplicate = analysis.candidates.find((candidate) => candidate.type === "duplicate-macro" && candidate.id.endsWith(":macro_b"));
    expect(duplicate).toBeTruthy();

    await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: [duplicate!.id],
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: false,
        deleteUnusedReviewItems: false,
      },
    });

    const saved = await harness.projectService.loadProject();
    expect(saved.macros?.some((macro) => macro.id === "macro_b")).toBe(false);
    const button = saved.screens[0]!.objects[0] as { action?: { macroId?: string } };
    expect(button.action?.macroId).toBe("macro_a");
  });

  it("does not treat local action names as macro references", async () => {
    const project = makeProject();
    project.macros = [{ id: "macro_x", name: "X", language: "javascript-lite", code: "return 1;", enabled: true }];
    project.screens[0]!.objects = [{
      id: "button_local_name",
      type: "button",
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      text: "Write",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "center",
        verticalAlign: "middle",
      },
      fit: "contain",
      action: {
        type: "writeConst",
        target: "tag",
        name: "macro_x",
        value: 1,
      },
    } as unknown as ScadaProject["screens"][number]["objects"][number]];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();

    expect(analysis.candidates.some((candidate) => candidate.type === "unused-macro" && candidate.id === "unused-macro:macro_x")).toBe(true);
  });

  it("detects unused variable and unused LW entry as review-only", async () => {
    const project = makeProject();
    project.variables = [{ name: "VarUnused", dataType: "INT" }] as NonNullable<ScadaProject["variables"]>;
    project.lwStore = { mode: "volatile", values: { 12: 55 } };
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();

    const variable = analysis.candidates.find((candidate) => candidate.type === "unused-variable");
    const lw = analysis.candidates.find((candidate) => candidate.type === "unused-lw-entry");
    expect(variable?.scope).toBe("review");
    expect(lw?.scope).toBe("review");
  });

  it("keeps simulation/driver-generated tags non-default-selected", async () => {
    const project = makeProject();
    project.tags = [{ name: "AI_SIM_999", dataType: "REAL", sourceType: "simulated" }];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();
    const candidate = analysis.candidates.find((item) => item.type === "unused-tag" && item.name === "AI_SIM_999");

    expect(candidate).toBeTruthy();
    expect(candidate?.selectedByDefault).toBe(false);
  });

  it("creates backup before apply cleanup save", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_unused")];
    const harness = await makeHarness(project);

    const calls: string[] = [];
    vi.spyOn(harness.archiveService, "createProjectBackup").mockImplementation(async () => {
      calls.push("backup");
      return "backup.zip";
    });
    vi.spyOn(harness.projectService, "saveProject").mockImplementation(async (nextProject) => {
      calls.push("save");
      return ProjectService.prototype.saveProject.call(harness.projectService, nextProject);
    });

    const analysis = await harness.cleanupService.analyzeProjectCleanup();
    const selected = analysis.candidates.filter((candidate) => candidate.type === "unused-project-asset-record").map((candidate) => candidate.id);

    await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: selected,
      options: {
        createBackup: true,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: true,
        deleteUnusedReviewItems: false,
      },
    });

    expect(calls[0]).toBe("backup");
    expect(calls[1]).toBe("save");
  });

  it("apply cleanup is idempotent for same request replay", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_unused")];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();
    const selected = analysis.candidates.filter((candidate) => candidate.type === "unused-project-asset-record").map((candidate) => candidate.id);

    const first = await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: selected,
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: true,
        deleteUnusedReviewItems: false,
      },
    });

    const second = await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: selected,
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: true,
        deleteUnusedReviewItems: false,
      },
    });

    expect(second.deletedAssets).toEqual(first.deletedAssets);
    expect(second.analysisToken).toBe(first.analysisToken);
  });

  it("stale analysis is rejected on apply", async () => {
    const project = makeProject();
    project.assets = [makeAsset("asset_unused")];
    const harness = await makeHarness(project);

    const analysis = await harness.cleanupService.analyzeProjectCleanup();

    // Change project after analysis to make fingerprint stale.
    const updated = harness.projectService.getProject();
    updated.tags = [...updated.tags, { name: "New.Tag", dataType: "REAL", sourceType: "simulated" }];
    await harness.projectService.saveProject(updated);

    await expect(harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: [],
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: true,
        deleteUnusedReviewItems: false,
      },
    })).rejects.toThrow(/stale/i);
  });

  it("removes selected orphan file on apply", async () => {
    const project = makeProject();
    const harness = await makeHarness(project);
    const orphanPath = path.join(harness.root, "projects", "assets", "orphan-delete.png");
    await writeFile(orphanPath, PNG_BYTES);

    const analysis = await harness.cleanupService.analyzeProjectCleanup(undefined, { orphanFileMinAgeMs: 0 });
    const orphan = analysis.candidates.find((candidate) => candidate.type === "orphan-physical-file" && candidate.path === "assets/orphan-delete.png");
    expect(orphan).toBeTruthy();

    await harness.cleanupService.applyProjectCleanup({
      analysisToken: analysis.analysisToken,
      analysisFingerprint: analysis.analysisFingerprint,
      selectedCandidateIds: [orphan!.id],
      options: {
        createBackup: false,
        rewriteDuplicateReferences: true,
        deleteOrphanFiles: true,
        deleteUnusedReviewItems: false,
      },
    });

    await expect(readFile(orphanPath)).rejects.toThrow();
  });
});
