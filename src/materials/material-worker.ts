import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  StaleGenerationError,
  type MaterialClaim,
  type MaterialCompletionUpload,
} from "../api/job-hunter-client.js";
import {
  generationInputSchema,
  type GenerationInput,
  type GenerationOutput,
  type MaterialKind,
} from "./contracts.js";
import type { RenderedCv } from "./renderer.js";
import {
  validateGeneration,
  type ValidationFinding,
  type ValidationResult,
} from "./validator.js";

export interface MaterialWorkerConfig {
  workerId: string;
  workRoot: string;
  pollIntervalMs: number;
  leaseHeartbeatMs: number;
  baseDocxPath: string;
  basePdfPath: string;
  profileManifestPath: string;
  candidateProfilePath: string;
  factCatalogPath: string;
  writingStylePath: string;
}

export interface MaterialWorkerClient {
  importMaterialProfile(profile: {
    manifest: Uint8Array;
    candidateProfile: Uint8Array;
    factCatalog: Uint8Array;
    writingStyle: Uint8Array;
    baseCvDocx: Uint8Array;
    baseCvPdf: Uint8Array;
  }): Promise<void>;
  claimMaterial(workerId: string): Promise<MaterialClaim | null>;
  heartbeatMaterial(requestId: string, leaseToken: string): Promise<string>;
  failMaterial(
    requestId: string,
    leaseToken: string,
    reasonCode: string,
    retryable: boolean,
  ): Promise<void>;
  completeMaterial(
    claim: Pick<MaterialClaim, "requestId" | "leaseToken">,
    completion: MaterialCompletionUpload,
  ): Promise<{ revisionId: string; revisionNumber: number }>;
}

export interface MaterialOutputGenerator {
  generate(
    request: {
      input: GenerationInput;
      workdir: string;
      model: "gpt-5.6-terra" | "gpt-5.6-sol";
      repairFindings?: string[];
    },
    signal?: AbortSignal,
  ): Promise<GenerationOutput>;
}

export interface CvRenderer {
  render(
    output: GenerationOutput,
    workdir: string,
    signal?: AbortSignal,
  ): Promise<RenderedCv>;
}

export class MaterialWorker {
  constructor(
    private readonly config: MaterialWorkerConfig,
    private readonly client: MaterialWorkerClient,
    private readonly generator: MaterialOutputGenerator,
    private readonly renderer: CvRenderer,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    await mkdir(this.config.workRoot, { recursive: true, mode: 0o700 });
    await this.importProfile();
    while (!signal.aborted) {
      const claim = await this.client.claimMaterial(this.config.workerId);
      if (claim === null) {
        await delay(this.config.pollIntervalMs, undefined, { signal }).catch(
          ignoreAbort,
        );
        continue;
      }
      await this.processClaim(claim, signal);
    }
  }

