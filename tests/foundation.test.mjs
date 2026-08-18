import { describe, expect, it } from "vitest";

import { AUTOMATION_RUNTIME_VERSION } from "../src/index.ts";

describe("automation runtime foundation", () => {
  it("exports its semantic version", () => {
    expect(AUTOMATION_RUNTIME_VERSION).toBe("0.1.0");
  });
});
