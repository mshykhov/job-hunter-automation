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

| Variable                     | Default | Purpose                          |
| ---------------------------- | ------: | -------------------------------- |
| `HEARTBEAT_INTERVAL_SECONDS` |    `60` | Health-report interval           |
| `PREFLIGHT_INTERVAL_SECONDS` |   `300` | Deterministic preflight interval |
| `CODEX_INTERVAL_SECONDS`     | `21600` | Bounded Codex canary interval    |

The server-issued session intervals remain authoritative after a runner session is
created. Heartbeat retries preserve generation, sequence, and idempotency key while
refreshing `sentAt` so bounded retry backoff remains inside the API clock-skew
contract.

## Authentication request

The token provider sends an `application/x-www-form-urlencoded` client-credentials
request with the fixed `profile job-hunter-api` scope. It caches the access token
until 120 seconds before expiry and clears the cache on an API `401`. Authorization,
password, token, and cookie fields are recursively redacted from structured logs.
