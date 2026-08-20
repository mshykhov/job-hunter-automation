import { z } from "zod";

export const MATERIALS_SCHEMA_VERSION = "application-materials/v1" as const;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const contactPartSchema = z
  .object({
    label: z.string().optional(),
    text: z.string().min(1),
    url: z.string().url().optional(),
  })
  .strict();

const contactSchema = z
  .object({
    label: z.string().optional(),
    text: z.string().min(1).optional(),
    url: z.string().url().optional(),
    parts: z.array(contactPartSchema).min(1).optional(),
  })
  .strict()
  .refine(
    (contact) => contact.text !== undefined || contact.parts !== undefined,
    {
      message: "contact requires text or parts",
    },
  );

const lockedExperienceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    years: z.string().regex(/^\d{4} - \d{4}$/),
    company: z.string().min(1),
    domain: z.string().min(1),
  })
  .strict();

export const candidateProfileSchema = z
  .object({
    schemaVersion: z.literal(MATERIALS_SCHEMA_VERSION),
    identity: z
      .object({
        name: z.string().min(1),
        title: z.string().min(1),
        tagline: z.string().min(1),
      })
      .strict(),
    contacts: z.array(contactSchema).min(1),
    experience: z.array(lockedExperienceSchema).min(1),
    factCatalogVersion: hashSchema,
    privateMatchingFacts: z
      .object({
        englishLevel: z.literal("C1"),
        renderable: z.literal(false),
      })
      .strict(),
    forbiddenRenderFields: z
      .array(z.string())
      .superRefine((fields, context) => {
        for (const required of ["age", "dateOfBirth", "education", "languages"])
          if (!fields.includes(required))
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `missing forbidden field: ${required}`,
            });
      }),
    protectedTerms: z.array(z.string().min(1)),
    metadata: z
      .object({
        author: z.string().min(1),
        docTitle: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const variantSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    approved: z.literal(true),
  })
  .strict();

export const factSchema = z
  .object({
    id: z.string().min(1),
    claimAnchors: z.array(z.string().min(1)).min(1),
    technologies: z.array(z.string().min(1)).optional().default([]),
    metrics: z.array(z.string().min(1)).optional().default([]),
    properNouns: z.array(z.string().min(1)).optional().default([]),
    variants: z.array(variantSchema).min(1),
  })
  .strict();

export const factCatalogSchema = z
  .object({
    schemaVersion: z.literal(MATERIALS_SCHEMA_VERSION),
    summary: z.array(factSchema).min(2),
    qualifications: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            items: z.string().min(1),
          })
          .strict(),
      )
      .min(4),
    experience: z
      .array(
        z
          .object({
            experienceId: z.string().min(1),
            facts: z.array(factSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const writingStyleSchema = z
  .object({
    schemaVersion: z.literal(MATERIALS_SCHEMA_VERSION),
    voiceRules: z.array(z.string().min(1)).min(1),
    examples: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum(["cover_letter", "recruiter_message"]),
            origin: z.enum(["owner_written", "owner_approved", "system_seed"]),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const selectedVariantSchema = z
  .object({
    factId: z.string().min(1),
    variantId: z.string().min(1),
  })
  .strict();

export const materialKindSchema = z.enum([
  "CV_SOURCE",
  "CV_DOCX",
  "CV_PDF",
  "COVER_LETTER_TEXT",
  "RECRUITER_MESSAGE_TEXT",
  "VALIDATION_REPORT",
]);

export const coverLetterPolicySchema = z.enum([
  "OPTIONAL_STANDARD",
  "REQUIRED_STANDARD",
  "REQUIRED_EXTENDED",
]);

export const generationInputSchema = z
  .object({
    schemaVersion: z.literal(MATERIALS_SCHEMA_VERSION),
    requestId: z.string().uuid(),
    vacancy: z
      .object({
        title: z.string().min(1),
        company: z.string().min(1).nullable().optional(),
        description: z.string().min(1),
        source: z.string().min(1),
        url: z.string().url().optional(),
      })
      .strict(),
    candidateProfile: candidateProfileSchema,
    factCatalog: factCatalogSchema,
    writingStyle: writingStyleSchema,
    requestedKinds: z.array(materialKindSchema).min(1),
    coverLetterPolicy: coverLetterPolicySchema,
    mode: z.enum(["TERRA", "SOL_IMPROVE", "USER_EDIT_VALIDATION"]),
  })
  .strict();

const generatedMessageSchema = z
  .object({
    text: z.string().min(1),
    sourceFactIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const generationOutputSchema = z
  .object({
    schemaVersion: z.literal(MATERIALS_SCHEMA_VERSION),
    summaryVariantIds: z.array(z.string().min(1)).min(2).max(5),
    qualificationIds: z.array(z.string().min(1)).min(4),
    experience: z
      .array(
        z
          .object({
            experienceId: z.string().min(1),
            selectedVariants: z.array(selectedVariantSchema).min(1),
          })
          .strict(),
      )
      .min(1),
    coverLetter: generatedMessageSchema
      .extend({ requiredByVacancy: z.boolean() })
      .strict()
      .nullable(),
    recruiterMessage: generatedMessageSchema.nullable(),
  })
  .strict();

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type FactCatalog = z.infer<typeof factCatalogSchema>;
export type WritingStyle = z.infer<typeof writingStyleSchema>;
export type GenerationOutput = z.infer<typeof generationOutputSchema>;
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type MaterialKind = z.infer<typeof materialKindSchema>;
