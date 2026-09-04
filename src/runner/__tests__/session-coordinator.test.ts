import { describe, expect, it, vi } from "vitest";

import type { RunnerSession } from "../../api/job-hunter-client.js";
import { RunnerSessionCoordinator } from "../session-coordinator.js";

const session = (generation: number): RunnerSession => ({
  runnerKey: "primary",
  generation,
  heartbeatIntervalSeconds: 60,
  preflightIntervalSeconds: 300,
  codexCanaryIntervalSeconds: 21_600,
});

describe("RunnerSessionCoordinator", () => {
  it("shares one session across concurrent consumers", async () => {
    const client = { startSession: vi.fn(() => Promise.resolve(session(1))) };
    const coordinator = new RunnerSessionCoordinator(client);

    const sessions = await Promise.all([
      coordinator.current(),
      coordinator.current(),
      coordinator.current(),
    ]);

    expect(client.startSession).toHaveBeenCalledOnce();
    expect(sessions).toEqual([session(1), session(1), session(1)]);
  });

  it("refreshes a stale generation once", async () => {
    const client = {
      startSession: vi
        .fn()
        .mockResolvedValueOnce(session(1))
        .mockResolvedValueOnce(session(2)),
    };
    const coordinator = new RunnerSessionCoordinator(client);
    await coordinator.current();

    const sessions = await Promise.all([
      coordinator.refresh(1),
      coordinator.refresh(1),
    ]);

    expect(client.startSession).toHaveBeenCalledTimes(2);
    expect(sessions).toEqual([session(2), session(2)]);
  });
});
