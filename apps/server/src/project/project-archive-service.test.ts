import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, ElementLibrary, HmiScreen, MacroDefinition, ScadaProject } from "@web-scada/shared";
import { EventSoundService } from "../events/event-sound-service.js";
import { LibraryService } from "../libraries/library-service.js";
import { ProjectArchiveService } from "./project-archive-service.js";
import { ProjectService } from "./project-service.js";

const roots: string[] = [];
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const ORIGINAL_ARCHIVE_SECRET = process.env.PROJECT_ARCHIVE_SECRET;

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
  if (ORIGINAL_ARCHIVE_SECRET === undefined) {
    delete process.env.PROJECT_ARCHIVE_SECRET;
  } else {
    process.env.PROJECT_ARCHIVE_SECRET = ORIGINAL_ARCHIVE_SECRET;
  }
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeLibrary(id = "lib1", assetId = "lib-asset", elementId = "element1"): ElementLibrary {
  return {
    id,
    name: id,
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [{ ...makeAsset(assetId), storagePath: `assets/${assetId}.png`, previewUrl: `/api/libraries/${id}/assets/${assetId}/file` }],
    elements: [{
      id: elementId,
      libraryId: id,
      name: elementId,
      width: 100,
      height: 100,
      objects: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    macros: [],
  };
}

async function writeLibrary(root: string, library: ElementLibrary, assetBytes = PNG_BYTES): Promise<void> {
  const dir = path.join(root, "libraries", library.id);
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "library.json"), JSON.stringify(library, null, 2), "utf8");
  for (const asset of library.assets) {
    await writeFile(path.join(dir, asset.storagePath), assetBytes);
  }
}

