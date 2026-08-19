import {
  AUTOMATION_STATES,
  type HeartbeatRequest,
  type HeartbeatResponse,
} from "../domain/health.js";
import type { TokenProvider } from "./token-provider.js";

export interface RunnerSession {
  runnerKey: string;
  generation: number;
  heartbeatIntervalSeconds: number;
  preflightIntervalSeconds: number;
  codexCanaryIntervalSeconds: number;
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

  private async request(path: string, init: RequestInit): Promise<Response> {
    const token = await this.tokenProvider.getAccessToken();
    const response = await this.fetchImplementation(
      `${this.apiUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(init.body === undefined
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
