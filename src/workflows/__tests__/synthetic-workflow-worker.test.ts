import { describe, expect, it, vi } from "vitest";

import {
  LeaseLostError,
  type RunnerSession,
  type WorkflowClaim,
  type WorkflowProgress,
} from "../../api/job-hunter-client.js";
import { RunnerSessionCoordinator } from "../../runner/session-coordinator.js";
import {
  SyntheticWorkflowWorker,
  type SyntheticWorkflowClient,
} from "../synthetic-workflow-worker.js";

const session: RunnerSession = {
  runnerKey: "primary",
  generation: 7,
  heartbeatIntervalSeconds: 60,
  preflightIntervalSeconds: 300,
  codexCanaryIntervalSeconds: 21_600,
};

const claim: WorkflowClaim = {
  runId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
  workItemId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce2f",
  attemptId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce3f",
  leaseToken: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce4f",
  leaseExpiresAt: "2026-09-04T09:00:00Z",
  generation: 7,
  nextStepIndex: 0,
  steps: ["PREPARE", "EXECUTE", "VERIFY"],
};

const progress: WorkflowProgress = {
  runId: claim.runId,
  workItemId: claim.workItemId,
  runStatus: "RUNNING",
  workItemStatus: "LEASED",
  completedSteps: 1,
  leaseExpiresAt: claim.leaseExpiresAt,
};

function fixture(overrides: Record<string, unknown> = {}) {
  const client = {
    startSession: vi.fn(() => Promise.resolve(session)),
    claimWorkflow: vi.fn(() => Promise.resolve(claim)),
    heartbeatWorkflow: vi.fn(() => Promise.resolve(progress)),
    checkpointWorkflow: vi.fn(() => Promise.resolve(progress)),
    completeWorkflow: vi.fn(() =>
      Promise.resolve({
        ...progress,
        runStatus: "SUCCEEDED" as const,
        workItemStatus: "SUCCEEDED" as const,
        completedSteps: 3,
      }),
    ),
    failWorkflow: vi.fn(() => Promise.resolve(progress)),
    ...overrides,
  };
  const execute = vi.fn(() => Promise.resolve("a".repeat(64)));
  const worker = new SyntheticWorkflowWorker(
    { workerId: "test-worker", pollIntervalMs: 1, stepDelayMs: 1 },
    client,
    new RunnerSessionCoordinator(client),
    {
      sleep: () => Promise.resolve(),
      execute,
    },
  );
  return { client, execute, worker };
}

describe("SyntheticWorkflowWorker", () => {
  it("checkpoints the three ordered steps and completes", async () => {
    const { client, execute, worker } = fixture();

    await worker.runOnce();

    expect(execute.mock.calls.map(([step]) => step)).toEqual([
      "PREPARE",
      "EXECUTE",
      "VERIFY",
    ]);
    expect(client.checkpointWorkflow).toHaveBeenCalledTimes(3);
    expect(client.completeWorkflow).toHaveBeenCalledOnce();
  });

  it("resumes at the first incomplete step", async () => {
    const { execute, worker } = fixture({
      claimWorkflow: vi.fn(() =>
        Promise.resolve({ ...claim, nextStepIndex: 1 }),
      ),
    });

    await worker.runOnce();

    expect(execute.mock.calls.map(([step]) => step)).toEqual([
      "EXECUTE",
      "VERIFY",
    ]);
  });

  it("retries a lost checkpoint response without executing the step twice", async () => {
    const checkpointWorkflow = vi
      .fn<SyntheticWorkflowClient["checkpointWorkflow"]>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue(progress);
    const { execute, worker } = fixture({ checkpointWorkflow });

    await worker.runOnce();

    expect(execute).toHaveBeenCalledTimes(3);
    expect(checkpointWorkflow).toHaveBeenCalledTimes(4);
    expect(checkpointWorkflow.mock.calls[0]?.[1].idempotencyKey).toBe(
      checkpointWorkflow.mock.calls[1]?.[1].idempotencyKey,
    );
  });

  it("stops immediately when the API revokes the lease", async () => {
    const { client, execute, worker } = fixture({
      heartbeatWorkflow: vi.fn(() => Promise.reject(new LeaseLostError())),
    });

    await worker.runOnce();

    expect(execute).not.toHaveBeenCalled();
    expect(client.completeWorkflow).not.toHaveBeenCalled();
  });
});
