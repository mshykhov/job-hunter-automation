import {
  ChromeUnavailableError,
  type BrowserController,
} from "../browser-runner/browser-controller.js";
import type { ProbeComponentResult } from "../domain/health.js";
import { AUTOMATION_RUNTIME_VERSION } from "../index.js";

type BrowserPreflight = Pick<BrowserController, "preflight">;

export async function runBrowserProbe(
  controller: BrowserPreflight,
  now: () => Date = () => new Date(),
  duration: () => number = elapsedMilliseconds(),
): Promise<ProbeComponentResult> {
  try {
    await controller.preflight();
    return result("PLAYWRIGHT", "READY", "NONE", now, duration);
  } catch (error) {
    if (error instanceof ChromeUnavailableError) {
      return result(
        "CHROME",
        "UNAVAILABLE",
        "CHROME_UNAVAILABLE",
        now,
        duration,
      );
    }
    return result(
      "PLAYWRIGHT",
      "DEGRADED",
      "PLAYWRIGHT_UNAVAILABLE",
      now,
      duration,
    );
  }
}

function result(
  component: ProbeComponentResult["component"],
  state: ProbeComponentResult["state"],
  reason: ProbeComponentResult["reason"],
  now: () => Date,
  duration: () => number,
): ProbeComponentResult {
  return {
    component,
    state,
    reason,
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, Math.round(duration())),
    probeVersion: AUTOMATION_RUNTIME_VERSION,
  };
}

function elapsedMilliseconds(): () => number {
  const startedAt = performance.now();
  return () => performance.now() - startedAt;
}
