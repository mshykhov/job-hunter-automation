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
});