function makeMacro(id: string, code: string): MacroDefinition {
  return {
    id,
    name: id,
    language: "javascript-lite",
    code,
    enabled: true,
  };
}

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

  it("exports and validates a valid HMAC signature when PROJECT_ARCHIVE_SECRET is set", async () => {
    process.env.PROJECT_ARCHIVE_SECRET = "test-secret";
    const harness = await makeHarness(makeProject("Signed Project"));
    const exported = await harness.service.exportProjectArchive();
    const zip = new AdmZip(exported.buffer);

    const result = await harness.service.validateProjectArchive(upload(exported.buffer), { requireSignature: true });

    expect(zip.getEntry("signature.json")).toBeTruthy();
    expect(result.valid).toBe(true);
    expect(result.authenticity).toMatchObject({ signed: true, verified: true, required: true });
  });

  it("rejects a signed archive when manifest is changed after export", async () => {
    process.env.PROJECT_ARCHIVE_SECRET = "test-secret";
    const harness = await makeHarness(makeProject("Tamper Project"));
    const exported = await harness.service.exportProjectArchive();
    const zip = new AdmZip(exported.buffer);
    const projectBytes = Buffer.from(JSON.stringify({ ...makeProject("Tampered Project"), name: "Tampered Project" }, null, 2), "utf8");
    zip.updateFile("project.json", projectBytes);
    const manifest = JSON.parse(zip.readAsText("manifest.json")) as { files: Array<{ path: string; size: number; sha256: string }> };
    const projectEntry = manifest.files.find((item) => item.path === "project.json")!;
    projectEntry.size = projectBytes.byteLength;
    projectEntry.sha256 = "0".repeat(64);
    zip.updateFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

    const result = await harness.service.validateProjectArchive(upload(zip.toBuffer() as Buffer), { requireSignature: true });

    expect(result.valid).toBe(false);
    expect(result.authenticity).toMatchObject({ signed: true, verified: false, required: true });
    expect(result.errors.some((issue) => issue.code === "ARCHIVE_SIGNATURE_MISMATCH")).toBe(true);
  });

  it("warns or rejects unsigned archives depending on signature requirement", async () => {
    delete process.env.PROJECT_ARCHIVE_SECRET;
    const harness = await makeHarness(makeProject("Unsigned Project"));
    const exported = await harness.service.exportProjectArchive();

    const warningOnly = await harness.service.validateProjectArchive(upload(exported.buffer));
    const rejected = await harness.service.validateProjectArchive(upload(exported.buffer), { requireSignature: true });

    expect(warningOnly.valid).toBe(true);
    expect(warningOnly.warnings.some((issue) => issue.code === "ARCHIVE_NOT_SIGNED")).toBe(true);
    expect(rejected.valid).toBe(false);
    expect(rejected.authenticity).toMatchObject({ signed: false, verified: false, required: true });
    expect(rejected.errors.some((issue) => issue.code === "ARCHIVE_NOT_SIGNED")).toBe(true);
  });

  it("rejects unsigned archives by default when PROJECT_ARCHIVE_SECRET is set", async () => {
    delete process.env.PROJECT_ARCHIVE_SECRET;
    const source = await makeHarness(makeProject("Unsigned Source"));
    const exported = await source.service.exportProjectArchive();
    const target = await makeHarness(makeProject("Signed Target"));
    process.env.PROJECT_ARCHIVE_SECRET = "test-secret";

    const validation = await target.service.validateProjectArchive(upload(exported.buffer));

    expect(validation.valid).toBe(false);
    expect(validation.authenticity).toMatchObject({ signed: false, verified: false, required: true });
    expect(validation.errors.some((issue) => issue.code === "ARCHIVE_NOT_SIGNED")).toBe(true);
    await expect(target.service.importProjectArchive(upload(exported.buffer), { mode: "replace-current" })).rejects.toThrow(/signature\.json/);
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

  it("rejects duplicate archive entries", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from("{}", "utf8"));
    zip.addFile("manifest.json", Buffer.from("{}", "utf8"));
    const harness = await makeHarness(makeProject("Duplicate Project"));

    const result = await harness.service.validateProjectArchive(upload(zip.toBuffer() as Buffer));

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "DUPLICATE_PATH" || issue.code === "INVALID_MANIFEST")).toBe(true);
  });

  it("fails project export when a referenced asset file is missing", async () => {
    const harness = await makeHarness(makeProject("Missing Local Asset"));
    await unlink(path.join(harness.root, "projects", "assets", "asset1.png"));

    await expect(harness.service.exportProjectArchive()).rejects.toThrow(/referenced file is missing/);
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

  it("rolls back project import when final restore fails after backup", async () => {
    const source = await makeHarness(makeProject("Source Project", "source", "asset1"), Buffer.from("source-image"));
    const target = await makeHarness(makeProject("Target Project", "target", "asset1"), Buffer.from("target-image"));
    const exported = await source.service.exportProjectArchive();
    vi.spyOn(target.service as unknown as { swapStagedProjectImport: () => Promise<void> }, "swapStagedProjectImport").mockRejectedValueOnce(new Error("simulated restore failure"));

    await expect(target.service.importProjectArchive(upload(exported.buffer), { mode: "replace-current" })).rejects.toThrow(/backup was created/);

    await target.projectService.loadProject();
    expect(target.projectService.getProject().name).toBe("Target Project");
    expect((await readFile(path.join(target.root, "projects", "assets", "asset1.png"))).toString()).toBe("target-image");
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

  it("inspects a full project archive and lists resources", async () => {
    const sourceProject = makeProject("Inspectable Project", "main", "asset1");
    sourceProject.macros = [makeMacro("macro1", "writeTag('Tank.Level', 42)")];
    const harness = await makeHarness(sourceProject);
    const exported = await harness.service.exportProjectArchive();

    const result = await harness.service.inspectUploadedArchive(upload(exported.buffer));

    expect(result.valid).toBe(true);
    expect(result.archiveType).toBe("project");
    expect(result.screens.map((screen) => screen.id)).toEqual(["main"]);
    expect(result.assets.map((asset) => asset.id)).toEqual(["asset1"]);
    expect(result.macros.map((macro) => macro.id)).toEqual(["macro1"]);
  });

  it("imports one screen from a full project archive", async () => {
    const sourceProject = makeProject("Source Project", "main", "asset1");
    sourceProject.screens.push(makeScreen("details", "asset1"));
    const source = await makeHarness(sourceProject, Buffer.from("source-image"));
    const target = await makeHarness(makeProject("Target Project", "target", "asset2"), Buffer.from("target-image"));
    const exported = await source.service.exportProjectArchive();

    const result = await target.service.importScreenFromProjectArchive(upload(exported.buffer), {
      screenIds: ["details"],
      mode: "add",
      dependencyMode: "minimal",
    });

    expect(result.ok).toBe(true);
    expect(result.importedScreenName).toBe("details");
    expect(result.project.screens.some((screen) => screen.id === "details")).toBe(true);
    expect(result.project.screens.some((screen) => screen.id === "main")).toBe(false);
  });

  it("imports a conflicting library as a copy and rewrites screen references", async () => {
    const sourceProject = makeProject("Source Project", "main", "asset1");
    sourceProject.libraries = [{ libraryId: "lib1", name: "lib1", version: "1.0.0", enabled: true }];
    sourceProject.screens[0]!.objects = [{
      id: "lib-object",
      type: "libraryElementInstance",
      name: "Library Object",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      libraryId: "lib1",
      elementId: "element1",
    }];
    const targetProject = makeProject("Target Project", "main", "asset1");
    targetProject.libraries = [{ libraryId: "lib1", name: "lib1", version: "2.0.0", enabled: true }];
    const source = await makeHarness(sourceProject);
    const target = await makeHarness(targetProject);
    await writeLibrary(source.root, makeLibrary("lib1", "lib-asset", "element1"), Buffer.from("source-library-asset"));
    await writeLibrary(target.root, { ...makeLibrary("lib1", "lib-asset", "element1"), version: "2.0.0", name: "different" }, Buffer.from("target-library-asset"));
    const exportedScreen = await source.service.exportScreenArchive("main", { dependencyMode: "minimal" });

    const result = await target.service.importScreenArchive(upload(exportedScreen.buffer), { mode: "add" });

    expect(result.copiedLibraries).toBe(1);
    expect(result.warnings.some((issue) => issue.code === "LIBRARY_IMPORTED_AS_COPY")).toBe(true);
    const importedScreen = result.project.screens.find((screen) => screen.id === result.screenId)!;
    const importedObject = importedScreen.objects[0] as Extract<HmiScreen["objects"][number], { type: "libraryElementInstance" }>;
    expect(importedObject.libraryId).not.toBe("lib1");
    expect(result.project.libraries?.some((ref) => ref.libraryId === importedObject.libraryId)).toBe(true);
  });

  it("imports conflicting macros as copies and rewrites screen macro references", async () => {
    const sourceProject = makeProject("Source Project", "main", "asset1");
    sourceProject.macros = [makeMacro("macro1", "writeTag('Tank.Level', 42)")];
    sourceProject.screens[0]!.objects = [{
      id: "button1",
      type: "button",
      name: "Button 1",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      textStyle: { fontFamily: "Arial", fontSize: 14, color: "#fff", horizontalAlign: "center", verticalAlign: "middle" },
      action: { type: "runMacro", macroId: "macro1" },
    }];
    const targetProject = makeProject("Target Project", "main", "asset1");
    targetProject.macros = [makeMacro("macro1", "writeTag('Tank.Level', 1)")];
    const source = await makeHarness(sourceProject);
    const target = await makeHarness(targetProject);
    const exportedScreen = await source.service.exportScreenArchive("main", { dependencyMode: "minimal" });

    const result = await target.service.importScreenArchive(upload(exportedScreen.buffer), { mode: "add" });

    const importedScreen = result.project.screens.find((screen) => screen.id === result.screenId)!;
    const importedObject = importedScreen.objects[0] as Extract<HmiScreen["objects"][number], { type: "button" }>;
    expect(importedObject.action?.type).toBe("runMacro");
    if (importedObject.action?.type === "runMacro") {
      expect(importedObject.action.macroId).not.toBe("macro1");
    }
    expect(result.project.macros ?? []).toHaveLength(2);
    expect(result.warnings.some((issue) => issue.code === "MACRO_IMPORTED_AS_COPY")).toBe(true);
  });

  it("reports statically detectable missing asset and library references", async () => {
    const project = makeProject("Broken Refs");
    project.assets = [];
    project.libraries = [{ libraryId: "lib1", name: "lib1", version: "1.0.0", enabled: true }];
    project.screens[0]!.objects = [
      {
        id: "image1",
        type: "image",
        name: "Image 1",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        assetId: "missing-asset",
        fit: "contain",
      },
      {
        id: "lib-object",
        type: "libraryElementInstance",
        name: "Library Object",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        libraryId: "lib1",
        elementId: "missing-element",
      },
    ];
    const harness = await makeHarness(project);
    await writeLibrary(harness.root, makeLibrary("lib1", "lib-asset", "element1"));
    const zip = new AdmZip();
    const projectBytes = Buffer.from(JSON.stringify(project, null, 2), "utf8");
    const library = makeLibrary("lib1", "lib-asset", "element1");
    const libraryBytes = Buffer.from(JSON.stringify(library, null, 2), "utf8");
    const libAssetBytes = PNG_BYTES;
    zip.addFile("project.json", projectBytes);
    zip.addFile("libraries/lib1/library.json", libraryBytes);
    zip.addFile("libraries/lib1/assets/lib-asset.png", libAssetBytes);
    const manifest = {
      format: "mywebscada-project",
      formatVersion: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      projectName: project.name,
      counts: { screens: 1, tags: 1, assets: 0, libraries: 1, events: 0, macros: 0, variables: 0 },
      files: [
        { path: "project.json", type: "project", size: projectBytes.byteLength, sha256: "0".repeat(64) },
        { path: "libraries/lib1/library.json", type: "library", size: libraryBytes.byteLength, sha256: "0".repeat(64) },
        { path: "libraries/lib1/assets/lib-asset.png", type: "libraryAsset", size: libAssetBytes.byteLength, sha256: "0".repeat(64) },
      ],
    };
    for (const item of manifest.files) {
      item.sha256 = item.path === "project.json" ? "pending" : item.path === "libraries/lib1/library.json" ? "pending" : "pending";
    }
    manifest.files[0]!.sha256 = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(projectBytes).digest("hex"));
    manifest.files[1]!.sha256 = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(libraryBytes).digest("hex"));
    manifest.files[2]!.sha256 = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(libAssetBytes).digest("hex"));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

    const result = await harness.service.validateProjectArchive(upload(zip.toBuffer() as Buffer));

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "BROKEN_ASSET_REFERENCE")).toBe(true);
    expect(result.errors.some((issue) => issue.code === "BROKEN_LIBRARY_ELEMENT_REFERENCE")).toBe(true);
  });
});
