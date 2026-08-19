import { describe, expect, it, vi } from "vitest";

import { runPreflight } from "../preflight.js";

describe("runPreflight", () => {
  it("serializes browser and MCP probes into one bounded snapshot", async () => {
    const order: string[] = [];
    const result = await runPreflight({
      browser: () => {
        order.push("browser");
        return Promise.resolve({
          component: "PLAYWRIGHT",
          state: "READY",
          reason: "NONE",
          checkedAt: "2026-08-18T08:00:00.000Z",
          durationMs: 10,
          probeVersion: "0.1.0",
        });
      },
      browserMcp: () => {
        order.push("browser-mcp");
        return Promise.resolve({
          component: "BROWSER_MCP",
          state: "READY",
          reason: "NONE",
          checkedAt: "2026-08-18T08:00:01.000Z",
          durationMs: 20,
          probeVersion: "0.1.0",
        });
      },
      jobHunterMcp: () => {
        order.push("job-hunter-mcp");
        return Promise.resolve({
          component: "JOB_HUNTER_MCP",
          state: "READY",
          reason: "NONE",
          checkedAt: "2026-08-18T08:00:02.000Z",
          durationMs: 30,
          probeVersion: "0.1.0",
        });
      },
      now: () => new Date("2026-08-18T08:00:03Z"),
    });

    expect(order).toEqual(["browser", "browser-mcp", "job-hunter-mcp"]);
    expect(result.probe).toEqual({
      outcome: "SUCCESS",
      reason: "NONE",
      durationMillis: 60,
      consecutiveFailures: 0,
      lastSuccessAt: "2026-08-18T08:00:03.000Z",
    });
    expect(Object.keys(result.components)).toEqual([
      "CHROME",
      "PLAYWRIGHT",
      "BROWSER_MCP",
      "JOB_HUNTER_MCP",
    ]);
  });

  it("tracks consecutive failures across runs", async () => {
    const failure = {
      component: "PLAYWRIGHT" as const,
      state: "DEGRADED" as const,
      reason: "PLAYWRIGHT_UNAVAILABLE" as const,
      checkedAt: "2026-08-18T08:00:00.000Z",
      durationMs: 10,
      probeVersion: "0.1.0",
    };
    const dependency = vi.fn(() => Promise.resolve(failure));

    const first = await runPreflight({
      browser: dependency,
      browserMcp: dependency,
      jobHunterMcp: dependency,
    });
    const second = await runPreflight(
      { browser: dependency, browserMcp: dependency, jobHunterMcp: dependency },
      first.probe,
    );

    expect(first.probe.consecutiveFailures).toBe(1);
    expect(second.probe.consecutiveFailures).toBe(2);
  });
});
