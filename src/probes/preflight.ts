import type {
  AutomationComponent,
  ComponentSnapshot,
  ProbeComponentResult,
  ProbeSnapshot,
} from "../domain/health.js";
import type { BrowserRunnerProbeResult } from "./mcp-probe.js";

interface PreflightDependencies {
  browserRunner(): Promise<BrowserRunnerProbeResult>;
  jobHunterMcp(): Promise<ProbeComponentResult>;
  now?: () => Date;
}

export interface PreflightResult {
  components: Partial<Record<AutomationComponent, ComponentSnapshot>>;
  probe: ProbeSnapshot;
}

export async function runPreflight(
  dependencies: PreflightDependencies,
  previous?: ProbeSnapshot,
): Promise<PreflightResult> {
  const browserRunner = await dependencies.browserRunner();
  const jobHunterMcp = await dependencies.jobHunterMcp();
  const browser = browserRunner.browser;
  const results = [browser, browserRunner.mcp, jobHunterMcp];
  const successful = results.every((result) => result.state === "READY");
  const checkedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const components: Partial<Record<AutomationComponent, ComponentSnapshot>> =
    {};
  if (browser.component === "PLAYWRIGHT" && browser.state === "READY") {
    components.CHROME = snapshot({ ...browser, component: "CHROME" });
  }
  results.forEach((result) => {
    components[result.component] = snapshot(result);
  });
  return {
    components,
    probe: {
      outcome: successful ? "SUCCESS" : "FAILURE",
      reason:
        results.find((result) => result.state !== "READY")?.reason ?? "NONE",
      durationMillis: results.reduce(
        (total, result) => total + result.durationMs,
        0,
      ),
      consecutiveFailures: successful
        ? 0
        : (previous?.consecutiveFailures ?? 0) + 1,
      lastSuccessAt: successful ? checkedAt : (previous?.lastSuccessAt ?? null),
    },
  };
}

function snapshot(result: ProbeComponentResult): ComponentSnapshot {
  return {
    state: result.state,
    reason: result.reason,
    checkedAt: result.checkedAt,
    probeVersion: result.probeVersion,
  };
}
