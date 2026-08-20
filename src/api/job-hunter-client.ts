import {
  AUTOMATION_STATES,
  type HeartbeatRequest,
  type HeartbeatResponse,
} from "../domain/health.js";
import {
  candidateProfileSchema,
  coverLetterPolicySchema,
  factCatalogSchema,
  materialKindSchema,
  writingStyleSchema,
  type CandidateProfile,
  type CoverLetterPolicy,
  type FactCatalog,
  type MaterialKind,
  type WritingStyle,
} from "../materials/contracts.js";
import type { TokenProvider } from "./token-provider.js";
import { z } from "zod";

export interface RunnerSession {
  runnerKey: string;
  generation: number;
  heartbeatIntervalSeconds: number;
  preflightIntervalSeconds: number;
  codexCanaryIntervalSeconds: number;
}

export interface MaterialClaim {
  requestId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  vacancy: Record<string, unknown>;
  candidateProfile: CandidateProfile;
  factCatalog: FactCatalog;
  writingStyle: WritingStyle;
  requestedKinds: MaterialKind[];
  coverLetterPolicy: CoverLetterPolicy;
  mode: "TERRA" | "SOL_IMPROVE" | "USER_EDIT_VALIDATION";
  route: "TERRA" | "SOL_IMPROVE";
}

export interface MaterialCompletionUpload {
  status: "READY" | "READY_WITH_FALLBACK" | "BLOCKED";
  origin: "GENERATED" | "USER_EDITED" | "BASE_FALLBACK";
  generatorModel?: string;
  rendererVersion: string;
  manifest: Record<string, unknown>;
  artifacts: Partial<Record<MaterialKind, Uint8Array>>;
  artifactSha256: Partial<Record<MaterialKind, string>>;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Job Hunter runner authentication failed");
    this.name = "UnauthorizedError";
  }
}

export class StaleGenerationError extends Error {
  constructor() {
    super("Job Hunter runner generation is stale");
    this.name = "StaleGenerationError";
  }
}

export class JobHunterClient {
  constructor(
    private readonly apiUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async startSession(): Promise<RunnerSession> {
    const response = await this.request("/automation/runner/session", {
      method: "POST",
    });
    const body: unknown = await response.json();
    if (!isRunnerSession(body))
      throw new Error("Runner session response is invalid");
    return body;
  }

  async sendHeartbeat(heartbeat: HeartbeatRequest): Promise<HeartbeatResponse> {
    const response = await this.request("/automation/runner/heartbeat", {
      method: "PUT",
      body: JSON.stringify(heartbeat),
    });
    const body: unknown = await response.json();
    if (!isHeartbeatResponse(body))
      throw new Error("Heartbeat response is invalid");
    return body;
  }

  async claimMaterial(workerId: string): Promise<MaterialClaim | null> {
    const response = await this.request("/automation/materials/claims", {
      method: "POST",
      body: JSON.stringify({ workerId }),
    });
    if (response.status === 204) return null;
    return materialClaimSchema.parse(await response.json());
  }

  async heartbeatMaterial(
    requestId: string,
    leaseToken: string,
  ): Promise<string> {
    const response = await this.request(
      `/automation/materials/${requestId}/heartbeat`,
      {
        method: "POST",
        body: JSON.stringify({ leaseToken }),
      },
    );
    return materialHeartbeatSchema.parse(await response.json()).leaseExpiresAt;
  }

  async failMaterial(
    requestId: string,
    leaseToken: string,
    reasonCode: string,
    retryable: boolean,
  ): Promise<void> {
    await this.request(`/automation/materials/${requestId}/fail`, {
      method: "POST",
      body: JSON.stringify({ leaseToken, reasonCode, retryable }),
    });
  }

  async completeMaterial(
    claim: Pick<MaterialClaim, "requestId" | "leaseToken">,
    completion: MaterialCompletionUpload,
  ): Promise<{ revisionId: string; revisionNumber: number }> {
    const form = new FormData();
    form.set(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            leaseToken: claim.leaseToken,
            status: completion.status,
            origin: completion.origin,
            generatorModel: completion.generatorModel,
            rendererVersion: completion.rendererVersion,
            manifest: completion.manifest,
            artifactSha256: completion.artifactSha256,
          }),
        ],
        { type: "application/json" },
      ),
      "metadata.json",
    );
    const names: Record<MaterialKind, string> = {
      CV_DOCX: "cvDocx",
      CV_PDF: "cvPdf",
      COVER_LETTER: "coverLetter",
      RECRUITER_MESSAGE: "recruiterMessage",
    };
    for (const [kind, content] of Object.entries(completion.artifacts)) {
      const materialKind = materialKindSchema.parse(kind);
      form.set(
        names[materialKind],
        new Blob([Uint8Array.from(content)], {
          type: mediaType(materialKind),
        }),
        filename(materialKind),
      );
    }
    const response = await this.request(
      `/automation/materials/${claim.requestId}/complete`,
      { method: "POST", body: form },
    );
    return materialCompletionResponseSchema.parse(await response.json());
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const token = await this.tokenProvider.getAccessToken();
    const response = await this.fetchImplementation(
      `${this.apiUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(init.body === undefined || init.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
        },
      },
    );
    if (response.status === 401) {
      this.tokenProvider.invalidate();
      throw new UnauthorizedError();
    }
    if (response.status === 409) throw new StaleGenerationError();
    if (!response.ok)
      throw new Error(
        `Job Hunter API request failed with status ${String(response.status)}`,
      );
    return response;
  }
}

const materialClaimSchema = z
  .object({
    requestId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    leaseExpiresAt: z.string().datetime({ offset: true }),
    vacancy: z.record(z.unknown()),
    candidateProfile: candidateProfileSchema,
    factCatalog: factCatalogSchema,
    writingStyle: writingStyleSchema,
    requestedKinds: z.array(materialKindSchema),
    coverLetterPolicy: coverLetterPolicySchema,
    mode: z.enum(["TERRA", "SOL_IMPROVE", "USER_EDIT_VALIDATION"]),
    route: z.enum(["TERRA", "SOL_IMPROVE"]),
  })
  .strict();

const materialHeartbeatSchema = z
  .object({ leaseExpiresAt: z.string().datetime({ offset: true }) })
  .strict();

const materialCompletionResponseSchema = z
  .object({
    revisionId: z.string().uuid(),
    revisionNumber: z.number().int().positive(),
  })
  .strict();

function mediaType(kind: MaterialKind): string {
  if (kind === "CV_PDF") return "application/pdf";
  if (kind === "CV_DOCX")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "text/plain";
}

function filename(kind: MaterialKind): string {
  return {
    CV_DOCX: "cv.docx",
    CV_PDF: "cv.pdf",
    COVER_LETTER: "cover-letter.txt",
    RECRUITER_MESSAGE: "recruiter-message.txt",
  }[kind];
}

function isRunnerSession(value: unknown): value is RunnerSession {
  if (!isRecord(value)) return false;
  return (
    typeof value.runnerKey === "string" &&
    isPositiveInteger(value.generation) &&
    isPositiveInteger(value.heartbeatIntervalSeconds) &&
    isPositiveInteger(value.preflightIntervalSeconds) &&
    isPositiveInteger(value.codexCanaryIntervalSeconds)
  );
}

function isHeartbeatResponse(value: unknown): value is HeartbeatResponse {
  if (!isRecord(value)) return false;
  return (
    isPositiveInteger(value.generation) &&
    isPositiveInteger(value.acceptedSequence) &&
    typeof value.state === "string" &&
    AUTOMATION_STATES.some((state) => state === value.state)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
