# Browser Runner MCP

Browser Runner is a local stdio MCP server. It opens Chrome with the configured
dedicated `BROWSER_PROFILE_DIR`, `channel: "chrome"`, `headless: false`, and a
`1280x900` viewport. The operating system's default Chrome profile is rejected.

## V1 tool contract

The server exposes exactly one side-effect-free tool:

```text
browser_preflight({})
```

The tool writes a fixed local HTML marker into a new page, verifies Playwright can
read it, closes that page, and keeps the persistent context open until the stdio
session ends. It cannot navigate, inspect external content, fill forms, upload
files, or submit actions.

The structured result contains only:

```text
component: CHROME | PLAYWRIGHT
state: READY | DEGRADED | UNAVAILABLE
reason: NONE | CHROME_UNAVAILABLE | PLAYWRIGHT_UNAVAILABLE
checkedAt: ISO-8601 timestamp
durationMs: non-negative number
probeVersion: semantic version
```

Browser Runner failures never include exception text, page content, cookies,
profile paths, or credentials. The launcher checks `initialize`, advertised tools
capability, and `tools/list`, then closes the MCP client in all outcomes.
