# Documentation Schema

Repository documentation uses English Markdown and relative links. File names are
lowercase kebab-case except required section indexes and this schema.

The source-of-truth order is executable tests and schemas, runtime configuration,
living documentation, then historical decisions and reviews. When behavior changes,
update its living documentation in the same commit.

Section indexes list every document in their directory and state whether the section
is living or snapshot material. Decision and review files use an ISO date prefix.
Plans use an ISO date prefix and record status plus verification evidence.

Secrets, personal identifiers, browser content, prompts, model output, and operational
tokens never belong in documentation. Examples use variable names and bounded wire
values only.
