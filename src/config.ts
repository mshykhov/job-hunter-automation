const REQUIRED_ENV_NAMES = [
  "JOB_HUNTER_API_URL",
  "AUTHENTIK_TOKEN_URL",
  "AUTOMATION_M2M_CLIENT_ID",
  "AUTOMATION_M2M_USERNAME",
  "AUTOMATION_M2M_PASSWORD",
  "BROWSER_PROFILE_DIR",
  "CODEX_HOME",
] as const;

export interface AutomationConfig {
  apiUrl: string;
  tokenUrl: string;
  m2mClientId: string;
  m2mUsername: string;
  m2mPassword: string;
  browserProfileDir: string;
  codexHome: string;
  intervals: {
    heartbeatSeconds: number;
    preflightSeconds: number;
    codexSeconds: number;
  };
  materials?: MaterialAutomationConfig;
}

export interface MaterialAutomationConfig {
  workerId: string;
  workRoot: string;
  rendererCommand: string;
  cvProfilePath: string;
  baseDocxPath: string;
  basePdfPath: string;
  outputSchemaPath: string;
  pollIntervalMs: number;
  leaseHeartbeatMs: number;
  generationTimeoutMs: number;
  renderTimeoutMs: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AutomationConfig {
  const values = Object.fromEntries(
    REQUIRED_ENV_NAMES.map((name) => {
      const value = env[name]?.trim();
      if (!value)
        throw new Error(`Missing required environment variable: ${name}`);
      return [name, value];
    }),
  );

  const apiUrl = requireSecureUrl(
    values.JOB_HUNTER_API_URL ?? "",
    "JOB_HUNTER_API_URL",
  );
  const tokenUrl = requireSecureUrl(
    values.AUTHENTIK_TOKEN_URL ?? "",
    "AUTHENTIK_TOKEN_URL",
  );

  const materials =
    env.MATERIALS_ENABLED?.trim().toLowerCase() === "true"
      ? loadMaterialsConfig(env)
      : undefined;
  return {
    apiUrl,
    tokenUrl,
    m2mClientId: values.AUTOMATION_M2M_CLIENT_ID ?? "",
    m2mUsername: values.AUTOMATION_M2M_USERNAME ?? "",
    m2mPassword: values.AUTOMATION_M2M_PASSWORD ?? "",
    browserProfileDir: values.BROWSER_PROFILE_DIR ?? "",
    codexHome: values.CODEX_HOME ?? "",
    intervals: {
      heartbeatSeconds: positiveInteger(
        env.HEARTBEAT_INTERVAL_SECONDS,
        60,
        "HEARTBEAT_INTERVAL_SECONDS",
      ),
      preflightSeconds: positiveInteger(
        env.PREFLIGHT_INTERVAL_SECONDS,
        300,
        "PREFLIGHT_INTERVAL_SECONDS",
      ),
      codexSeconds: positiveInteger(
        env.CODEX_INTERVAL_SECONDS,
        21_600,
        "CODEX_INTERVAL_SECONDS",
      ),
    },
    ...(materials === undefined ? {} : { materials }),
  };
}

function loadMaterialsConfig(env: NodeJS.ProcessEnv): MaterialAutomationConfig {
  return {
    workerId: required(env, "MATERIALS_WORKER_ID"),
    workRoot: required(env, "MATERIALS_WORK_ROOT"),
    rendererCommand: required(env, "MATERIALS_RENDERER_COMMAND"),
    cvProfilePath: required(env, "MATERIALS_CV_PROFILE_PATH"),
    baseDocxPath: required(env, "MATERIALS_BASE_DOCX_PATH"),
    basePdfPath: required(env, "MATERIALS_BASE_PDF_PATH"),
    outputSchemaPath: required(env, "MATERIALS_OUTPUT_SCHEMA_PATH"),
    pollIntervalMs: positiveInteger(
      env.MATERIALS_POLL_INTERVAL_MS,
      15_000,
      "MATERIALS_POLL_INTERVAL_MS",
    ),
    leaseHeartbeatMs: positiveInteger(
      env.MATERIALS_LEASE_HEARTBEAT_MS,
      60_000,
      "MATERIALS_LEASE_HEARTBEAT_MS",
    ),
    generationTimeoutMs: positiveInteger(
      env.MATERIALS_GENERATION_TIMEOUT_MS,
      180_000,
      "MATERIALS_GENERATION_TIMEOUT_MS",
    ),
    renderTimeoutMs: positiveInteger(
      env.MATERIALS_RENDER_TIMEOUT_MS,
      120_000,
      "MATERIALS_RENDER_TIMEOUT_MS",
    ),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requireSecureUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS unless it points to loopback`);
  }
  return value.replace(/\/$/, "");
}

function positiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}
