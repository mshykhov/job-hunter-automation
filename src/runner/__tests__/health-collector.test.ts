import { describe, expect, it, vi } from "vitest";

import type { RunnerSession } from "../../api/job-hunter-client.js";
import type { CodexCanarySummary } from "../../codex/jsonl-parser.js";
import type { PreflightResult } from "../../probes/preflight.js";
import { RuntimeHealthCollector } from "../health-collector.js";

const session: RunnerSession = {
  runnerKey: "primary",
  generation: 1,
  heartbeatIntervalSeconds: 60,
  preflightIntervalSeconds: 300,
  codexCanaryIntervalSeconds: 21_600,
};

const preflight: PreflightResult = {
  components: {
    CHROME: component(),
    PLAYWRIGHT: component(),
    BROWSER_MCP: component(),
    JOB_HUNTER_MCP: component(),
  },
  probe: {
    outcome: "SUCCESS",
    reason: "NONE",
    durationMillis: 40,
    consecutiveFailures: 0,
    lastSuccessAt: "2026-08-18T08:00:00.000Z",
  },
};

const codex: CodexCanarySummary = {
  state: "READY",
  reason: "NONE",
  inputTokens: 12,
  outputTokens: 3,
  durationMs: 500,
};

describe("RuntimeHealthCollector", () => {
  it("runs probes sequentially and reuses fresh snapshots", async () => {
    const order: string[] = [];
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-08-18T08:00:00Z"))
      .mockReturnValueOnce(new Date("2026-08-18T08:01:00Z"));
    const getToken = vi.fn(() => {
      order.push("token");
      return Promise.resolve("token");
    });
    const runPreflight = vi.fn(() => {
      order.push("preflight");
      return Promise.resolve(preflight);
    });
    const runCodex = vi.fn(() => {
      order.push("codex");
      return Promise.resolve(codex);
    });
    const collector = new RuntimeHealthCollector({
      getToken,
      runPreflight,
      runCodex,
      now,
    });

    const first = await collector.collect(session);
    const second = await collector.collect(session);

    expect(order).toEqual(["token", "preflight", "codex"]);
    expect(first.components.CODEX).toMatchObject({ state: "READY" });
    expect(first.probes.CODEX).toMatchObject({
      outcome: "SUCCESS",
      consecutiveFailures: 0,
    });
    expect(first.codexInputTokens).toBe(12);
    expect(second.codexInputTokens).toBe(0);
    expect(second.components.PLAYWRIGHT).toEqual(first.components.PLAYWRIGHT);
    expect(second.components.CODEX).toEqual(first.components.CODEX);
    expect(second.components.LAUNCHER?.checkedAt).toBe(
      "2026-08-18T08:01:00.000Z",
    );
    expect(runPreflight).toHaveBeenCalledWith("token", undefined, undefined);
    expect(runCodex).toHaveBeenCalledWith("token", undefined);
  });

  it("uses server intervals and tracks bounded Codex failures", async () => {
    const clock = { value: new Date("2026-08-18T08:00:00Z") };
    const failed: CodexCanarySummary = {
      state: "AUTH_REQUIRED",
      reason: "CODEX_AUTH_REQUIRED",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 100,
    };
    const runCodex = vi.fn(() => Promise.resolve(failed));
    const collector = new RuntimeHealthCollector({
      getToken: () => Promise.resolve("token"),
      runPreflight: () => Promise.resolve(preflight),
      runCodex,
      now: () => clock.value,
    });

    const first = await collector.collect(session);
    clock.value = new Date("2026-08-18T14:00:00Z");
    const second = await collector.collect(session);

    expect(runCodex).toHaveBeenCalledTimes(2);
    expect(first.probes.CODEX?.consecutiveFailures).toBe(1);
    expect(second.probes.CODEX?.consecutiveFailures).toBe(2);
    expect(second.components.CODEX).toMatchObject({
      state: "AUTH_REQUIRED",
      reason: "CODEX_AUTH_REQUIRED",
    });
    expect(JSON.stringify(second)).not.toContain("token");
  });
});

function component() {
  return {
    state: "READY" as const,
    reason: "NONE" as const,
    checkedAt: "2026-08-18T08:00:00.000Z",
    probeVersion: "0.1.0",
  };
}
