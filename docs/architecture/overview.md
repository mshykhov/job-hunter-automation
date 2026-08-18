# Architecture Overview

Job Hunter Automation is an execution-only runtime. A systemd-supervised launcher
serializes heartbeat, deterministic browser/MCP preflight, and bounded Codex canary
work. Browser Runner is a local stdio MCP backed by Playwright and a dedicated
persistent Chrome profile.

```text
systemd -> launcher -> probes and codex exec -> Job Hunter API -> PostgreSQL
```

The Job Hunter API owns owner delegation, generation fencing, current health,
transition history, metrics, and every future application workflow record. This
repository has no business database. Local runtime data is limited to protected
authentication and browser profile files.

The first slice is intentionally side-effect free. It proves availability of the
launcher, Chrome, Playwright, Browser Runner MCP, Job Hunter MCP, API, database, and
Codex authentication without reading work or interacting with external job sites.
