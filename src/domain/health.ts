export const AUTOMATION_STATES = [
  "READY",
  "DEGRADED",
  "AUTH_REQUIRED",
  "UNAVAILABLE",
] as const;
export type AutomationState = (typeof AUTOMATION_STATES)[number];

export const AUTOMATION_COMPONENTS = [
  "LAUNCHER",
  "API",
  "DATABASE",
  "CHROME",
  "PLAYWRIGHT",
  "BROWSER_MCP",
  "JOB_HUNTER_MCP",
  "CODEX",
] as const;
export type AutomationComponent = (typeof AUTOMATION_COMPONENTS)[number];

export const AUTOMATION_REASONS = [
  "NONE",
  "API_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "CHROME_UNAVAILABLE",
  "PROFILE_UNREADABLE",
  "PLAYWRIGHT_UNAVAILABLE",
  "MCP_UNAVAILABLE",
  "CODEX_AUTH_REQUIRED",
  "SITE_AUTH_REQUIRED",
  "CANARY_FAILED",
  "CLOCK_SKEW",
  "STALE_GENERATION",
  "INVALID_REPORT",
  "OTHER",
] as const;
export type AutomationReason = (typeof AUTOMATION_REASONS)[number];

export const PROBE_TYPES = ["HEARTBEAT", "PREFLIGHT", "CODEX"] as const;
export type ProbeType = (typeof PROBE_TYPES)[number];

export const PROBE_OUTCOMES = ["SUCCESS", "FAILURE"] as const;
export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

export interface ComponentSnapshot {
  state: AutomationState;
  reason: AutomationReason;
  checkedAt: string;
  probeVersion: string;
}

export interface ProbeSnapshot {
  outcome: ProbeOutcome;
  reason: AutomationReason;
  durationMillis: number;
  consecutiveFailures: number;
  lastSuccessAt?: string | null;
}

export interface HeartbeatDraft {
  launcherVersion: string;
  components: Partial<Record<AutomationComponent, ComponentSnapshot>>;
  probes: Partial<Record<ProbeType, ProbeSnapshot>>;
  lastPreflightSuccessAt?: string | null;
  lastCodexSuccessAt?: string | null;
  codexInputTokens: number;
  codexOutputTokens: number;
}

export interface HeartbeatRequest extends HeartbeatDraft {
  generation: number;
  sequence: number;
  idempotencyKey: string;
  sentAt: string;
}

export interface HeartbeatResponse {
  generation: number;
  acceptedSequence: number;
  state: AutomationState;
}
