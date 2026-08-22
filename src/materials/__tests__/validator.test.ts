import { describe, expect, it } from "vitest";

import { validateGeneration } from "../validator.js";
import { validGenerationInput, validGenerationOutput } from "./fixtures.js";

describe("validateGeneration", () => {
  it("accepts sourced approved selections and short human messages", () => {
    expect(
      validateGeneration(validGenerationInput(), validGenerationOutput()),
    ).toEqual({ valid: true, findings: [] });
  });

  it("rejects invented variants and unsupported message claims", () => {
    const output = validGenerationOutput();
    const experience = output.experience.at(0);
    const selectedVariant = experience?.selectedVariants.at(0);
    if (selectedVariant === undefined) throw new Error("Fixture is incomplete");
    selectedVariant.variantId = "invented";
    output.coverLetter = {
      text: "I am writing to express my interest. English C1.",
      sourceFactIds: ["invented-fact"],
      requiredByVacancy: false,
    };

    const result = validateGeneration(validGenerationInput(), output);

    expect(result.valid).toBe(false);
    expect(result.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_EXPERIENCE_VARIANT",
        "COVER_LETTER_LENGTH",
        "COVER_LETTER_UNKNOWN_SOURCE_FACT",
        "COVER_LETTER_FORBIDDEN_CLAIM",
        "COVER_LETTER_GENERIC_TONE",
      ]),
    );
  });

  it("accepts no CV selection for a text-only request", () => {
    const input = validGenerationInput();
    input.requestedKinds = ["COVER_LETTER"];
    const output = validGenerationOutput();
    output.summaryVariantIds = [];
    output.qualificationIds = [];
    output.experience = [];
    output.recruiterMessage = null;

    expect(validateGeneration(input, output)).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("rejects an empty CV selection when CV is requested", () => {
    const output = validGenerationOutput();
    output.summaryVariantIds = [];
    output.qualificationIds = [];
    output.experience = [];

    const result = validateGeneration(validGenerationInput(), output);

    expect(result.valid).toBe(false);
    expect(result.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CV_SUMMARY_MISSING",
        "CV_QUALIFICATIONS_MISSING",
        "EXPERIENCE_STRUCTURE_CHANGED",
      ]),
    );
  });
});
