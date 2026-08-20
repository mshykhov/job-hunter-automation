import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { GenerationOutput } from "./contracts.js";

const execFile = promisify(nodeExecFile);

export interface MaterialRendererConfig {
  command: string;
  profilePath: string;
  timeoutMs: number;
}

export interface RenderedCv {
  docx: Uint8Array;
  pdf: Uint8Array;
  manifest: Record<string, unknown>;
}

export class MaterialRenderer {
  constructor(
    private readonly config: MaterialRendererConfig,
    private readonly execute: typeof executeRenderer = executeRenderer,
  ) {}

  async render(
    output: GenerationOutput,
    workdir: string,
    signal?: AbortSignal,
  ): Promise<RenderedCv> {
    const selectionPath = join(workdir, "render-selection.json");
    const outputDir = join(workdir, "rendered");
    await mkdir(outputDir, { recursive: false });
    await writeFile(
      selectionPath,
      JSON.stringify({
        summaryVariantIds: output.summaryVariantIds,
        qualificationIds: output.qualificationIds,
        experience: output.experience.map((experience) => ({
          experienceId: experience.experienceId,
          selectedVariantIds: experience.selectedVariants.map(
            ({ variantId }) => variantId,
          ),
        })),
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    await this.execute(
      this.config.command,
      [
        "--profile",
        this.config.profilePath,
        "--selection",
        selectionPath,
        "--output-dir",
        outputDir,
      ],
      workdir,
      this.config.timeoutMs,
      signal,
    );
    const [docx, pdf, rawManifest] = await Promise.all([
      readFile(join(outputDir, "cv.docx")),
      readFile(join(outputDir, "cv.pdf")),
      readFile(join(outputDir, "manifest.json"), "utf8"),
    ]);
    const manifest: unknown = JSON.parse(rawManifest);
    if (!isRecord(manifest)) throw new Error("Renderer manifest is invalid");
    return { docx, pdf, manifest };
  }
}

async function executeRenderer(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await execFile(command, args, {
    cwd,
    shell: false,
    timeout: timeoutMs,
    signal,
    maxBuffer: 1024 * 1024,
    env: allowlistedEnvironment(process.env),
  });
}

function allowlistedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR"].flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
