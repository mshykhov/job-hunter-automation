import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MaterialRenderer } from "../renderer.js";
import { validGenerationOutput } from "./fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("MaterialRenderer", () => {
  it("passes only approved selection IDs to the private renderer", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "materials-renderer-test-"));
    directories.push(workdir);
    const execute = vi.fn(
      async (_command: string, args: string[]): Promise<void> => {
        const selectionPath = argumentAfter(args, "--selection");
        const outputDir = argumentAfter(args, "--output-dir");
        const selection: unknown = JSON.parse(
          await readFile(selectionPath, "utf8"),
        );
        expect(selection).toMatchObject({
          experience: [{ selectedVariantIds: ["fact-example-base"] }],
        });
        await Promise.all([
          writeFile(join(outputDir, "cv.docx"), "docx"),
          writeFile(join(outputDir, "cv.pdf"), "pdf"),
          writeFile(
            join(outputDir, "manifest.json"),
            JSON.stringify({ pageCount: 2 }),
          ),
        ]);
      },
    );
    const renderer = new MaterialRenderer(
      {
        command: "/private/cv-materials-render",
        profilePath: "/private/profile.yaml",
        timeoutMs: 120_000,
      },
      execute,
    );

    const result = await renderer.render(validGenerationOutput(), workdir);

    expect(result.manifest).toEqual({ pageCount: 2 });
    expect(Buffer.from(result.pdf).toString()).toBe("pdf");
  });
});

function argumentAfter(args: string[], option: string): string {
  const value = args.at(args.indexOf(option) + 1);
  if (value === undefined) throw new Error(`Missing argument after ${option}`);
  return value;
}
