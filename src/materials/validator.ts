import type {
  FactCatalog,
  GenerationInput,
  GenerationOutput,
} from "./contracts.js";

export interface ValidationFinding {
  code: string;
  artifact: "CV" | "COVER_LETTER" | "RECRUITER_MESSAGE" | "PACKAGE";
  severity: "HARD" | "SOFT";
}

export interface ValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
}

export function validateGeneration(
  input: GenerationInput,
  output: GenerationOutput,
): ValidationResult {
  const findings: ValidationFinding[] = [];
  const summaryVariants = variantIndex(input.factCatalog.summary);
  for (const variantId of output.summaryVariantIds)
    if (!summaryVariants.has(variantId))
      findings.push(hard("UNKNOWN_SUMMARY_VARIANT", "CV"));

  const qualificationIds = new Set(
    input.factCatalog.qualifications.map(({ id }) => id),
  );
  for (const qualificationId of output.qualificationIds)
    if (!qualificationIds.has(qualificationId))
      findings.push(hard("UNKNOWN_QUALIFICATION", "CV"));

  const experienceById = new Map(
    input.factCatalog.experience.map((experience) => [
      experience.experienceId,
      experience,
    ]),
  );
  const lockedExperienceIds = input.candidateProfile.experience.map(
    ({ id }) => id,
  );
  const selectedExperienceIds = output.experience.map(
    ({ experienceId }) => experienceId,
  );
  if (!sameUniqueIds(lockedExperienceIds, selectedExperienceIds))
    findings.push(hard("EXPERIENCE_STRUCTURE_CHANGED", "CV"));
  for (const selection of output.experience) {
    const experience = experienceById.get(selection.experienceId);
    if (experience === undefined) continue;
    const variants = variantIndex(experience.facts);
    for (const selected of selection.selectedVariants) {
      const fact = experience.facts.find(({ id }) => id === selected.factId);
      if (fact === undefined || !variants.has(selected.variantId))
        findings.push(hard("UNKNOWN_EXPERIENCE_VARIANT", "CV"));
      else if (!fact.variants.some(({ id }) => id === selected.variantId))
        findings.push(hard("VARIANT_FACT_MISMATCH", "CV"));
    }
  }

  validateMessage(
    output.coverLetter,
    "COVER_LETTER",
    input.factCatalog,
    input,
    findings,
  );
  validateMessage(
    output.recruiterMessage,
    "RECRUITER_MESSAGE",
    input.factCatalog,
    input,
    findings,
  );
  if (
    input.coverLetterPolicy !== "OPTIONAL_STANDARD" &&
    output.coverLetter === null
  )
    findings.push(hard("REQUIRED_COVER_LETTER_MISSING", "PACKAGE"));
  if (
    !input.requestedKinds.includes("COVER_LETTER") &&
    output.coverLetter !== null
  )
    findings.push(hard("UNREQUESTED_COVER_LETTER", "PACKAGE"));
  if (
    !input.requestedKinds.includes("RECRUITER_MESSAGE") &&
    output.recruiterMessage !== null
  )
    findings.push(hard("UNREQUESTED_RECRUITER_MESSAGE", "PACKAGE"));

  return {
    valid: findings.every(({ severity }) => severity !== "HARD"),
    findings: deduplicate(findings),
  };
}

function validateMessage(
  message: { text: string; sourceFactIds: string[] } | null,
  artifact: "COVER_LETTER" | "RECRUITER_MESSAGE",
  catalog: FactCatalog,
  input: GenerationInput,
  findings: ValidationFinding[],
): void {
  if (message === null) return;
  const words = message.text.trim().split(/\s+/u).filter(Boolean).length;
  const maximum =
    artifact === "COVER_LETTER"
      ? input.coverLetterPolicy === "REQUIRED_EXTENDED"
        ? 90
        : 70
      : 45;
  const minimum = artifact === "COVER_LETTER" ? 30 : 25;
  if (words < minimum || words > maximum)
    findings.push(hard(`${artifact}_LENGTH`, artifact));

  const knownFacts = allFactIds(catalog);
  if (message.sourceFactIds.some((id) => !knownFacts.has(id)))
    findings.push(hard(`${artifact}_UNKNOWN_SOURCE_FACT`, artifact));

  const forbidden = [
    ...input.candidateProfile.protectedTerms,
    "English C1",
    "C1 English",
    "date of birth",
    "university",
    "bachelor",
    "master's degree",
  ];
  if (
    forbidden.some((term) =>
      message.text
        .toLocaleLowerCase("en")
        .includes(term.toLocaleLowerCase("en")),
    )
  )
    findings.push(hard(`${artifact}_FORBIDDEN_CLAIM`, artifact));

  if (
    /(?:i am writing to express|dear hiring manager|i am thrilled|dynamic team|perfect fit|leverage my skills)/iu.test(
      message.text,
    )
  )
    findings.push({
      code: `${artifact}_GENERIC_TONE`,
      artifact,
      severity: "SOFT",
    });
}

function variantIndex(facts: FactCatalog["summary"]): Set<string> {
  return new Set(facts.flatMap(({ variants }) => variants.map(({ id }) => id)));
}

function allFactIds(catalog: FactCatalog): Set<string> {
  return new Set([
    ...catalog.summary.map(({ id }) => id),
    ...catalog.experience.flatMap(({ facts }) => facts.map(({ id }) => id)),
  ]);
}

function sameUniqueIds(expected: string[], actual: string[]): boolean {
  return (
    new Set(actual).size === actual.length &&
    expected.length === actual.length &&
    expected.every((id) => actual.includes(id))
  );
}

function hard(
  code: string,
  artifact: ValidationFinding["artifact"],
): ValidationFinding {
  return { code, artifact, severity: "HARD" };
}

function deduplicate(findings: ValidationFinding[]): ValidationFinding[] {
  return [
    ...new Map(
      findings.map((finding) => [
        `${finding.code}:${finding.artifact}:${finding.severity}`,
        finding,
      ]),
    ).values(),
  ];
}
