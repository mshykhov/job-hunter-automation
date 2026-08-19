import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AUTOMATION_RUNTIME_VERSION } from "../index.js";
import { runBrowserProbe } from "../probes/browser-probe.js";
import { BrowserController } from "./browser-controller.js";

interface BrowserPreflight {
  preflight(): Promise<void>;
}

export function createBrowserRunnerServer(
  controller: BrowserPreflight,
): McpServer {
  const server = new McpServer({
    name: "job-hunter-browser-runner",
    version: AUTOMATION_RUNTIME_VERSION,
  });
  server.registerTool(
    "browser_preflight",
    {
      description:
        "Verify deterministic control of the dedicated Chrome profile",
      inputSchema: {},
      outputSchema: {
        component: z.enum(["CHROME", "PLAYWRIGHT"]),
        state: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
        reason: z.enum([
          "NONE",
          "CHROME_UNAVAILABLE",
          "PLAYWRIGHT_UNAVAILABLE",
        ]),
        checkedAt: z.string(),
        durationMs: z.number().nonnegative(),
        probeVersion: z.string(),
      },
    },
    async () => {
      const result = await runBrowserProbe(controller);
      return {
        content: [{ type: "text", text: "Browser preflight completed" }],
        structuredContent: { ...result },
      };
    },
  );
  return server;
}

export async function runBrowserRunnerServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const profileDir = env.BROWSER_PROFILE_DIR?.trim();
  if (!profileDir)
    throw new Error(
      "Missing required environment variable: BROWSER_PROFILE_DIR",
    );
  const controller = new BrowserController(profileDir);
  const server = createBrowserRunnerServer(controller);
  server.server.onclose = () => {
    controller.close().catch(() => undefined);
  };
  try {
    await server.connect(new StdioServerTransport());
  } catch {
    await controller.close();
    throw new Error("Browser Runner MCP failed");
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runBrowserRunnerServer().catch(() => {
    process.stderr.write("Browser Runner MCP failed\n");
    process.exitCode = 1;
  });
}
