import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import type {
  AutomationComponent,
  ProbeComponentResult,
} from "../domain/health.js";
import { AUTOMATION_RUNTIME_VERSION } from "../index.js";

type StdioTransportFactory = (parameters: StdioServerParameters) => Transport;
type HttpTransportFactory = (
  url: URL,
  options: { requestInit: RequestInit },
) => StreamableHTTPClientTransport;

export interface McpProbeClient {
  connect(transport: Transport): Promise<void>;
  getServerCapabilities(): { tools?: unknown } | undefined;
  listTools(): Promise<{ tools: { name: string }[] }>;
  close(): Promise<void>;
}

export interface McpProbeOptions {
  component: Extract<AutomationComponent, "BROWSER_MCP" | "JOB_HUNTER_MCP">;
  requiredTools: readonly string[];
  now?: () => Date;
  duration?: () => number;
}

export function createBrowserRunnerTransport(
  serverPath: string,
  profileDir: string,
  factory: StdioTransportFactory = (parameters) =>
    new StdioClientTransport(parameters),
): Transport {
  return factory({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
    env: { ...getDefaultEnvironment(), BROWSER_PROFILE_DIR: profileDir },
  });
}

export function createJobHunterTransport(
  mcpUrl: string,
  token: string,
  factory: HttpTransportFactory = (url, options) =>
    new StreamableHTTPClientTransport(url, options),
): Transport {
  const delegate = factory(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  return new CompatibleHttpTransport(delegate);
}

export async function runMcpProbe(
  client: McpProbeClient,
  transport: Transport,
  options: McpProbeOptions,
): Promise<ProbeComponentResult> {
  const now = options.now ?? (() => new Date());
  const duration = options.duration ?? elapsedMilliseconds();
  try {
    await client.connect(transport);
    const capabilities = client.getServerCapabilities();
    if (!capabilities?.tools)
      throw new Error("MCP tools capability is unavailable");
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    if (options.requiredTools.some((tool) => !names.has(tool)))
      throw new Error("Required MCP tool is unavailable");
    return result(options.component, "READY", "NONE", now, duration);
  } catch {
    return result(
      options.component,
      "DEGRADED",
      "MCP_UNAVAILABLE",
      now,
      duration,
    );
  } finally {
    await client.close();
  }
}

export function newMcpProbeClient(): McpProbeClient {
  return new Client({
    name: "job-hunter-automation-probe",
    version: AUTOMATION_RUNTIME_VERSION,
  });
}

export function probeBrowserRunner(
  serverPath: string,
  profileDir: string,
): Promise<ProbeComponentResult> {
  return runMcpProbe(
    newMcpProbeClient(),
    createBrowserRunnerTransport(serverPath, profileDir),
    {
      component: "BROWSER_MCP",
      requiredTools: ["browser_preflight"],
    },
  );
}

export function probeJobHunterMcp(
  mcpUrl: string,
  token: string,
): Promise<ProbeComponentResult> {
  return runMcpProbe(
    newMcpProbeClient(),
    createJobHunterTransport(mcpUrl, token),
    {
      component: "JOB_HUNTER_MCP",
      requiredTools: [],
    },
  );
}

function result(
  component: McpProbeOptions["component"],
  state: ProbeComponentResult["state"],
  reason: ProbeComponentResult["reason"],
  now: () => Date,
  duration: () => number,
): ProbeComponentResult {
  return {
    component,
    state,
    reason,
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, Math.round(duration())),
    probeVersion: AUTOMATION_RUNTIME_VERSION,
  };
}

function elapsedMilliseconds(): () => number {
  const startedAt = performance.now();
  return () => performance.now() - startedAt;
}

class CompatibleHttpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: NonNullable<Transport["onmessage"]>;

  constructor(private readonly delegate: StreamableHTTPClientTransport) {}

  async start(): Promise<void> {
    this.delegate.onclose = () => this.onclose?.();
    this.delegate.onerror = (error) => this.onerror?.(error);
    this.delegate.onmessage = (message) => this.onmessage?.(message);
    await this.delegate.start();
  }

  close(): Promise<void> {
    return this.delegate.close();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (!options) return this.delegate.send(message);
    const compatible: {
      resumptionToken?: string;
      onresumptiontoken?: (token: string) => void;
    } = {};
    if (options.resumptionToken !== undefined)
      compatible.resumptionToken = options.resumptionToken;
    if (options.onresumptiontoken !== undefined)
      compatible.onresumptiontoken = options.onresumptiontoken;
    return this.delegate.send(message, compatible);
  }

  setProtocolVersion(version: string): void {
    this.delegate.setProtocolVersion(version);
  }
}
