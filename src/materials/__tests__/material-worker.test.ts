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
