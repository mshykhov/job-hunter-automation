import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it, vi } from "vitest";

import {
  createBrowserRunnerTransport,
  createJobHunterTransport,
  runMcpProbe,
} from "../mcp-probe.js";

describe("MCP probes", () => {
  it("constructs bounded stdio and authenticated HTTP transports", () => {
    const stdioFactory = vi.fn<
      (parameters: StdioServerParameters) => Transport
    >(() => InMemoryTransport.createLinkedPair()[0]);
    const httpFactory = vi.fn(
      (
        url: URL,
        options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1],
      ) => new StreamableHTTPClientTransport(url, options),
    );

    createBrowserRunnerTransport(
      "/opt/job-hunter-automation/dist/browser-runner/server.js",
      "/var/lib/job-hunter-automation/chrome-profile",
      stdioFactory,
    );
    createJobHunterTransport(
      "https://api.example.test/mcp",
      "access-token",
      httpFactory,
    );

    const stdioParameters = stdioFactory.mock.calls[0]?.[0];
    expect(stdioParameters?.command).toBe(process.execPath);
    expect(stdioParameters?.args).toEqual([
      "/opt/job-hunter-automation/dist/browser-runner/server.js",
    ]);
    expect(stdioParameters?.stderr).toBe("pipe");
    expect(stdioParameters?.env?.BROWSER_PROFILE_DIR).toBe(
      "/var/lib/job-hunter-automation/chrome-profile",
    );
    expect(httpFactory).toHaveBeenCalledWith(
      new URL("https://api.example.test/mcp"),
      {
        requestInit: { headers: { Authorization: "Bearer access-token" } },
      },
    );
  });

  it("checks capabilities and tools and always closes the client", async () => {
    const client = {
      connect: vi.fn(() => Promise.resolve()),
      getServerCapabilities: vi.fn(() => ({ tools: {} })),
      listTools: vi.fn(() =>
        Promise.resolve({ tools: [{ name: "browser_preflight" }] }),
      ),
      close: vi.fn(() => Promise.resolve()),
    };

    const result = await runMcpProbe(
      client,
      InMemoryTransport.createLinkedPair()[0],
      {
        component: "BROWSER_MCP",
        requiredTools: ["browser_preflight"],
        now: () => new Date("2026-08-18T08:00:00Z"),
        duration: () => 40,
      },
    );

    expect(result).toMatchObject({
      component: "BROWSER_MCP",
      state: "READY",
      reason: "NONE",
    });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("closes the client after a protocol failure", async () => {
    const client = {
      connect: vi.fn(() => Promise.reject(new Error("protocol details"))),
      getServerCapabilities: vi.fn(),
      listTools: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
    };

    const result = await runMcpProbe(
      client,
      InMemoryTransport.createLinkedPair()[0],
      {
        component: "JOB_HUNTER_MCP",
        requiredTools: [],
        now: () => new Date("2026-08-18T08:00:00Z"),
        duration: () => 40,
      },
    );

    expect(result).toMatchObject({
      state: "DEGRADED",
      reason: "MCP_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("protocol details");
    expect(client.close).toHaveBeenCalledOnce();
  });
});
