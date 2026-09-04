import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";

const REQUIRED_ENV = {
  JOB_HUNTER_API_URL: "https://api.example.test",
  AUTHENTIK_TOKEN_URL: "https://auth.example.test/token",
  AUTOMATION_M2M_CLIENT_ID: "client-id",
  AUTOMATION_M2M_USERNAME: "runner",
  AUTOMATION_M2M_PASSWORD: "password",
  BROWSER_PROFILE_DIR: "/var/lib/job-hunter-automation/chrome-profile",
  CODEX_HOME: "/var/lib/job-hunter-automation/codex",
} satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("requires credentials and protected state paths", () => {
    expect(() => loadConfig({})).toThrow(/JOB_HUNTER_API_URL/);
  });

  it("uses documented interval defaults", () => {
    const config = loadConfig(REQUIRED_ENV);

    expect(config.intervals).toEqual({
      heartbeatSeconds: 60,
      preflightSeconds: 300,
      codexSeconds: 21_600,
    });
    expect(config.healthReportingEnabled).toBe(true);
    expect(config.workflows).toBeUndefined();
  });

  it("loads the synthetic workflow worker only when explicitly enabled", () => {
    expect(() =>
      loadConfig({ ...REQUIRED_ENV, WORKFLOW_WORKER_ENABLED: "true" }),
    ).toThrow(/WORKFLOW_WORKER_ID/);
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        WORKFLOW_WORKER_ENABLED: "true",
        WORKFLOW_WORKER_ID: "recovery-worker",
      }).workflows,
    ).toEqual({
      workerId: "recovery-worker",
      pollIntervalMs: 2_000,
      stepDelayMs: 1_000,
    });
  });

  it("can disable health reporting for a materials-only runner", () => {
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        HEALTH_REPORTING_ENABLED: "false",
        MATERIALS_ENABLED: "true",
        MATERIALS_WORKER_ID: "local-runner",
        MATERIALS_WORK_ROOT: "/private/materials/work",
        MATERIALS_RENDERER_COMMAND: "/private/cv-materials-render",
        MATERIALS_CV_PROFILE_PATH: "/private/profile.yaml",
        MATERIALS_BASE_DOCX_PATH: "/private/base-cv.docx",
        MATERIALS_BASE_PDF_PATH: "/private/base-cv.pdf",
        MATERIALS_PROFILE_MANIFEST_PATH: "/private/manifest.json",
        MATERIALS_CANDIDATE_PROFILE_PATH: "/private/candidate-profile.json",
        MATERIALS_FACT_CATALOG_PATH: "/private/fact-catalog.json",
        MATERIALS_WRITING_STYLE_PATH: "/private/writing-style.json",
        MATERIALS_OUTPUT_SCHEMA_PATH: "/runtime/generation-output.schema.json",
      }).healthReportingEnabled,
    ).toBe(false);
  });

  it("allows HTTP only for loopback URLs", () => {
    expect(() =>
      loadConfig({
        ...REQUIRED_ENV,
        JOB_HUNTER_API_URL: "http://api.example.test",
      }),
    ).toThrow(/HTTPS/);
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        JOB_HUNTER_API_URL: "http://127.0.0.1:8080",
      }).apiUrl,
    ).toBe("http://127.0.0.1:8080");
  });

  it("preserves the trailing slash required by the Authentik token endpoint", () => {
    expect(loadConfig(REQUIRED_ENV).tokenUrl).toBe(
      "https://auth.example.test/token",
    );
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        AUTHENTIK_TOKEN_URL: "https://auth.example.test/application/o/token/",
      }).tokenUrl,
    ).toBe("https://auth.example.test/application/o/token/");
  });

  it("loads private material paths only when the compiler is enabled", () => {
    expect(loadConfig(REQUIRED_ENV).materials).toBeUndefined();
    expect(() =>
      loadConfig({ ...REQUIRED_ENV, MATERIALS_ENABLED: "true" }),
    ).toThrow(/MATERIALS_WORKER_ID/);

    expect(
      loadConfig({
        ...REQUIRED_ENV,
        MATERIALS_ENABLED: "true",
        MATERIALS_WORKER_ID: "local-runner",
        MATERIALS_WORK_ROOT: "/private/materials/work",
        MATERIALS_RENDERER_COMMAND: "/private/cv-materials-render",
        MATERIALS_CV_PROFILE_PATH: "/private/profile.yaml",
        MATERIALS_BASE_DOCX_PATH: "/private/base-cv.docx",
        MATERIALS_BASE_PDF_PATH: "/private/base-cv.pdf",
        MATERIALS_PROFILE_MANIFEST_PATH: "/private/manifest.json",
        MATERIALS_CANDIDATE_PROFILE_PATH: "/private/candidate-profile.json",
        MATERIALS_FACT_CATALOG_PATH: "/private/fact-catalog.json",
        MATERIALS_WRITING_STYLE_PATH: "/private/writing-style.json",
        MATERIALS_OUTPUT_SCHEMA_PATH: "/runtime/generation-output.schema.json",
      }).materials,
    ).toMatchObject({
      workerId: "local-runner",
      pollIntervalMs: 15_000,
      generationTimeoutMs: 180_000,
    });
  });
});
