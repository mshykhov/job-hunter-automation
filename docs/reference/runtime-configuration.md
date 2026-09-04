# Runtime Configuration

The launcher reads configuration from environment variables. It validates values
without logging them and keeps access tokens in memory only.

## Required variables

| Variable                   | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `JOB_HUNTER_API_URL`       | Job Hunter API base URL                                    |
| `AUTHENTIK_TOKEN_URL`      | Authentik OAuth token endpoint                             |
| `AUTOMATION_M2M_CLIENT_ID` | Dedicated automation client identifier                     |
| `AUTOMATION_M2M_USERNAME`  | Dedicated automation service identity                      |
| `AUTOMATION_M2M_PASSWORD`  | Dedicated automation service credential                    |
| `BROWSER_PROFILE_DIR`      | Protected persistent Chrome profile directory              |
| `CODEX_HOME`               | Protected Codex authentication and configuration directory |

Remote API and token URLs must use HTTPS. Loopback HTTP URLs are accepted only for
local tests.

## Optional intervals

| Variable                     | Default | Purpose                                     |
| ---------------------------- | ------: | ------------------------------------------- |
| `HEARTBEAT_INTERVAL_SECONDS` |    `60` | Health-report interval                      |
| `PREFLIGHT_INTERVAL_SECONDS` |   `300` | Deterministic preflight interval            |
| `CODEX_INTERVAL_SECONDS`     | `21600` | Bounded Codex canary interval               |
| `HEALTH_REPORTING_ENABLED`   |  `true` | Run health, preflight, and canary reporting |

The server-issued session intervals remain authoritative after a runner session is
created. Heartbeat retries preserve generation, sequence, and idempotency key while
refreshing `sentAt` so bounded retry backoff remains inside the API clock-skew
contract.

Set `HEALTH_REPORTING_ENABLED=false` only when another capability is enabled. At
least one of health reporting, the synthetic workflow worker, or the material
compiler must be enabled.

## Durable synthetic workflow worker

Set `WORKFLOW_WORKER_ENABLED=true` after the API version with durable workflow
contracts is deployed. The worker shares one fenced runner session with health
reporting and stores no workflow state locally.

| Variable                    |  Default | Purpose                                 |
| --------------------------- | -------: | --------------------------------------- |
| `WORKFLOW_WORKER_ID`        | required | Stable lease-worker identifier          |
| `WORKFLOW_POLL_INTERVAL_MS` |   `2000` | Empty-queue poll interval               |
| `WORKFLOW_STEP_DELAY_MS`    |   `1000` | Deterministic recovery-drill step delay |

Each claim contains the first incomplete step. The worker heartbeats before a
step, submits a deterministic SHA-256 checkpoint with a stable UUID, and retries a
lost checkpoint response without rerunning the step. A stale generation opens one
new shared session; a revoked or expired lease stops the attempt immediately.

## Application-material compiler

Set `MATERIALS_ENABLED=true` only on the private runner after installing the CV renderer. The runner
imports and activates the configured immutable profile bundle before it starts polling for work.

| Variable                           |  Default | Purpose                                        |
| ---------------------------------- | -------: | ---------------------------------------------- |
| `MATERIALS_WORKER_ID`              | required | Stable lease-worker identifier                 |
| `MATERIALS_WORK_ROOT`              | required | Private ephemeral compilation directory        |
| `MATERIALS_RENDERER_COMMAND`       | required | Absolute `cv-materials-render` executable path |
| `MATERIALS_CV_PROFILE_PATH`        | required | Profile catalog matching the imported version  |
| `MATERIALS_BASE_DOCX_PATH`         | required | Validated fallback DOCX                        |
| `MATERIALS_BASE_PDF_PATH`          | required | Validated fallback PDF                         |
| `MATERIALS_PROFILE_MANIFEST_PATH`  | required | Immutable profile bundle manifest              |
| `MATERIALS_CANDIDATE_PROFILE_PATH` | required | Candidate profile JSON                         |
| `MATERIALS_FACT_CATALOG_PATH`      | required | Approved fact catalog JSON                     |
| `MATERIALS_WRITING_STYLE_PATH`     | required | Owner writing-style examples                   |
| `MATERIALS_OUTPUT_SCHEMA_PATH`     | required | Pinned Codex structured-output schema          |
| `MATERIALS_POLL_INTERVAL_MS`       |  `15000` | Queue poll interval                            |
| `MATERIALS_LEASE_HEARTBEAT_MS`     |  `60000` | Active lease heartbeat interval                |
| `MATERIALS_GENERATION_TIMEOUT_MS`  | `180000` | Per-model generation timeout                   |
| `MATERIALS_RENDER_TIMEOUT_MS`      | `120000` | Isolated CV render timeout                     |

The worker polls without generating anything until the owner explicitly creates a material request.
It uses the existing Codex subscription login: Terra handles standard requests, while Sol runs only
for an explicit owner-requested improvement. It never submits an application.

## Authentication request

The token provider sends an `application/x-www-form-urlencoded` client-credentials
request with the fixed `profile job-hunter-api` scope. It caches the access token
until 120 seconds before expiry and clears the cache on an API `401`. Authorization,
password, token, and cookie fields are recursively redacted from structured logs.
