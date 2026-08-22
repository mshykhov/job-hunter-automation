import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  candidateProfileSchema,
  factCatalogSchema,
  generationInputSchema,
  generationOutputSchema,
  MATERIALS_SCHEMA_VERSION,
  writingStyleSchema,
} from "../contracts.js";

const fixtureUrl = new URL(
  "../../../contracts/application-materials/v1/examples/synthetic-profile.json",
  import.meta.url,
);
const outputSchemaUrl = new URL(
  "../../../contracts/application-materials/v1/generation-output.schema.json",
  import.meta.url,
);

describe("application materials contracts", () => {
  it("accepts the synthetic versioned profile bundle", async () => {
    const fixture: unknown = JSON.parse(await readFile(fixtureUrl, "utf8"));
    expect(typeof fixture).toBe("object");
    if (fixture === null || !("candidateProfile" in fixture))
      throw new Error("synthetic fixture is invalid");

    expect(
      candidateProfileSchema.parse(fixture.candidateProfile).schemaVersion,
    ).toBe(MATERIALS_SCHEMA_VERSION);
    expect(
      factCatalogSchema.parse(fixture.factCatalog).summary.length,
    ).toBeGreaterThan(0);
    expect(
      writingStyleSchema.parse(fixture.writingStyle).examples.length,
    ).toBeGreaterThan(0);
  });

  it("rejects private matching facts marked renderable", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as {
      candidateProfile: Record<string, unknown> & {
        privateMatchingFacts: Record<string, unknown>;
      };
    };
    fixture.candidateProfile.privateMatchingFacts.renderable = true;

    expect(() =>
      candidateProfileSchema.parse(fixture.candidateProfile),
    ).toThrow();
  });

  it("accepts an empty CV selection for text-only generation", () => {
    expect(
      generationOutputSchema.parse({
        schemaVersion: MATERIALS_SCHEMA_VERSION,
        summaryVariantIds: [],
        qualificationIds: [],
        experience: [],
        coverLetter: null,
        recruiterMessage: null,
      }),
    ).toMatchObject({
      summaryVariantIds: [],
      qualificationIds: [],
      experience: [],
    });
  });

  it("accepts a generation request with an explicit cover-letter policy", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as {
      candidateProfile: unknown;
      factCatalog: unknown;
      writingStyle: unknown;
    };

    const input = generationInputSchema.parse({
      schemaVersion: MATERIALS_SCHEMA_VERSION,
      requestId: "018f7f64-4c4a-7d00-8000-123456789abc",
      vacancy: {
        title: "Senior Backend Engineer",
        company: "Example Hiring Co",
        description: "Build Kotlin services and reliable APIs.",
        source: "synthetic",
      },
      candidateProfile: fixture.candidateProfile,
      factCatalog: fixture.factCatalog,
      writingStyle: fixture.writingStyle,
      requestedKinds: ["CV_PDF", "CV_DOCX", "COVER_LETTER"],
      coverLetterPolicy: "OPTIONAL_STANDARD",
      mode: "TERRA",
    });

    expect(input.coverLetterPolicy).toBe("OPTIONAL_STANDARD");
  });

  it("publishes a strict Codex output schema", async () => {
    const schema = JSON.parse(await readFile(outputSchemaUrl, "utf8")) as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: { schemaVersion?: { type?: string; const?: string } };
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.schemaVersion).toEqual({
      type: "string",
      const: MATERIALS_SCHEMA_VERSION,
    });
    expect(schema.required).toEqual([
      "schemaVersion",
      "summaryVariantIds",
      "qualificationIds",
      "experience",
      "coverLetter",
      "recruiterMessage",
    ]);
  });
});
