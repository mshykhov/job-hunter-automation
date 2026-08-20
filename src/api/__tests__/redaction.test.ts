import { describe, expect, it } from "vitest";

import { redactSensitive } from "../redaction.js";

describe("redactSensitive", () => {
  it("recursively redacts sensitive keys without changing safe fields", () => {
    expect(
      redactSensitive({
        status: "failed",
        authorization: "Bearer token",
        nested: {
          password: "secret",
          Cookie: "session",
          token: "raw",
          reason: "timeout",
        },
      }),
    ).toEqual({
      status: "failed",
      authorization: "[REDACTED]",
      nested: {
        password: "[REDACTED]",
        Cookie: "[REDACTED]",
        token: "[REDACTED]",
        reason: "timeout",
      },
    });
  });

  it("recursively removes private material bodies", () => {
    expect(
      redactSensitive({
        requestId: "safe-id",
        candidateProfile: { identity: { name: "Private" } },
        vacancy: { description: "Private vacancy" },
        artifacts: [{ content: Buffer.from("private bytes") }],
      }),
    ).toEqual({
      requestId: "safe-id",
      candidateProfile: "[REDACTED]",
      vacancy: "[REDACTED]",
      artifacts: [{ content: "[REDACTED]" }],
    });
  });
});
