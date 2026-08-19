import { describe, expect, it } from "vitest";

import { runBrowserProbe } from "../browser-probe.js";

describe("runBrowserProbe", () => {
  it("returns only the bounded component result", async () => {
    const result = await runBrowserProbe(
      { preflight: () => Promise.resolve() },
      () => new Date("2026-08-18T08:00:00Z"),
      () => 1250,
    );

    expect(result).toEqual({
      component: "PLAYWRIGHT",
      state: "READY",
      reason: "NONE",
      checkedAt: "2026-08-18T08:00:00.000Z",
      durationMs: 1250,
      probeVersion: "0.1.0",
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "checkedAt",
        "component",
        "durationMs",
        "probeVersion",
        "reason",
        "state",
      ].sort(),
    );
  });

  it("maps internal browser errors without exposing their text", async () => {
    const result = await runBrowserProbe(
      { preflight: () => Promise.reject(new Error("cookie=private-session")) },
      () => new Date("2026-08-18T08:00:00Z"),
      () => 50,
    );

    expect(result.state).toBe("DEGRADED");
    expect(result.reason).toBe("PLAYWRIGHT_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("private-session");
  });
});
