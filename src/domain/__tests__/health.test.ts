import { describe, expect, it } from "vitest";

import type { AutomationComponent, ComponentSnapshot } from "../health.js";
import { aggregateHealth } from "../../runner/health-aggregate.js";

const NOW = new Date("2026-08-18T08:00:00Z");

function snapshots(): Record<AutomationComponent, ComponentSnapshot> {
  const ready = (): ComponentSnapshot => ({
    state: "READY",
    reason: "NONE",
    checkedAt: NOW.toISOString(),
    probeVersion: "0.1.0",
  });
  return {
    LAUNCHER: ready(),
    API: ready(),
    DATABASE: ready(),
    CHROME: ready(),
    PLAYWRIGHT: ready(),
    BROWSER_MCP: ready(),
    JOB_HUNTER_MCP: ready(),
    CODEX: ready(),
  };
}

describe("aggregateHealth", () => {
  it("returns READY when every required component is fresh and ready", () => {
    expect(aggregateHealth(snapshots(), NOW)).toBe("READY");
  });

  it("gives authentication failures precedence", () => {
    const components = snapshots();
    components.CODEX = {
      ...components.CODEX,
      state: "AUTH_REQUIRED",
      reason: "CODEX_AUTH_REQUIRED",
    };
    components.API = {
      ...components.API,
      state: "UNAVAILABLE",
      reason: "API_UNAVAILABLE",
    };

    expect(aggregateHealth(components, NOW)).toBe("AUTH_REQUIRED");
  });

  it("returns UNAVAILABLE when a required component is stale", () => {
    const components = snapshots();
    components.API = { ...components.API, checkedAt: "2026-08-18T07:57:59Z" };

    expect(aggregateHealth(components, NOW)).toBe("UNAVAILABLE");
  });

  it("returns DEGRADED for a fresh degraded component", () => {
    const components = snapshots();
    components.PLAYWRIGHT = {
      ...components.PLAYWRIGHT,
      state: "DEGRADED",
      reason: "PLAYWRIGHT_UNAVAILABLE",
    };

    expect(aggregateHealth(components, NOW)).toBe("DEGRADED");
  });
});