  async processClaim(
    claim: MaterialClaim,
    parentSignal?: AbortSignal,
  ): Promise<void> {
    const workdir = await mkdtemp(join(this.config.workRoot, "request-"));
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    parentSignal?.addEventListener("abort", abort, { once: true });
    const heartbeat = this.runLeaseHeartbeat(claim, controller);
    try {
      const completion = await this.compile(claim, workdir, controller.signal);
      if (controller.signal.aborted) throw new StaleGenerationError();
      await this.client.completeMaterial(claim, completion);
    } catch (error) {
      if (!(error instanceof StaleGenerationError)) {
        await this.client
          .failMaterial(
            claim.requestId,
            claim.leaseToken,
            reasonCode(error),
            retryable(error),
          )
          .catch(() => undefined);
      }
    } finally {
      controller.abort();
      await heartbeat;
      parentSignal?.removeEventListener("abort", abort);
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async compile(
    claim: MaterialClaim,
    workdir: string,
    signal: AbortSignal,
  ): Promise<MaterialCompletionUpload> {
    const input = toGenerationInput(claim);
    let output: GenerationOutput | null = null;
    let model: "gpt-5.6-terra" | "gpt-5.6-sol" =
      claim.route === "SOL_IMPROVE" ? "gpt-5.6-sol" : "gpt-5.6-terra";
    let validation: ValidationResult = {
      valid: false,
      findings: [hardPackage("OUTPUT_UNAVAILABLE")],
    };
    try {
      output = await this.generator.generate({ input, workdir, model }, signal);
      validation = validateGeneration(input, output);
    } catch {
      validation = {
        valid: false,
        findings: [hardPackage("OUTPUT_SCHEMA_INVALID")],
      };
    }

    if (
      claim.route === "TERRA" &&
      shouldRepair(validation, input) &&
      !signal.aborted
    ) {
      model = "gpt-5.6-sol";
      try {
        output = await this.generator.generate(
          {
            input,
            workdir,
            model,
            repairFindings: validation.findings.map(({ code }) => code),
          },
          signal,
        );
        validation = validateGeneration(input, output);
      } catch {
        output = null;
        validation = {
          valid: false,
          findings: [hardPackage("SOL_REPAIR_FAILED")],
        };
      }
    }

    const coverLetter = output?.coverLetter;
    const recruiterMessage = output?.recruiterMessage;
    const requestedCoverFailed =
      input.requestedKinds.includes("COVER_LETTER") &&
      (!coverLetter || hasHard(validation, "COVER_LETTER"));
    const requestedRecruiterMessageFailed =
      input.requestedKinds.includes("RECRUITER_MESSAGE") &&
      (!recruiterMessage || hasHard(validation, "RECRUITER_MESSAGE"));
    const wantsCv = input.requestedKinds.includes("CV_DOCX");
    let rendered: RenderedCv | undefined;
    let fallback = false;
    if (wantsCv) {
      if (output === null || hasHard(validation, "CV")) {
        fallback = true;
        rendered = await this.baseCv();
      } else {
        try {
          rendered = await this.renderer.render(output, workdir, signal);
        } catch {
          fallback = true;
          rendered = await this.baseCv();
          validation = {
            valid: false,
            findings: [...validation.findings, hardPackage("CV_RENDER_FAILED")],
          };
        }
      }
    }

    const artifacts: Partial<Record<MaterialKind, Uint8Array>> = {};
    if (rendered !== undefined) {
      artifacts.CV_DOCX = rendered.docx;
      artifacts.CV_PDF = rendered.pdf;
    }
    if (
      input.requestedKinds.includes("COVER_LETTER") &&
      coverLetter !== undefined &&
      coverLetter !== null &&
      !hasHard(validation, "COVER_LETTER")
    )
      artifacts.COVER_LETTER = Buffer.from(coverLetter.text, "utf8");
    if (
      input.requestedKinds.includes("RECRUITER_MESSAGE") &&
      recruiterMessage !== undefined &&
      recruiterMessage !== null &&
      !hasHard(validation, "RECRUITER_MESSAGE")
    )
      artifacts.RECRUITER_MESSAGE = Buffer.from(recruiterMessage.text, "utf8");

    const status =
      requestedCoverFailed || requestedRecruiterMessageFailed
        ? "BLOCKED"
        : fallback || hasRelevantHard(validation, input)
          ? "READY_WITH_FALLBACK"
          : "READY";
    return {
      status,
      origin: fallback ? "BASE_FALLBACK" : "GENERATED",
      generatorModel: model,
      rendererVersion: "cv-materials/0.1.0",
      manifest: {
        ...(rendered?.manifest ?? { artifacts: [] }),
        schemaVersion: "application-materials/v1",
        generatorModel: model,
        validationFindings: validation.findings,
      },
      artifacts,
      artifactSha256: Object.fromEntries(
        Object.entries(artifacts).map(([kind, content]) => [
          kind,
          sha256(content),
        ]),
      ),
    };
  }

  private async baseCv(): Promise<RenderedCv> {
    const [docx, pdf] = await Promise.all([
      readFile(this.config.baseDocxPath),
      readFile(this.config.basePdfPath),
    ]);
    return {
      docx,
      pdf,
      manifest: {
        baseFallback: true,
        artifacts: [
          { kind: "CV_DOCX", sha256: sha256(docx) },
          { kind: "CV_PDF", sha256: sha256(pdf) },
        ],
      },
    };
  }

  private async importProfile(): Promise<void> {
    const [
      manifest,
      candidateProfile,
      factCatalog,
      writingStyle,
      baseCvDocx,
      baseCvPdf,
    ] = await Promise.all([
      readFile(this.config.profileManifestPath),
      readFile(this.config.candidateProfilePath),
      readFile(this.config.factCatalogPath),
      readFile(this.config.writingStylePath),
      readFile(this.config.baseDocxPath),
      readFile(this.config.basePdfPath),
    ]);
    await this.client.importMaterialProfile({
      manifest,
      candidateProfile,
      factCatalog,
      writingStyle,
      baseCvDocx,
      baseCvPdf,
    });
  }

  private async runLeaseHeartbeat(
    claim: MaterialClaim,
    controller: AbortController,
  ): Promise<void> {
    while (!controller.signal.aborted) {
      const elapsed = await delay(this.config.leaseHeartbeatMs, undefined, {
        signal: controller.signal,
      })
        .then(() => true)
        .catch((error: unknown) => {
          ignoreAbort(error);
          return false;
        });
      if (!elapsed) return;
      try {
        await this.client.heartbeatMaterial(claim.requestId, claim.leaseToken);
      } catch {
        controller.abort();
      }
    }
  }
}

function toGenerationInput(claim: MaterialClaim): GenerationInput {
  const vacancy = claim.vacancy;
  return generationInputSchema.parse({
    schemaVersion: "application-materials/v1",
    requestId: claim.requestId,
    vacancy: {
      title: vacancy.title,
      company: vacancy.company ?? null,
      description: vacancy.description,
      source: vacancy.source,
      ...(typeof vacancy.url === "string" ? { url: vacancy.url } : {}),
    },
    candidateProfile: claim.candidateProfile,
    factCatalog: claim.factCatalog,
    writingStyle: claim.writingStyle,
    requestedKinds: claim.requestedKinds,
    coverLetterPolicy: claim.coverLetterPolicy,
    mode: claim.mode,
  });
}

function shouldRepair(
  validation: ValidationResult,
  input: GenerationInput,
): boolean {
  return validation.findings.some(
    ({ artifact, severity }) =>
      severity === "HARD" &&
      ((artifact === "CV" && input.requestedKinds.includes("CV_DOCX")) ||
        artifact === "PACKAGE" ||
        (artifact === "COVER_LETTER" &&
          input.requestedKinds.includes("COVER_LETTER")) ||
        (artifact === "RECRUITER_MESSAGE" &&
          input.requestedKinds.includes("RECRUITER_MESSAGE"))),
  );
}

function hasRelevantHard(
  validation: ValidationResult,
  input: GenerationInput,
): boolean {
  return validation.findings.some(
    ({ artifact, severity }) =>
      severity === "HARD" &&
      (artifact === "PACKAGE" ||
        (artifact === "CV" && input.requestedKinds.includes("CV_DOCX")) ||
        (artifact === "COVER_LETTER" &&
          input.requestedKinds.includes("COVER_LETTER")) ||
        (artifact === "RECRUITER_MESSAGE" &&
          input.requestedKinds.includes("RECRUITER_MESSAGE"))),
  );
}

function hasHard(
  validation: ValidationResult,
  artifact: ValidationFinding["artifact"],
): boolean {
  return validation.findings.some(
    (finding) => finding.artifact === artifact && finding.severity === "HARD",
  );
}

function hardPackage(code: string): ValidationFinding {
  return { code, artifact: "PACKAGE", severity: "HARD" };
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function reasonCode(error: unknown): string {
  if (error instanceof StaleGenerationError) return "LEASE_LOST";
  if (error instanceof Error && error.name === "AbortError")
    return "WORKER_ABORTED";
  return "MATERIAL_COMPILATION_FAILED";
}

function retryable(error: unknown): boolean {
  return !(error instanceof SyntaxError);
}

function ignoreAbort(error: unknown): void {
  if (!(error instanceof Error) || error.name !== "AbortError") throw error;
}
