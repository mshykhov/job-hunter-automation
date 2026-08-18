# Documentation

This directory is the entry point for Job Hunter Automation documentation.

## Map

- [Schema and maintenance rules](SCHEMA.md)
- [Architecture](architecture/index.md)
- [Decisions](decisions/README.md)
- [Plans](plans/README.md)
- [Runbooks](runbooks/README.md)
- [Reference](reference/README.md)
- [Reviews](reviews/README.md)

Architecture, runbooks, and reference documents are living documentation. Decisions
and reviews are snapshots. Plans are living while active and snapshots after
completion.

## Maintenance

| Change                                             | Documentation to review           |
| -------------------------------------------------- | --------------------------------- |
| Runtime component or data flow                     | `architecture/overview.md`        |
| Environment variable, protocol, or reason code     | `reference/` and root `README.md` |
| Installation, authentication, or recovery behavior | `runbooks/`                       |
| Material architecture choice                       | `decisions/`                      |
| Delivery scope or verification evidence            | active document in `plans/`       |
| Agent configuration                                | `.rulesync/` and root `README.md` |
