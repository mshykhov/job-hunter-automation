import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("systemd package", () => {
  it("pins patched production transitive dependencies", async () => {
    const lock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>;
    };

    expect(lock.packages["node_modules/fast-uri"]?.version).toBe("3.1.7");
    expect(lock.packages["node_modules/qs"]?.version).toBe("6.16.0");
  });

  it("bootstraps a pristine Ubuntu host at an exact repository revision", async () => {
    const [versions, bootstrap] = await Promise.all([
      readFile("packaging/versions.env", "utf8"),
      readFile("packaging/bootstrap.sh", "utf8"),
    ]);

    expect(versions).toContain("NODE_VERSION=24.19.0");
    expect(versions).toContain("NODE_LINUX_X64_SHA256=");
    expect(versions).toContain("NODE_LINUX_ARM64_SHA256=");
    expect(bootstrap).toContain("AUTOMATION_REVISION");
    expect(bootstrap).toContain(
      'fetch --depth=1 origin "$AUTOMATION_REVISION"',
    );
    expect(bootstrap).toContain("checkout --detach FETCH_HEAD");
    expect(bootstrap).toContain(
      'test "$(git -C "$checkout_root" rev-parse HEAD)" = "$AUTOMATION_REVISION"',
    );
    expect(bootstrap).toContain('"$checkout_root/packaging/install.sh"');
    expect(bootstrap).not.toContain("systemctl enable");
  });

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

  it("uses the Node binary installed by bootstrap for every runtime entrypoint", async () => {
    const [service, profile] = await Promise.all([
      readFile("packaging/job-hunter-automation.service", "utf8"),
      readFile("packaging/automation-canary.config.toml", "utf8"),
    ]);

    expect(service).toContain(
      "/usr/local/bin/node /opt/job-hunter-automation/dist/launcher.js",
    );
    expect(profile).toContain('command = "/usr/local/bin/node"');
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
