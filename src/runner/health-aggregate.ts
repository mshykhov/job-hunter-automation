import type {
  AutomationComponent,
  AutomationState,
  ComponentSnapshot,
} from "../domain/health.js";
import { AUTOMATION_COMPONENTS } from "../domain/health.js";

const HEARTBEAT_COMPONENTS = new Set<AutomationComponent>([
  "LAUNCHER",
  "API",
  "DATABASE",
]);
const PREFLIGHT_COMPONENTS = new Set<AutomationComponent>([
  "CHROME",
  "PLAYWRIGHT",
  "BROWSER_MCP",
  "JOB_HUNTER_MCP",
]);

export function aggregateHealth(
  components: Readonly<Partial<Record<AutomationComponent, ComponentSnapshot>>>,
  now: Date,
): AutomationState {
  const snapshots = AUTOMATION_COMPONENTS.map((component) => ({
    component,
    snapshot: components[component],
  }));
  if (snapshots.some(({ snapshot }) => snapshot?.state === "AUTH_REQUIRED"))
    return "AUTH_REQUIRED";
  if (
    snapshots.some(
      ({ component, snapshot }) =>
        !snapshot || !isFresh(component, snapshot.checkedAt, now),
    )
  ) {
    return "UNAVAILABLE";
  }
  if (snapshots.some(({ snapshot }) => snapshot?.state === "UNAVAILABLE"))
    return "UNAVAILABLE";
  if (snapshots.some(({ snapshot }) => snapshot?.state === "DEGRADED"))
    return "DEGRADED";
  return "READY";
}

function isFresh(
  component: AutomationComponent,
  checkedAt: string,
  now: Date,
): boolean {
  const timestamp = Date.parse(checkedAt);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now.getTime() + MAX_CLOCK_SKEW_MS
  )
    return false;
  return now.getTime() - timestamp <= freshnessMs(component);
}

function freshnessMs(component: AutomationComponent): number {
  if (HEARTBEAT_COMPONENTS.has(component)) return 2 * 60 * 1000;
  if (PREFLIGHT_COMPONENTS.has(component)) return 10 * 60 * 1000;
  return 12 * 60 * 60 * 1000;
}

const MAX_CLOCK_SKEW_MS = 60 * 1000;
