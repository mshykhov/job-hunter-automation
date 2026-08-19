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
  };
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
