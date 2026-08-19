import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createBrowserRunnerServer } from "../server.js";

describe("Browser Runner MCP", () => {
  it("exposes only the deterministic browser_preflight tool", async () => {
    const server = createBrowserRunnerServer({
      preflight: () => Promise.resolve(),
    });
    const client = new Client({
      name: "browser-runner-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "browser_preflight",
      ]);
      const result = await client.callTool({
        name: "browser_preflight",
        arguments: {},
      });
      expect(result.structuredContent).toMatchObject({
        state: "READY",
        reason: "NONE",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
