import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";

import { CodexJsonlParser, type CodexCanarySummary } from "./jsonl-parser.js";

export interface CodexCanaryConfig {
  codexHome: string;
  workspace: string;
  jobHunterMcpToken: string;
  timeoutMs: number;
  browserProfileDir?: string;
  display?: string;
}

export interface CodexInvocation {
  command: string;
  args: string[];
  options: SpawnOptions;
}

export interface CodexChildProcess {
  pid: number;
  stdout: ChunkStream;
  stderr: ChunkStream;
  exit: Promise<number | null>;
}

interface CodexCanaryDependencies {
  spawn: (invocation: CodexInvocation) => CodexChildProcess;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  schedule: (callback: () => void, milliseconds: number) => () => void;
  now: () => number;
}

const DEFAULT_DEPENDENCIES: CodexCanaryDependencies = {
  spawn: spawnCodex,
  kill: (pid, signal) => process.kill(pid, signal),
  schedule: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
  now: performance.now.bind(performance),
};

export function buildCodexInvocation(
  config: CodexCanaryConfig,
  baseEnv: NodeJS.ProcessEnv = process.env,
): CodexInvocation {
  const env: NodeJS.ProcessEnv = {
    ...allowlistedEnvironment(baseEnv),
    CODEX_HOME: config.codexHome,
    JOB_HUNTER_MCP_TOKEN: config.jobHunterMcpToken,
  };
  if (config.browserProfileDir !== undefined)
    env.BROWSER_PROFILE_DIR = config.browserProfileDir;
  if (config.display !== undefined) env.DISPLAY = config.display;
  return {
    command: "codex",
    args: [
      "exec",
      "--skip-git-repo-check",
      "--profile",
      "automation-canary",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      config.workspace,
      "Return exactly AUTOMATION_CANARY_READY. Do not call tools.",
    ],
    options: {
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  };
}

export async function runCodexCanary(
  config: CodexCanaryConfig,
  dependencies: CodexCanaryDependencies = DEFAULT_DEPENDENCIES,
  signal?: AbortSignal,
): Promise<CodexCanarySummary> {
  if (signal?.aborted) return failedSummary(0);
  const startedAt = dependencies.now();
  const child = dependencies.spawn(buildCodexInvocation(config));
  if (child.pid <= 0) return failedSummary(0);
  const parser = new CodexJsonlParser();
  const timeout = { triggered: false };
  const interrupted = { triggered: false };
  const terminate = () => {
    try {
      dependencies.kill(-child.pid, "SIGTERM");
    } catch {
      // The process may have exited between completion and the signal.
    }
  };
  const abort = () => {
    interrupted.triggered = true;
    terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const cancelTimeout = dependencies.schedule(() => {
    timeout.triggered = true;
    terminate();
  }, config.timeoutMs);

  try {
    const [exitCode] = await Promise.all([
      child.exit,
      consumeStdout(child.stdout, parser),
      consumeStderr(child.stderr),
    ]);
    const duration = dependencies.now() - startedAt;
    const parsed = parser.finish(duration);
    if (
      timeout.triggered ||
      interrupted.triggered ||
      (exitCode !== 0 && parsed.state === "READY")
    )
      return failedSummary(duration);
    return parsed;
  } finally {
    cancelTimeout();
    signal?.removeEventListener("abort", abort);
  }
}

async function consumeStdout(
  stream: ChunkStream,
  parser: CodexJsonlParser,
): Promise<void> {
  for await (const chunk of stream)
    parser.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
}

async function consumeStderr(stream: ChunkStream): Promise<void> {
  let retained = 0;
  for await (const chunk of stream) {
    if (retained < MAX_STDERR_BYTES)
      retained += Math.min(byteLength(chunk), MAX_STDERR_BYTES - retained);
  }
}

function byteLength(chunk: string | Uint8Array): number {
  return typeof chunk === "string"
    ? Buffer.byteLength(chunk)
    : chunk.byteLength;
}

function failedSummary(durationMs: number): CodexCanarySummary {
  return {
    state: "DEGRADED",
    reason: "CANARY_FAILED",
    inputTokens: 0,
    outputTokens: 0,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

function spawnCodex(invocation: CodexInvocation): CodexChildProcess {
  const child = nodeSpawn(
    invocation.command,
    invocation.args,
    invocation.options,
  );
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code);
    });
  });
  return {
    pid: child.pid ?? 0,
    stdout: child.stdout ?? EMPTY_STREAM,
    stderr: child.stderr ?? EMPTY_STREAM,
    exit,
  };
}

const MAX_STDERR_BYTES = 8192;
type ChunkStream =
  | AsyncIterable<string | Uint8Array>
  | Iterable<string | Uint8Array>;
const EMPTY_STREAM: readonly Uint8Array[] = [];

function allowlistedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    CHILD_ENV_ALLOWLIST.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

const CHILD_ENV_ALLOWLIST = [
  "HOME",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "USER",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;
