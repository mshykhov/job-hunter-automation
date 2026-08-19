import { describe, expect, it, vi } from "vitest";

import {
  buildCodexInvocation,
  runCodexCanary,
  type CodexChildProcess,
} from "../codex-probe.js";

const config = {
  codexHome: "/var/lib/job-hunter-automation/codex",
  workspace: "/var/lib/job-hunter-automation/canary-workspace",
  jobHunterMcpToken: "mcp-token",
  timeoutMs: 30_000,
};

describe("Codex canary", () => {
  it("constructs the exact read-only ephemeral command and child-only token environment", () => {
    const baseEnv = {
      PATH: "/usr/bin",
      HOME: "/var/lib/job-hunter-automation",
      AUTOMATION_M2M_PASSWORD: "must-not-reach-codex",
    };

    const invocation = buildCodexInvocation(config, baseEnv);

    expect(invocation.command).toBe("codex");
    expect(invocation.args).toEqual([
      "exec",
      "--profile",
      "automation-canary",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      "/var/lib/job-hunter-automation/canary-workspace",
      "Return exactly AUTOMATION_CANARY_READY. Do not call tools.",
    ]);
    expect(invocation.options).toMatchObject({
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(invocation.options.env?.CODEX_HOME).toBe(config.codexHome);
    expect(invocation.options.env?.JOB_HUNTER_MCP_TOKEN).toBe("mcp-token");
    expect(invocation.options.env?.HOME).toBe("/var/lib/job-hunter-automation");
    expect(invocation.options.env).not.toHaveProperty(
      "AUTOMATION_M2M_PASSWORD",
    );
    expect(baseEnv).not.toHaveProperty("JOB_HUNTER_MCP_TOKEN");
  });

  it("terminates the detached process group when the launcher aborts", async () => {
    let finishExit: ((value: number | null) => void) | undefined;
    const exit = new Promise<number | null>((resolve) => {
      finishExit = resolve;
    });
    const kill = vi.fn(() => {
      finishExit?.(null);
    });
    const controller = new AbortController();
    const active = runCodexCanary(
      config,
      {
        spawn: () => ({ pid: 42, stdout: [], stderr: [], exit }),
        kill,
        schedule: () => vi.fn(),
        now: elapsedClock(),
      },
      controller.signal,
    );

    controller.abort();
    const summary = await active;

    expect(kill).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(summary).toMatchObject({
      state: "DEGRADED",
      reason: "CANARY_FAILED",
    });
  });

  it("parses stdout in memory and terminates the process group on timeout", async () => {
    let finishExit: ((code: number | null) => void) | undefined;
    const exit = new Promise<number | null>((resolve) => {
      finishExit = resolve;
    });
    const child: CodexChildProcess = {
      pid: 4242,
      stdout: [`${JSON.stringify({ type: "turn.started" })}\n`],
      stderr: ["private stderr".repeat(1000)],
      exit,
    };
    const kill = vi.fn<(pid: number, signal: NodeJS.Signals) => void>(() => {
      finishExit?.(null);
    });
    const schedule = vi.fn((callback: () => void) => {
      callback();
      return vi.fn();
    });

    const summary = await runCodexCanary(config, {
      spawn: () => child,
      kill,
      schedule,
      now: elapsedClock(),
    });

    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(summary).toEqual({
      state: "DEGRADED",
      reason: "CANARY_FAILED",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 25,
    });
    expect(JSON.stringify(summary)).not.toContain("private stderr");
  });
});

function elapsedClock(): () => number {
  const values = [1000, 1025];
  return () => values.shift() ?? 1025;
}
