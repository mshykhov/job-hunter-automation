# Job Hunter Automation

Private-runtime execution layer for [Job Hunter](https://github.com/mshykhov/job-hunter).
It runs deterministic health probes, a local Playwright-backed Browser Runner MCP,
and bounded Codex canaries. Durable state, owner policy, and audit data remain in
the Job Hunter API and PostgreSQL.

The repository is public, but deployed access is single-owner. Browser profiles,
cookies, Codex authentication, M2M credentials, prompts, model output, and captured
page data are runtime secrets and are never committed.

## Status

The first delivery slice implements health reporting only. It does not read vacancy
queues, fill external forms, or submit applications.

## Development

Requirements: Node.js 24 and npm.

```sh
npm ci
npm run verify
npm run rulesync:verify
```

Build output is written to `dist/`. See [the documentation map](docs/README.md) for
architecture, operating guidance, exact contracts, and active plans.

The production launcher is installed as one hardened systemd service. Follow the
[installation and recovery runbook](docs/runbooks/automation-service.md); the
installer deliberately leaves the service disabled until M2M credentials and the
dedicated Codex login are present.

Runtime configuration is environment-only. The required variable names and safe
local validation rules are documented in
[Runtime configuration](docs/reference/runtime-configuration.md). Credentials and
tokens remain in memory or protected deployment storage and must not be passed as
command-line arguments.

The API status and delegation endpoints are owner-only. The machine runner uses a
separate short-lived M2M identity and cannot choose an owner or access the private
web status page.

## Agent configuration

`.rulesync/` is the shared canonical source. `AGENTS.md`, `CLAUDE.md`, and target
hook configuration are generated outputs.

```sh
npm run rulesync:dry-run
npm run rulesync:generate
npm run rulesync:verify
```
