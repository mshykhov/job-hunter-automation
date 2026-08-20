import { readFileSync } from "node:fs";

import {
  generationInputSchema,
  generationOutputSchema,
  type GenerationInput,
  type GenerationOutput,
} from "../contracts.js";

const fixture: unknown = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/application-materials/v1/examples/synthetic-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

export function validGenerationInput(): GenerationInput {
  if (!isRecord(fixture)) throw new Error("Synthetic fixture is invalid");
  return generationInputSchema.parse({
    schemaVersion: "application-materials/v1",
    requestId: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
    vacancy: {
      title: "Senior Kotlin Backend Engineer",
      company: "Product Example",
      description:
        "Build Kotlin and Spring Boot APIs for a remote developer tools product.",
      source: "EXAMPLE",
      url: "https://example.invalid/jobs/kotlin",
    },
    candidateProfile: fixture.candidateProfile,
    factCatalog: fixture.factCatalog,
    writingStyle: fixture.writingStyle,
    requestedKinds: ["CV_DOCX", "CV_PDF", "COVER_LETTER"],
    coverLetterPolicy: "OPTIONAL_STANDARD",
    mode: "TERRA",
  });
}

export function validGenerationOutput(): GenerationOutput {
  return generationOutputSchema.parse({
    schemaVersion: "application-materials/v1",
    summaryVariantIds: ["summary-example-base", "summary-domain-base"],
    qualificationIds: [
      "qualification-languages",
      "qualification-frameworks",
      "qualification-storage",
      "qualification-testing",
    ],
    experience: [
      {
        experienceId: "exp-example",
        selectedVariants: [
          { factId: "fact-example", variantId: "fact-example-base" },
        ],
      },
    ],
    coverLetter: {
      text: "My Kotlin and Spring Boot background includes building APIs for developer tooling and shipping backend systems. This role aligns closely with that work, and I would be glad to discuss the problems your team is solving.",
      sourceFactIds: ["fact-example"],
      requiredByVacancy: false,
    },
    recruiterMessage: null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
