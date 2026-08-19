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
  callTool?(request: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface BrowserRunnerProbeResult {
  browser: ProbeComponentResult;
  mcp: ProbeComponentResult;
}

export interface McpProbeOptions {
  component: Extract<AutomationComponent, "BROWSER_MCP" | "JOB_HUNTER_MCP">;
  requiredTools: readonly string[];
  now?: () => Date;
  duration?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function createBrowserRunnerTransport(
  serverPath: string,
  profileDir: string,
  factory: StdioTransportFactory = (parameters) =>
    new StdioClientTransport(parameters),
  baseEnv: NodeJS.ProcessEnv = process.env,
): Transport {
  const display = baseEnv.DISPLAY;
  return factory({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
    env: {
      ...getDefaultEnvironment(),
      BROWSER_PROFILE_DIR: profileDir,
      ...(display === undefined ? {} : { DISPLAY: display }),
    },
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
    await withMcpLifecycle(
      client,
      async () => {
        await client.connect(transport);
        const capabilities = client.getServerCapabilities();
        if (!capabilities?.tools)
          throw new Error("MCP tools capability is unavailable");
        const tools = await client.listTools();
        const names = new Set(tools.tools.map((tool) => tool.name));
        if (options.requiredTools.some((tool) => !names.has(tool)))
          throw new Error("Required MCP tool is unavailable");
      },
      options.signal,
      options.timeoutMs,
    );
    return result(options.component, "READY", "NONE", now, duration);
  } catch {
    return result(
      options.component,
      "DEGRADED",
      "MCP_UNAVAILABLE",
      now,
      duration,
    );
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
  signal?: AbortSignal,
): Promise<BrowserRunnerProbeResult> {
  return runBrowserRunnerProbe(
    newMcpProbeClient(),
    createBrowserRunnerTransport(serverPath, profileDir),
    undefined,
    undefined,
    signal,
  );
}

export async function runBrowserRunnerProbe(
  client: McpProbeClient,
  transport: Transport,
  now: () => Date = () => new Date(),
  duration: () => number = elapsedMilliseconds(),
  signal?: AbortSignal,
): Promise<BrowserRunnerProbeResult> {
  try {
    const response = await withMcpLifecycle(
      client,
      async () => {
        await client.connect(transport);
        const capabilities = client.getServerCapabilities();
        if (!capabilities?.tools)
          throw new Error("MCP tools capability is unavailable");
        const tools = await client.listTools();
        if (!tools.tools.some((tool) => tool.name === "browser_preflight"))
          throw new Error("Required MCP tool is unavailable");
        if (!client.callTool)
          throw new Error("MCP tool invocation is unavailable");
        return client.callTool({
          name: "browser_preflight",
          arguments: {},
        });
      },
      signal,
    );
    if (!isRecord(response))
      throw new Error("Browser preflight response is invalid");
    const browser = parseBrowserResult(response.structuredContent);
    if (response.isError === true || !browser)
      throw new Error("Browser preflight response is invalid");
    return {
      browser,
      mcp: result("BROWSER_MCP", "READY", "NONE", now, duration),
    };
  } catch {
    return {
      browser: browserFailure(now),
      mcp: result("BROWSER_MCP", "DEGRADED", "MCP_UNAVAILABLE", now, duration),
    };
  }
}

export function probeJobHunterMcp(
  mcpUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<ProbeComponentResult> {
  return runMcpProbe(
    newMcpProbeClient(),
    createJobHunterTransport(mcpUrl, token),
    {
      component: "JOB_HUNTER_MCP",
      requiredTools: [],
      ...(signal === undefined ? {} : { signal }),
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

function browserFailure(now: () => Date): ProbeComponentResult {
  return {
    component: "PLAYWRIGHT",
    state: "DEGRADED",
    reason: "PLAYWRIGHT_UNAVAILABLE",
    checkedAt: now().toISOString(),
    durationMs: 0,
    probeVersion: AUTOMATION_RUNTIME_VERSION,
  };
}

function parseBrowserResult(value: unknown): ProbeComponentResult | undefined {
  if (
    !isRecord(value) ||
    !(
      (value.component === "CHROME" || value.component === "PLAYWRIGHT") &&
      (value.state === "READY" ||
        value.state === "DEGRADED" ||
        value.state === "UNAVAILABLE") &&
      (value.reason === "NONE" ||
        value.reason === "CHROME_UNAVAILABLE" ||
        value.reason === "PLAYWRIGHT_UNAVAILABLE") &&
      typeof value.checkedAt === "string" &&
      typeof value.durationMs === "number" &&
      Number.isFinite(value.durationMs) &&
      value.durationMs >= 0 &&
      typeof value.probeVersion === "string"
    )
  ) {
    return undefined;
  }
  return {
    component: value.component,
    state: value.state,
    reason: value.reason,
    checkedAt: value.checkedAt,
    durationMs: value.durationMs,
    probeVersion: value.probeVersion,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function withMcpLifecycle<T>(
  client: McpProbeClient,
  operation: () => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = MCP_TIMEOUT_MS,
): Promise<T> {
  let closePromise: Promise<void> | undefined;
  const close = () => {
    closePromise ??= client.close();
    return closePromise;
  };
  if (signal?.aborted) {
    await close().catch(() => undefined);
    throw new Error("MCP probe cancelled");
  }
  let rejectCancellation: ((error: Error) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const cancel = () => {
    void close().catch(() => undefined);
    rejectCancellation?.(new Error("MCP probe cancelled"));
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  timer.unref();
  try {
    return await Promise.race([operation(), cancellation]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    await close().catch(() => undefined);
  }
}

const MCP_TIMEOUT_MS = 15_000;

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
