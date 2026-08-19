# Codex Readiness Canary

The launcher runs a minimal non-interactive Codex command at the interval issued
by the Job Hunter API. The command uses the `automation-canary` profile, an
ephemeral session, a read-only sandbox, no approvals, disabled web search, and the
fixed prompt `Return exactly AUTOMATION_CANARY_READY. Do not call tools.`

The parser accepts JSONL in memory with a 64 KiB per-line limit. Success requires
the exact marker and a completed turn. Only state, allowlisted reason, token counts,
and duration enter the heartbeat. Prompt text, model output, thread identifiers,
tool payloads, and stderr are never persisted or logged.

The child runs in a detached process group. A two-minute timeout, SIGTERM, or
SIGINT terminates the group, including any MCP subprocess, and reports the bounded
`CANARY_FAILED` reason. Authentication failures map to
`CODEX_AUTH_REQUIRED` without retaining the provider error.

The checked-in profile is
`packaging/automation-canary.config.toml`. Runtime authentication stays under the
protected `CODEX_HOME`; it is not part of the repository or deployment package.
