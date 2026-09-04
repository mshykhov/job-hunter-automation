import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import {
  LeaseLostError,
  StaleGenerationError,
  UnauthorizedError,
  type WorkflowCheckpointCommand,
  type WorkflowClaim,
  type WorkflowFailureCommand,
  type WorkflowLeaseCommand,
  type WorkflowProgress,
  type WorkflowStep,
} from "../api/job-hunter-client.js";
import { RunnerSessionCoordinator } from "../runner/session-coordinator.js";

export interface SyntheticWorkflowWorkerConfig {
  workerId: string;
  pollIntervalMs: number;
  stepDelayMs: number;
}

export interface SyntheticWorkflowClient {
  claimWorkflow(
    workerId: string,
    generation: number,
  ): Promise<WorkflowClaim | null>;
  heartbeatWorkflow(
    workItemId: string,
    command: WorkflowLeaseCommand,
  ): Promise<WorkflowProgress>;
  checkpointWorkflow(
    workItemId: string,
    command: WorkflowCheckpointCommand,
  ): Promise<WorkflowProgress>;
  completeWorkflow(
    workItemId: string,
    command: WorkflowLeaseCommand,
  ): Promise<WorkflowProgress>;
  failWorkflow(
    workItemId: string,
    command: WorkflowFailureCommand,
  ): Promise<WorkflowProgress>;
}

export interface SyntheticWorkflowWorkerOptions {
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  execute: (
    step: WorkflowStep,
    claim: WorkflowClaim,
    signal?: AbortSignal,
  ) => Promise<string>;
}

const DEFAULT_OPTIONS: SyntheticWorkflowWorkerOptions = {
  sleep: async (milliseconds, signal) => {
    await delay(milliseconds, undefined, { signal });
  },
  execute: (step, claim) =>
    Promise.resolve(
      createHash("sha256")
        .update(`${claim.runId}:${claim.workItemId}:${step}`)
        .digest("hex"),
    ),
};

export class SyntheticWorkflowWorker {
  constructor(
    private readonly config: SyntheticWorkflowWorkerConfig,
    private readonly client: SyntheticWorkflowClient,
    private readonly sessions: RunnerSessionCoordinator,
    private readonly options: SyntheticWorkflowWorkerOptions = DEFAULT_OPTIONS,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    while (!isAborted(signal)) {
      try {
        await this.runOnce(signal);
      } catch (error) {
        if (
          error instanceof UnauthorizedError ||
          (error instanceof Error && error.name === "ZodError")
        )
          throw error;
        if (isAbortError(error) || isAborted(signal)) return;
      }
      if (!isAborted(signal)) {
        try {
          await this.options.sleep(this.config.pollIntervalMs, signal);
        } catch (error) {
          if (!isAborted(signal)) throw error;
        }
      }
    }
  }

  async runOnce(signal?: AbortSignal): Promise<void> {
    let claim: WorkflowClaim | null = null;
    try {
      const session = await this.sessions.current();
      claim = await this.client.claimWorkflow(
        this.config.workerId,
        session.generation,
      );
      if (claim === null) return;
      for (
        let index = claim.nextStepIndex;
        index < claim.steps.length;
        index += 1
      ) {
        if (signal?.aborted === true) return;
        const step = claim.steps[index];
        if (step === undefined) throw new Error("Workflow step is missing");
        await this.client.heartbeatWorkflow(
          claim.workItemId,
          leaseCommand(claim),
        );
        if (this.config.stepDelayMs > 0)
          await this.options.sleep(this.config.stepDelayMs, signal);
        const evidenceSha256 = await this.options.execute(step, claim, signal);
        await this.retryCheckpoint(
          claim,
          {
            ...leaseCommand(claim),
            idempotencyKey: checkpointId(claim.workItemId, step),
            step,
            evidenceSha256,
          },
          signal,
        );
      }
      await this.retryComplete(claim, signal);
    } catch (error) {
      if (error instanceof StaleGenerationError) {
        const staleGeneration =
          claim?.generation ?? (await this.sessions.current()).generation;
        await this.sessions.refresh(staleGeneration);
        return;
      }
      if (
        error instanceof LeaseLostError ||
        isAbortError(error) ||
        signal?.aborted === true
      )
        return;
      if (claim !== null) await this.reportFailure(claim, error);
      else throw error;
    }
  }

  private async retryCheckpoint(
    claim: WorkflowClaim,
    command: WorkflowCheckpointCommand,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.retry(
      () => this.client.checkpointWorkflow(claim.workItemId, command),
      signal,
    );
  }

  private async retryComplete(
    claim: WorkflowClaim,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.retry(
      () => this.client.completeWorkflow(claim.workItemId, leaseCommand(claim)),
      signal,
    );
  }

  private async retry(
    operation: () => Promise<WorkflowProgress>,
    signal?: AbortSignal,
  ): Promise<void> {
    let lastError: unknown;
    for (const backoff of [0, 250, 1_000]) {
      if (backoff > 0) await this.options.sleep(backoff, signal);
      try {
        await operation();
        return;
      } catch (error) {
        if (
          error instanceof StaleGenerationError ||
          error instanceof LeaseLostError
        )
          throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  private async reportFailure(
    claim: WorkflowClaim,
    error: unknown,
  ): Promise<void> {
    try {
      await this.client.failWorkflow(claim.workItemId, {
        ...leaseCommand(claim),
        retryable: true,
        code: "SYNTHETIC_STEP_FAILED",
        detail: boundedError(error),
      });
    } catch {
      // Lease expiry and the API-owned retry policy recover unreported failures.
    }
  }
}

function leaseCommand(claim: WorkflowClaim): WorkflowLeaseCommand {
  return {
    attemptId: claim.attemptId,
    leaseToken: claim.leaseToken,
    generation: claim.generation,
  };
}

function checkpointId(workItemId: string, step: WorkflowStep): string {
  const hex = createHash("sha256")
    .update(`${workItemId}:${step}`)
    .digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function boundedError(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return name.slice(0, 512);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
