import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCodexMaterialInvocation,
  CodexMaterialGenerator,
  type CodexMaterialInvocation,
} from "../codex-generator.js";
import { validGenerationInput, validGenerationOutput } from "./fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("CodexMaterialGenerator", () => {
  it("passes private input over stdin and pins the requested model", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "materials-generator-test-"));
    directories.push(workdir);
    const invocation = buildCodexMaterialInvocation(
      {
        codexHome: "/private/codex",
        outputSchemaPath: "/runtime/output.schema.json",
        timeoutMs: 120_000,
      },
      {
        input: validGenerationInput(),
        workdir,
        model: "gpt-5.6-terra",
      },
      { PATH: "/usr/bin", OPENAI_API_KEY: "must-not-leak" },
    );

    expect(invocation.args).toContain("gpt-5.6-terra");
    expect(invocation.args.join(" ")).not.toContain("Senior Kotlin");
    expect(invocation.prompt).toContain("Senior Kotlin Backend Engineer");
    expect(invocation.prompt).toContain(
      "Open with why this specific role is interesting",
    );
    expect(invocation.prompt).toContain(
      "one concrete, sourced example from the candidate's work",
    );
    expect(invocation.prompt).toContain('start consecutive sentences with "I"');
    expect(invocation.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(invocation.args).toEqual(
      expect.arrayContaining(["--ignore-user-config", "--ignore-rules"]),
    );
  });

  it("parses the schema-constrained last message", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "materials-generator-test-"));
    directories.push(workdir);
    const execute = vi.fn(
      async (invocation: CodexMaterialInvocation): Promise<void> => {
        await writeFile(
          invocation.outputPath,
          JSON.stringify(validGenerationOutput()),
        );
      },
    );
    const generator = new CodexMaterialGenerator(
      {
        codexHome: "/private/codex",
        outputSchemaPath: "/runtime/output.schema.json",
        timeoutMs: 120_000,
      },
      execute,
    );

    await expect(
      generator.generate({
        input: validGenerationInput(),
        workdir,
        model: "gpt-5.6-terra",
      }),
    ).resolves.toEqual(validGenerationOutput());
  });
});
