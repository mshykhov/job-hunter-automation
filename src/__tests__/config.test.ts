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
});
