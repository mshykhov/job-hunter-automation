import { describe, expect, it, vi } from "vitest";

import type {
  JobHunterClient,
  RunnerSession,
} from "../../api/job-hunter-client.js";
import { StaleGenerationError } from "../../api/job-hunter-client.js";
import type { HeartbeatDraft, HeartbeatResponse } from "../../domain/health.js";
import { HeartbeatLoop } from "../heartbeat-loop.js";

const session = (generation: number): RunnerSession => ({
  runnerKey: "primary",
  generation,
  heartbeatIntervalSeconds: 60,
  preflightIntervalSeconds: 300,
  codexCanaryIntervalSeconds: 21_600,
});

const draft: HeartbeatDraft = {
  launcherVersion: "0.1.0",
  components: {},
  probes: {},
  codexInputTokens: 0,
  codexOutputTokens: 0,
};

const accepted: HeartbeatResponse = {
  generation: 1,
  acceptedSequence: 1,
  overallState: "UNAVAILABLE",
};

describe("HeartbeatLoop", () => {
  it("retries the exact request with bounded backoff and resets after success", async () => {
    const client = {
      startSession: vi.fn(() => Promise.resolve(session(1))),
      sendHeartbeat: vi
        .fn<
          (
            request: Parameters<JobHunterClient["sendHeartbeat"]>[0],
          ) => Promise<HeartbeatResponse>
        >()
        .mockRejectedValueOnce(new Error("network"))
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue(accepted),
    };
    const sleep = vi.fn(() => Promise.resolve());
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-08-18T08:00:00Z"))
      .mockReturnValueOnce(new Date("2026-08-18T08:00:05Z"))
      .mockReturnValueOnce(new Date("2026-08-18T08:00:20Z"));
    const loop = new HeartbeatLoop(client, () => Promise.resolve(draft), {
      sleep,
      now,
      id: () => "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
    });

    await loop.runOnce();

    expect(sleep.mock.calls).toEqual([[5_000], [15_000]]);
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(3);
    const requests = client.sendHeartbeat.mock.calls.map(
      ([request]) => request,
    );
    expect(new Set(requests.map((request) => request.idempotencyKey))).toEqual(
      new Set(["d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f"]),
    );
    expect(new Set(requests.map((request) => request.sequence))).toEqual(
      new Set([1]),
    );
    expect(requests.map((request) => request.sentAt)).toEqual([
      "2026-08-18T08:00:00.000Z",
      "2026-08-18T08:00:05.000Z",
      "2026-08-18T08:00:20.000Z",
    ]);
  });

  it("starts a new fenced session after stale generation", async () => {
    const client = {
      startSession: vi
        .fn()
        .mockResolvedValueOnce(session(1))
        .mockResolvedValueOnce(session(2)),
      sendHeartbeat: vi
        .fn<
          (
            request: Parameters<JobHunterClient["sendHeartbeat"]>[0],
          ) => Promise<HeartbeatResponse>
        >()
        .mockRejectedValueOnce(new StaleGenerationError())
        .mockResolvedValue({ ...accepted, generation: 2 }),
    };
    const loop = new HeartbeatLoop(client, () => Promise.resolve(draft), {
      sleep: () => Promise.resolve(),
      now: () => new Date("2026-08-18T08:00:00Z"),
      id: () => "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
    });

    await loop.runOnce();

    expect(client.startSession).toHaveBeenCalledTimes(2);
    expect(
      client.sendHeartbeat.mock.calls.map(([request]) => [
        request.generation,
        request.sequence,
      ]),
    ).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it("passes the server session and abort signal to collection", async () => {
    const client = {
      startSession: vi.fn(() => Promise.resolve(session(1))),
      sendHeartbeat: vi.fn(() => Promise.resolve(accepted)),
    };
    const collect = vi.fn(() => Promise.resolve(draft));
    const controller = new AbortController();
    const loop = new HeartbeatLoop(client, collect, {
      sleep: () => Promise.resolve(),
      now: () => new Date("2026-08-18T08:00:00Z"),
      id: () => "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
    });

    await loop.runOnce(controller.signal);

    expect(collect).toHaveBeenCalledWith(session(1), controller.signal);
  });

  it("interrupts the heartbeat sleep when the launcher stops", async () => {
    const client = {
      startSession: vi.fn(() => Promise.resolve(session(1))),
      sendHeartbeat: vi.fn(() => Promise.resolve(accepted)),
    };
    const controller = new AbortController();
    const sleep = vi.fn(
      (_milliseconds: number, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", resolve, { once: true });
        }),
    );
    const loop = new HeartbeatLoop(client, () => Promise.resolve(draft), {
      sleep,
      now: () => new Date("2026-08-18T08:00:00Z"),
      id: () => "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
    });

    const active = loop.run(controller.signal);
    await vi.waitFor(() => {
      expect(sleep).toHaveBeenCalledOnce();
    });
    controller.abort();
    await active;

    expect(client.sendHeartbeat).toHaveBeenCalledOnce();
  });
});
