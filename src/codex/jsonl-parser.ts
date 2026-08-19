export interface CodexCanarySummary {
  state: "READY" | "DEGRADED" | "AUTH_REQUIRED";
  reason: "NONE" | "CODEX_AUTH_REQUIRED" | "CANARY_FAILED";
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export const MAX_JSONL_LINE_BYTES = 64 * 1024;

export class CodexJsonlParser {
  private buffer = "";
  private invalid = false;
  private authRequired = false;
  private markerSeen = false;
  private completed = false;
  private inputTokens = 0;
  private outputTokens = 0;

  push(chunk: string): void {
    if (this.invalid) return;
    this.buffer += chunk;
    if (
      Buffer.byteLength(this.buffer) > MAX_JSONL_LINE_BYTES &&
      !this.buffer.includes("\n")
    ) {
      this.invalid = true;
      this.buffer = "";
      return;
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    lines.forEach((line) => {
      this.process(line);
    });
  }

  finish(durationMs: number): CodexCanarySummary {
    if (this.buffer.length > 0) this.process(this.buffer);
    const duration = Math.max(0, Math.round(durationMs));
    if (this.authRequired)
      return summary("AUTH_REQUIRED", "CODEX_AUTH_REQUIRED", 0, 0, duration);
    if (this.invalid || !this.completed || !this.markerSeen) {
      return summary("DEGRADED", "CANARY_FAILED", 0, 0, duration);
    }
    return summary(
      "READY",
      "NONE",
      this.inputTokens,
      this.outputTokens,
      duration,
    );
  }

  private process(line: string): void {
    if (line.length === 0 || this.invalid) return;
    if (Buffer.byteLength(line) > MAX_JSONL_LINE_BYTES) {
      this.invalid = true;
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      this.invalid = true;
      return;
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      this.invalid = true;
      return;
    }
    if (event.type === "item.completed" && isRecord(event.item)) {
      this.markerSeen ||=
        event.item.type === "agent_message" &&
        event.item.text === CANARY_MARKER;
    }
    if (event.type === "turn.completed") {
      this.completed = true;
      if (isRecord(event.usage)) {
        this.inputTokens = nonNegativeInteger(event.usage.input_tokens);
        this.outputTokens = nonNegativeInteger(event.usage.output_tokens);
      }
    }
    if (event.type === "turn.failed" || event.type === "error") {
      const failure = JSON.stringify(event).slice(0, MAX_AUTH_SCAN_BYTES);
      this.authRequired ||= AUTH_FAILURE_PATTERN.test(failure);
      if (!this.authRequired) this.invalid = true;
    }
  }
}

function summary(
  state: CodexCanarySummary["state"],
  reason: CodexCanarySummary["reason"],
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
): CodexCanarySummary {
  return { state, reason, inputTokens, outputTokens, durationMs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

const CANARY_MARKER = "AUTOMATION_CANARY_READY";
const MAX_AUTH_SCAN_BYTES = 4096;
const AUTH_FAILURE_PATTERN =
  /(?:401|unauthorized|authentication|auth required|login required)/i;
