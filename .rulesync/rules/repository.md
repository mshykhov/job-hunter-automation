---
root: true
---

# Job Hunter Automation

Execution runtime for Job Hunter browser automation, deterministic health probes,
and bounded Codex canaries. This public repository contains code only; deployed
runtime state and access remain private.

## Working contract

- Keep code, comments, commits, and repository documentation in English.
- Use Conventional Commits without AI attribution or signature trailers.
- Keep every durable workflow or business record in Job Hunter API/PostgreSQL.
  This runtime may hold only transient execution state and the protected browser
  profile required for authenticated sessions.
- Never commit browser profiles, cookies, Codex authentication, tokens, passwords,
  environment files, probe payloads, prompts, model output, or captured page data.
- Treat Job Hunter API contracts as the source of truth for owner delegation,
  generation fencing, health state, and reason codes.
- Serialize every operation that can open the persistent Chrome profile.
- Fail closed on authentication challenges and unexpected page state.
- Keep probes side-effect free: health checks never read work queues, change job
  status, fill external forms, or submit applications.
- Add tests for protocol, redaction, lifecycle, retry, and timeout behavior.
- Keep `README.md` and `docs/` aligned with runtime configuration and operations.

## Commands

```sh
npm ci
npm run verify
npm run rulesync:verify
```

`.rulesync/` is canonical. Generated instruction and hook files are derived and
must not be edited directly. Start documentation work from `docs/README.md`.
