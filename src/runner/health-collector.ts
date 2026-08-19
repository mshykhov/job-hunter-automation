import type { RunnerSession } from "../api/job-hunter-client.js";
import type { CodexCanarySummary } from "../codex/jsonl-parser.js";
import type {
  AutomationComponent,
  ComponentSnapshot,
  HeartbeatDraft,
  ProbeSnapshot,
} from "../domain/health.js";
import { AUTOMATION_RUNTIME_VERSION } from "../index.js";
import type { PreflightResult } from "../probes/preflight.js";

export interface RuntimeHealthDependencies {
  getToken(): Promise<string>;
  runPreflight(
    token: string,
    previous?: ProbeSnapshot,
    signal?: AbortSignal,
  ): Promise<PreflightResult>;
  runCodex(token: string, signal?: AbortSignal): Promise<CodexCanarySummary>;
  now?: () => Date;
}

export class RuntimeHealthCollector {
  private readonly components: Partial<
    Record<AutomationComponent, ComponentSnapshot>
  > = {};
  private readonly probes: HeartbeatDraft["probes"] = {};
  private lastPreflightAttemptMs: number | undefined;
  private lastCodexAttemptMs: number | undefined;
  private codexInputTokens = 0;
  private codexOutputTokens = 0;

  constructor(private readonly dependencies: RuntimeHealthDependencies) {}

  async collect(
    session: RunnerSession,
    signal?: AbortSignal,
  ): Promise<HeartbeatDraft> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const checkedAt = now.toISOString();
    this.markControlPlaneReady(checkedAt);
    let token: string | undefined;

    if (
      isDue(
        this.lastPreflightAttemptMs,
        session.preflightIntervalSeconds,
        now.getTime(),
      )
    ) {
      this.lastPreflightAttemptMs = now.getTime();
      token = await this.dependencies.getToken();
      const result = await this.dependencies.runPreflight(
        token,
        this.probes.PREFLIGHT,
        signal,
      );
      Object.assign(this.components, result.components);
      this.probes.PREFLIGHT = result.probe;
    }

    if (
      isDue(
        this.lastCodexAttemptMs,
        session.codexCanaryIntervalSeconds,
        now.getTime(),
      )
    ) {
      this.lastCodexAttemptMs = now.getTime();
      token ??= await this.dependencies.getToken();
      this.applyCodex(
        await this.dependencies.runCodex(token, signal),
        checkedAt,
      );
    }

    this.probes.HEARTBEAT = successfulProbe(checkedAt);
    const draft: HeartbeatDraft = {
      launcherVersion: AUTOMATION_RUNTIME_VERSION,
      components: { ...this.components },
      probes: { ...this.probes },
      lastPreflightSuccessAt: this.probes.PREFLIGHT?.lastSuccessAt ?? null,
      lastCodexSuccessAt: this.probes.CODEX?.lastSuccessAt ?? null,
      codexInputTokens: this.codexInputTokens,
      codexOutputTokens: this.codexOutputTokens,
    };
    this.codexInputTokens = 0;
    this.codexOutputTokens = 0;
    return draft;
  }

  private markControlPlaneReady(checkedAt: string): void {
    for (const component of ["LAUNCHER", "API", "DATABASE"] as const) {
      this.components[component] = {
        state: "READY",
        reason: "NONE",
        checkedAt,
        probeVersion: AUTOMATION_RUNTIME_VERSION,
      };
    }
  }

  private applyCodex(summary: CodexCanarySummary, checkedAt: string): void {
    this.components.CODEX = {
      state: summary.state,
      reason: summary.reason,
      checkedAt,
      probeVersion: AUTOMATION_RUNTIME_VERSION,
    };
    const successful = summary.state === "READY";
    const previous = this.probes.CODEX;
    this.probes.CODEX = {
      outcome: successful ? "SUCCESS" : "FAILURE",
      reason: summary.reason,
      durationMillis: summary.durationMs,
      consecutiveFailures: successful
        ? 0
        : (previous?.consecutiveFailures ?? 0) + 1,
      lastSuccessAt: successful ? checkedAt : (previous?.lastSuccessAt ?? null),
    };
    this.codexInputTokens = summary.inputTokens;
    this.codexOutputTokens = summary.outputTokens;
  }
}

function isDue(
  lastAttemptMs: number | undefined,
  intervalSeconds: number,
  nowMs: number,
): boolean {
  return (
    lastAttemptMs === undefined ||
    nowMs - lastAttemptMs >= intervalSeconds * 1000
  );
}

function successfulProbe(checkedAt: string): ProbeSnapshot {
  return {
    outcome: "SUCCESS",
    reason: "NONE",
    durationMillis: 0,
    consecutiveFailures: 0,
    lastSuccessAt: checkedAt,
  };
}
