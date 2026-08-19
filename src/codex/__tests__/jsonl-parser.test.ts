import { describe, expect, it } from "vitest";

import { CodexJsonlParser, MAX_JSONL_LINE_BYTES } from "../jsonl-parser.js";

describe("CodexJsonlParser", () => {
  it("returns only a bounded successful canary summary", () => {
    const parser = new CodexJsonlParser();
    parser.push(
      [
        { type: "thread.started", thread_id: "private-thread-id" },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: { type: "agent_message", text: "AUTOMATION_CANARY_READY" },
        },
        {
          type: "item.completed",
          item: { type: "reasoning", text: "discarded" },
        },
        {
          type: "turn.completed",
          usage: { input_tokens: 17, cached_input_tokens: 5, output_tokens: 3 },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n",
    );

    const summary = parser.finish(1250);

    expect(summary).toEqual({
      state: "READY",
      reason: "NONE",
      inputTokens: 17,
      outputTokens: 3,
      durationMs: 1250,
    });
    expect(JSON.stringify(summary)).not.toContain("private-thread-id");
    expect(JSON.stringify(summary)).not.toContain("AUTOMATION_CANARY_READY");
  });

  it("classifies authentication failures without retaining raw errors", () => {
    const parser = new CodexJsonlParser();
    parser.push(
      `${JSON.stringify({ type: "turn.failed", error: { message: "401 login required for private account" } })}\n`,
    );

    const summary = parser.finish(50);

    expect(summary).toMatchObject({
      state: "AUTH_REQUIRED",
      reason: "CODEX_AUTH_REQUIRED",
    });
    expect(JSON.stringify(summary)).not.toContain("private account");
  });

  it("fails closed on malformed JSON and oversized lines", () => {
    const malformed = new CodexJsonlParser();
    malformed.push("not-json\n");
    expect(malformed.finish(1)).toMatchObject({
      state: "DEGRADED",
      reason: "CANARY_FAILED",
    });

    const oversized = new CodexJsonlParser();
    oversized.push(`${"x".repeat(MAX_JSONL_LINE_BYTES + 1)}\n`);
    expect(oversized.finish(1)).toMatchObject({
      state: "DEGRADED",
      reason: "CANARY_FAILED",
    });
  });

  it("does not accept a completed turn without the fixed marker", () => {
    const parser = new CodexJsonlParser();
    parser.push(
      `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
    );

    expect(parser.finish(10)).toMatchObject({
      state: "DEGRADED",
      reason: "CANARY_FAILED",
    });
  });
});
