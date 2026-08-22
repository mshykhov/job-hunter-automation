import { spawn as nodeSpawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  generationOutputSchema,
  type GenerationInput,
  type GenerationOutput,
} from "./contracts.js";

export interface CodexGeneratorConfig {
  codexHome: string;
  outputSchemaPath: string;
  timeoutMs: number;
}

export interface CodexGenerationRequest {
  input: GenerationInput;
  workdir: string;
  model: "gpt-5.6-terra" | "gpt-5.6-sol";
  repairFindings?: string[];
}

export interface CodexMaterialInvocation {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  outputPath: string;
  timeoutMs: number;
}

export class CodexGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexGenerationError";
  }
}

export class CodexMaterialGenerator {
  constructor(
    private readonly config: CodexGeneratorConfig,
    private readonly execute: (
      invocation: CodexMaterialInvocation,
      signal?: AbortSignal,
    ) => Promise<void> = executeCodex,
  ) {}

  async generate(
    request: CodexGenerationRequest,
    signal?: AbortSignal,
  ): Promise<GenerationOutput> {
    const invocation = buildCodexMaterialInvocation(this.config, request);
    await this.execute(invocation, signal);
    const file = await stat(invocation.outputPath);
    if (file.size <= 0 || file.size > MAX_OUTPUT_BYTES)
      throw new CodexGenerationError("Codex material output size is invalid");
    const output: unknown = JSON.parse(
      await readFile(invocation.outputPath, "utf8"),
    );
    return generationOutputSchema.parse(output);
  }
}

export function buildCodexMaterialInvocation(
  config: CodexGeneratorConfig,
  request: CodexGenerationRequest,
  baseEnv: NodeJS.ProcessEnv = process.env,
): CodexMaterialInvocation {
  const outputPath = join(request.workdir, "generation-output.json");
  return {
    command: "codex",
    args: [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--model",
      request.model,
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--output-schema",
      config.outputSchemaPath,
      "--output-last-message",
      outputPath,
      "-C",
      request.workdir,
      "-",
    ],
    cwd: request.workdir,
    env: {
      ...allowlistedEnvironment(baseEnv),
      CODEX_HOME: config.codexHome,
    },
    prompt: generationPrompt(request.input, request.repairFindings),
    outputPath,
    timeoutMs: config.timeoutMs,
  };
}

async function executeCodex(
  invocation: CodexMaterialInvocation,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    throw new CodexGenerationError("Codex generation aborted");
  const child = nodeSpawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    detached: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (child.pid === undefined)
    throw new CodexGenerationError("Codex process did not start");
  child.stdin.end(invocation.prompt);
  const terminate = () => {
    try {
      process.kill(-(child.pid ?? 0), "SIGTERM");
    } catch {
      // Process already exited.
    }
  };
  const timer = setTimeout(terminate, invocation.timeoutMs);
  timer.unref();
  const abort = () => {
    terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const [exitCode] = await Promise.all([
      new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      }),
      drain(child.stdout),
      drain(child.stderr),
    ]);
    if (signal?.aborted)
      throw new CodexGenerationError("Codex generation aborted");
    if (exitCode !== 0)
      throw new CodexGenerationError("Codex generation failed");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk as Uint8Array);
    if (bytes > MAX_STREAM_BYTES)
      throw new CodexGenerationError("Codex event stream exceeded limit");
  }
}

function generationPrompt(
  input: GenerationInput,
  repairFindings?: string[],
): string {
  return `You prepare truthful job-application materials for the candidate in the input.

Return only the JSON object required by the supplied output schema.

Rules:
- Select only approved variant and qualification IDs present in the fact catalog. Never rewrite CV facts and never invent claims, dates, employers, technologies, metrics, or responsibilities.
- Preserve every locked experience entry. Rank approved facts and qualifications for the vacancy and ATS relevance without keyword stuffing.
- Return empty summaryVariantIds, qualificationIds, and experience arrays when CV_DOCX/CV_PDF are not requested.
- Cover letter: direct, natural C1 English, 2-3 sentences, target 40-55 words, hard range 30-70 words. REQUIRED_EXTENDED alone permits up to 90 words. It should sound like the candidate wrote it, with no greeting, sign-off, flattery, or formal filler.
- Recruiter message: direct and human, target 25-40 words, hard range 25-45 words.
- Every message must cite the exact source fact IDs supporting its claims. Do not mention English level, education, age, date of birth, protected terms, or the generation process.
- Return null for an unrequested optional message.
- Do not call tools. Do not read or write files. Use only the JSON input below.

Input:
${JSON.stringify(input)}${
    repairFindings === undefined
      ? ""
      : `\n\nThe prior result failed these deterministic validator codes. Return a fresh corrected result without changing any sourced facts:\n${JSON.stringify(repairFindings)}`
  }`;
}

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
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
