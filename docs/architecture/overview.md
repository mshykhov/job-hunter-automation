# Architecture Overview

Job Hunter Automation is an execution-only runtime. A systemd-supervised launcher
serializes heartbeat, deterministic browser/MCP preflight, bounded Codex canary
work, and API-leased synthetic recovery work. Browser Runner is a local stdio MCP
backed by Playwright and a dedicated persistent Chrome profile.

```text
systemd -> launcher -> shared runner generation -> probes / synthetic worker
                                               -> Job Hunter API -> PostgreSQL
```

The Job Hunter API owns owner delegation, generation fencing, current health,
transition history, metrics, and every future application workflow record. This
repository has no business database. Local runtime data is limited to protected
authentication and browser profile files.

The health slice is intentionally side-effect free. It proves availability of the
launcher, Chrome, Playwright, Browser Runner MCP, Job Hunter MCP, API, database, and
Codex authentication without reading work or interacting with external job sites.

The durable execution slice is also external-side-effect free. The API leases one
synthetic work item, persists ordered checkpoints and attempts, and invalidates the
lease whenever a newer runner generation starts. The runtime holds only the active
claim in memory. Process or container restart therefore resumes from the next
server-owned checkpoint rather than reconstructing state from local files.
