import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { JobHunterClient } from "./api/job-hunter-client.js";
import { AuthentikTokenProvider } from "./api/token-provider.js";
import { runCodexCanary } from "./codex/codex-probe.js";
import { loadConfig } from "./config.js";
import { CodexMaterialGenerator } from "./materials/codex-generator.js";
import { MaterialWorker } from "./materials/material-worker.js";
import { MaterialRenderer } from "./materials/renderer.js";
import { probeBrowserRunner, probeJobHunterMcp } from "./probes/mcp-probe.js";
import { runPreflight } from "./probes/preflight.js";
import { RuntimeHealthCollector } from "./runner/health-collector.js";
import { HeartbeatLoop } from "./runner/heartbeat-loop.js";

export interface SignalSource {
  on(signal: NodeJS.Signals, handler: () => void): void;
  off(signal: NodeJS.Signals, handler: () => void): void;
}

const PROCESS_SIGNALS: SignalSource = {
  on: (signal, handler) => {
    process.on(signal, handler);
  },
  off: (signal, handler) => {
    process.off(signal, handler);
  },
};

export class AutomationLauncher {
  constructor(
    private readonly run: (signal: AbortSignal) => Promise<void>,
    private readonly close: () => Promise<void>,
    private readonly signals: SignalSource = PROCESS_SIGNALS,
  ) {}

  async start(): Promise<void> {
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
    };
    this.signals.on("SIGTERM", stop);
    this.signals.on("SIGINT", stop);
    const active = this.run(controller.signal);
    try {
      await Promise.race([
        active,
        aborted(controller.signal).then(() =>
          Promise.race([active, delay(SHUTDOWN_GRACE_MS)]),
        ),
      ]);
    } finally {
      controller.abort();
      await this.close();
      this.signals.off("SIGTERM", stop);
      this.signals.off("SIGINT", stop);
    }
  }
}

export function createAutomationLauncher(
  env: NodeJS.ProcessEnv = process.env,
): AutomationLauncher {
  const config = loadConfig(env);
  const tokenProvider = new AuthentikTokenProvider(config);
  const client = new JobHunterClient(config.apiUrl, tokenProvider);
  const browserRunnerPath = fileURLToPath(
    new URL("./browser-runner/server.js", import.meta.url),
  );
  const collector = new RuntimeHealthCollector({
    getToken: () => tokenProvider.getAccessToken(),
    runPreflight: (token, previous, signal) =>
      runPreflight(
        {
          browserRunner: () =>
            probeBrowserRunner(
              browserRunnerPath,
              config.browserProfileDir,
              signal,
            ),
          jobHunterMcp: () =>
            probeJobHunterMcp(`${config.apiUrl}/mcp`, token, signal),
        },
        previous,
      ),
    runCodex: (token, signal) =>
      runCodexCanary(
        {
          codexHome: config.codexHome,
          workspace: CANARY_WORKSPACE,
          jobHunterMcpToken: token,
          timeoutMs: CODEX_TIMEOUT_MS,
          browserProfileDir: config.browserProfileDir,
          ...(env.DISPLAY === undefined ? {} : { display: env.DISPLAY }),
        },
        undefined,
        signal,
      ),
  });
  const loop = new HeartbeatLoop(client, (session, signal) =>
    collector.collect(session, signal),
  );
  const materialWorker =
    config.materials === undefined
      ? undefined
      : new MaterialWorker(
          {
            workerId: config.materials.workerId,
            workRoot: config.materials.workRoot,
            pollIntervalMs: config.materials.pollIntervalMs,
            leaseHeartbeatMs: config.materials.leaseHeartbeatMs,
            baseDocxPath: config.materials.baseDocxPath,
            basePdfPath: config.materials.basePdfPath,
            profileManifestPath: config.materials.profileManifestPath,
            candidateProfilePath: config.materials.candidateProfilePath,
            factCatalogPath: config.materials.factCatalogPath,
            writingStylePath: config.materials.writingStylePath,
          },
          client,
          new CodexMaterialGenerator({
            codexHome: config.codexHome,
            outputSchemaPath: config.materials.outputSchemaPath,
            timeoutMs: config.materials.generationTimeoutMs,
          }),
          new MaterialRenderer({
            command: config.materials.rendererCommand,
            profilePath: config.materials.cvProfilePath,
            timeoutMs: config.materials.renderTimeoutMs,
          }),
        );
  return new AutomationLauncher(
    async (signal) => {
      await Promise.all([
        loop.run(signal),
        ...(materialWorker === undefined ? [] : [materialWorker.run(signal)]),
      ]);
    },
    () => Promise.resolve(),
  );
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

const SHUTDOWN_GRACE_MS = 10_000;
const CODEX_TIMEOUT_MS = 120_000;
const CANARY_WORKSPACE = "/var/lib/job-hunter-automation/canary-workspace";

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  createAutomationLauncher()
    .start()
    .catch(() => {
      process.stderr.write("Automation launcher failed\n");
      process.exitCode = 1;
    });
}
