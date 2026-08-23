import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MaterialClaim } from "../../api/job-hunter-client.js";
import {
  MaterialWorker,
  type CvRenderer,
  type MaterialOutputGenerator,
  type MaterialWorkerClient,
} from "../material-worker.js";
import { validGenerationInput, validGenerationOutput } from "./fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("MaterialWorker", () => {
  it("imports the profile bundle before polling for work", async () => {
    const workRoot = await mkdtemp(
      join(tmpdir(), "materials-worker-bootstrap-test-"),
    );
    directories.push(workRoot);
    const paths = {
      profileManifestPath: join(workRoot, "manifest.json"),
      candidateProfilePath: join(workRoot, "candidate-profile.json"),
      factCatalogPath: join(workRoot, "fact-catalog.json"),
      writingStylePath: join(workRoot, "writing-style.json"),
      baseDocxPath: join(workRoot, "base.docx"),
      basePdfPath: join(workRoot, "base.pdf"),
    };
    await Promise.all(
      Object.values(paths).map((path) =>
        writeFile(path, path.split("/").at(-1) ?? "file"),
      ),
    );
    const controller = new AbortController();
    const importMaterialProfile = vi.fn<
      MaterialWorkerClient["importMaterialProfile"]
    >(() => Promise.resolve());
    const claimMaterial = vi.fn<MaterialWorkerClient["claimMaterial"]>(() => {
      controller.abort();
      return Promise.resolve(null);
    });
    const client: MaterialWorkerClient = {
      importMaterialProfile,
      claimMaterial,
      heartbeatMaterial: vi.fn(() => Promise.resolve(new Date().toISOString())),
      failMaterial: vi.fn(() => Promise.resolve()),
      completeMaterial: vi.fn(),
    };
    const worker = new MaterialWorker(
      {
        workerId: "test-worker",
        workRoot,
        pollIntervalMs: 10,
        leaseHeartbeatMs: 60_000,
        ...paths,
      },
      client,
      { generate: vi.fn() },
      { render: vi.fn() },
    );

    await worker.run(controller.signal);

    expect(importMaterialProfile).toHaveBeenCalledOnce();
    expect(importMaterialProfile.mock.invocationCallOrder[0]).toBeLessThan(
      claimMaterial.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("compiles, uploads, and wipes a successful request workspace", async () => {
    const workRoot = await mkdtemp(join(tmpdir(), "materials-worker-test-"));
    directories.push(workRoot);
    const baseDocxPath = join(workRoot, "base.docx");
    const basePdfPath = join(workRoot, "base.pdf");
    await Promise.all([
      writeFile(baseDocxPath, "base-docx"),
      writeFile(basePdfPath, "base-pdf"),
    ]);
    const completeMaterial = vi.fn<MaterialWorkerClient["completeMaterial"]>(
      () =>
        Promise.resolve({
          revisionId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce2f",
          revisionNumber: 1,
        }),
    );
    const client: MaterialWorkerClient = {
      importMaterialProfile: vi.fn(() => Promise.resolve()),
      claimMaterial: vi.fn(() => Promise.resolve(null)),
      heartbeatMaterial: vi.fn(() => Promise.resolve(new Date().toISOString())),
      failMaterial: vi.fn(() => Promise.resolve()),
      completeMaterial,
    };
    const generator: MaterialOutputGenerator = {
      generate: vi.fn(() => Promise.resolve(validGenerationOutput())),
    };
    const renderer: CvRenderer = {
      render: vi.fn(() =>
        Promise.resolve({
          docx: Buffer.from("tailored-docx"),
          pdf: Buffer.from("tailored-pdf"),
          manifest: { pageCount: 2 },
        }),
      ),
    };
    const worker = new MaterialWorker(
      {
        workerId: "test-worker",
        workRoot,
        pollIntervalMs: 10,
        leaseHeartbeatMs: 60_000,
        baseDocxPath,
        basePdfPath,
        profileManifestPath: baseDocxPath,
        candidateProfilePath: baseDocxPath,
        factCatalogPath: baseDocxPath,
        writingStylePath: baseDocxPath,
      },
      client,
      generator,
      renderer,
    );

    await worker.processClaim(materialClaim());

    expect(completeMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: materialClaim().requestId }),
      expect.objectContaining({
        status: "READY",
        origin: "GENERATED",
        generatorModel: "gpt-5.6-terra",
      }),
    );
    expect(await readdir(workRoot)).toEqual(["base.docx", "base.pdf"]);
  });

  it("uploads only the requested cover letter without rendering a CV", async () => {
    const workRoot = await mkdtemp(
      join(tmpdir(), "materials-worker-cover-test-"),
    );
    directories.push(workRoot);
    const baseDocxPath = join(workRoot, "base.docx");
    const basePdfPath = join(workRoot, "base.pdf");
    await Promise.all([
      writeFile(baseDocxPath, "base-docx"),
      writeFile(basePdfPath, "base-pdf"),
    ]);
    const completeMaterial = vi.fn<MaterialWorkerClient["completeMaterial"]>(
      () =>
        Promise.resolve({
          revisionId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce2f",
          revisionNumber: 2,
        }),
    );
    const client: MaterialWorkerClient = {
      importMaterialProfile: vi.fn(() => Promise.resolve()),
      claimMaterial: vi.fn(() => Promise.resolve(null)),
      heartbeatMaterial: vi.fn(() => Promise.resolve(new Date().toISOString())),
      failMaterial: vi.fn(() => Promise.resolve()),
      completeMaterial,
    };
    const output = validGenerationOutput();
    output.summaryVariantIds = [];
    output.qualificationIds = [];
    output.experience = [];
    output.recruiterMessage = null;
    const render = vi.fn<CvRenderer["render"]>();
    const renderer: CvRenderer = { render };
    const worker = new MaterialWorker(
      {
        workerId: "test-worker",
        workRoot,
        pollIntervalMs: 10,
        leaseHeartbeatMs: 60_000,
        baseDocxPath,
        basePdfPath,
        profileManifestPath: baseDocxPath,
        candidateProfilePath: baseDocxPath,
        factCatalogPath: baseDocxPath,
        writingStylePath: baseDocxPath,
      },
      client,
      { generate: vi.fn(() => Promise.resolve(output)) },
      renderer,
    );

    await worker.processClaim({
      ...materialClaim(),
      requestedKinds: ["COVER_LETTER"],
    });

    expect(render).not.toHaveBeenCalled();
    expect(completeMaterial).toHaveBeenCalledOnce();
    const completion = completeMaterial.mock.calls[0]?.[1];
    expect(completion?.status).toBe("READY");
    expect(Object.keys(completion?.artifacts ?? {})).toEqual(["COVER_LETTER"]);
    expect(completion?.artifacts.COVER_LETTER).toBeInstanceOf(Uint8Array);
  });

  it("does not invoke Sol automatically when Terra output fails validation", async () => {
    const workRoot = await mkdtemp(
      join(tmpdir(), "materials-worker-no-auto-sol-test-"),
    );
    directories.push(workRoot);
    const baseDocxPath = join(workRoot, "base.docx");
    const basePdfPath = join(workRoot, "base.pdf");
    await Promise.all([
      writeFile(baseDocxPath, "base-docx"),
      writeFile(basePdfPath, "base-pdf"),
    ]);
    const completeMaterial = vi.fn<MaterialWorkerClient["completeMaterial"]>(
      () =>
        Promise.resolve({
          revisionId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce2f",
          revisionNumber: 2,
        }),
    );
    const client: MaterialWorkerClient = {
      importMaterialProfile: vi.fn(() => Promise.resolve()),
      claimMaterial: vi.fn(() => Promise.resolve(null)),
      heartbeatMaterial: vi.fn(() => Promise.resolve(new Date().toISOString())),
      failMaterial: vi.fn(() => Promise.resolve()),
      completeMaterial,
    };
    const output = validGenerationOutput();
    output.summaryVariantIds = [];
    output.qualificationIds = [];
    output.experience = [];
    output.recruiterMessage = null;
    if (output.coverLetter === null) throw new Error("Fixture is incomplete");
    output.coverLetter.text = "Too short";
    const generate = vi.fn<MaterialOutputGenerator["generate"]>(() =>
      Promise.resolve(output),
    );
    const worker = new MaterialWorker(
      {
        workerId: "test-worker",
        workRoot,
        pollIntervalMs: 10,
        leaseHeartbeatMs: 60_000,
        baseDocxPath,
        basePdfPath,
        profileManifestPath: baseDocxPath,
        candidateProfilePath: baseDocxPath,
        factCatalogPath: baseDocxPath,
        writingStylePath: baseDocxPath,
      },
      client,
      { generate },
      { render: vi.fn() },
    );

    await worker.processClaim({
      ...materialClaim(),
      requestedKinds: ["COVER_LETTER"],
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-terra" }),
      expect.any(AbortSignal),
    );
    expect(completeMaterial.mock.calls[0]?.[1].status).toBe("BLOCKED");
  });
});

function materialClaim(): MaterialClaim {
  const input = validGenerationInput();
  return {
    requestId: input.requestId,
    leaseToken: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce3f",
    leaseExpiresAt: "2026-08-20T18:00:00Z",
    vacancy: input.vacancy,
    candidateProfile: input.candidateProfile,
    factCatalog: input.factCatalog,
    writingStyle: input.writingStyle,
    requestedKinds: input.requestedKinds,
    coverLetterPolicy: input.coverLetterPolicy,
    mode: input.mode,
    route: "TERRA",
  };
}
