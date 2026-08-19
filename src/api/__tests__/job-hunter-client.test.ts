import { afterEach, describe, expect, it, vi } from "vitest";

import type { HeartbeatRequest } from "../../domain/health.js";
import {
  JobHunterClient,
  StaleGenerationError,
  UnauthorizedError,
} from "../job-hunter-client.js";
import type { TokenProvider } from "../token-provider.js";

const tokenProvider = {
  getAccessToken: vi.fn(() => Promise.resolve("access-token")),
  invalidate: vi.fn(),
} satisfies TokenProvider;

const heartbeat: HeartbeatRequest = {
  generation: 3,
  sequence: 1,
  idempotencyKey: "d07cb2ae-3b18-46d4-8c2d-aeaaf3bbce1f",
  sentAt: "2026-08-18T08:00:00Z",
  launcherVersion: "0.1.0",
  components: {},
  probes: {},
  codexInputTokens: 0,
  codexOutputTokens: 0,
};

afterEach(() => vi.clearAllMocks());

describe("JobHunterClient", () => {
  it("starts a typed runner session", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          runnerKey: "primary",
          generation: 7,
          heartbeatIntervalSeconds: 60,
          preflightIntervalSeconds: 300,
          codexCanaryIntervalSeconds: 21_600,
        }),
        { status: 200 },
      ),
    );
    const client = new JobHunterClient(
      "https://api.example.test",
      tokenProvider,
      fetchMock,
    );

    await expect(client.startSession()).resolves.toMatchObject({
      generation: 7,
      runnerKey: "primary",
    });
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe(
      "https://api.example.test/automation/runner/session",
    );
    expect(request?.[1]?.method).toBe("POST");
    expect(new Headers(request?.[1]?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("invalidates the token cache on 401", async () => {
    const client = new JobHunterClient(
      "https://api.example.test",
      tokenProvider,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(client.sendHeartbeat(heartbeat)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(tokenProvider.invalidate).toHaveBeenCalledOnce();
  });

  it("maps a conflict to stale generation without exposing response content", async () => {
    const client = new JobHunterClient(
      "https://api.example.test",
      tokenProvider,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("internal details", { status: 409 })),
    );

    await expect(client.sendHeartbeat(heartbeat)).rejects.toBeInstanceOf(
      StaleGenerationError,
    );
  });
});
