import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("systemd package", () => {
  it("pins runtime versions and hardens the service", async () => {
    const [versions, service, installer] = await Promise.all([
      readFile("packaging/versions.env", "utf8"),
      readFile("packaging/job-hunter-automation.service", "utf8"),
      readFile("packaging/install.sh", "utf8"),
    ]);

    expect(versions).toContain("NODE_MAJOR=24");
    expect(versions).toContain("CODEX_VERSION=0.147.0");
    expect(versions).toContain("PLAYWRIGHT_VERSION=1.61.0");
    for (const directive of [
      "User=job-hunter-automation",
      "NoNewPrivileges=true",
      "PrivateTmp=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "Environment=DISPLAY=:99",
      "ExecStart=/usr/bin/xvfb-run --server-num=99",
      "Restart=on-failure",
    ]) {
      expect(service).toContain(directive);
    }
    expect(installer).toContain("node_major");
    expect(installer).toContain("PLAYWRIGHT_VERSION");
    expect(installer).not.toContain("systemctl enable job-hunter-automation");
  });

  it("uses a read-only no-approval Codex profile with only required MCP servers", async () => {
    const profile = await readFile(
      "packaging/automation-canary.config.toml",
      "utf8",
    );

    expect(profile).toContain('approval_policy = "never"');
    expect(profile).toContain('sandbox_mode = "read-only"');
    expect(profile).toContain('web_search = "disabled"');
    expect(profile).toContain('bearer_token_env_var = "JOB_HUNTER_MCP_TOKEN"');
    expect(profile).toContain('enabled_tools = ["browser_preflight"]');
  });
});
