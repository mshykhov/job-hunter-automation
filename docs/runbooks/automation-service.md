# Automation Service Installation and Recovery

## Safety boundary

This slice reports health only. It does not read vacancy queues, navigate job
sites, fill forms, or submit applications. The public repository contains no
credentials. The API binds the runner identity to one configured owner; only that
owner can manage delegation or read status.

## Install

Provision a clean Ubuntu 24.04 instance. Copy `packaging/bootstrap.sh` and
`packaging/versions.env` into one temporary directory on the instance, then run
the bootstrap as root with the exact deployed commit:

```sh
AUTOMATION_REVISION=<40-character-commit-sha> ./bootstrap.sh
```

The bootstrap installs the checksum-pinned Node.js runtime, clones only the exact
requested repository revision, and invokes `packaging/install.sh`. The installer
verifies the Node.js and Playwright pins, builds and tests the runtime, installs
the pinned Codex CLI and Chrome dependencies, creates the non-login
`job-hunter-automation` account, and installs the systemd unit. Re-running the
same revision is safe. Neither script enables or starts the service.

Populate `/etc/job-hunter-automation/runner.env` without printing values and keep
it owned by root with mode `0600`. Confirm names only:

```sh
sudo stat -c '%U %G %a %n' /etc/job-hunter-automation/runner.env
sudo sed -n 's/=.*//p' /etc/job-hunter-automation/runner.env
```

Complete one-time device authentication as the service account:

```sh
sudo -u job-hunter-automation env \
  CODEX_HOME=/var/lib/job-hunter-automation/codex \
  codex login --device-auth
sudo chmod 0700 /var/lib/job-hunter-automation/codex
sudo find /var/lib/job-hunter-automation/codex -type f -exec chmod 0600 {} +
```

Then start the service:

```sh
sudo systemctl enable --now job-hunter-automation.service
sudo systemctl --no-pager --full status job-hunter-automation.service
```

## Verify

Inspect bounded lifecycle messages and service state. Logs must not contain token,
cookie, URL, prompt, model text, or browser content:

```sh
sudo journalctl -u job-hunter-automation.service --since '-10 minutes' --no-pager
```

Use the owner-only Job Hunter Automation page to verify fresh LAUNCHER, API,
DATABASE, CHROME, PLAYWRIGHT, BROWSER_MCP, JOB_HUNTER_MCP, and CODEX components.
The first heartbeat runs preflight and canary; later heartbeats reuse snapshots
until the server-issued interval expires.

## Recover

For `AUTH_REQUIRED`, stop the service, repeat the device login without displaying
`auth.json`, and restart. For Chrome or Playwright failure, stop the service before
checking the dedicated profile; never open that profile with a second Chrome
process. For M2M authentication failure, rotate the environment file atomically
and restart.

```sh
sudo systemctl stop job-hunter-automation.service
sudo systemctl start job-hunter-automation.service
```

If recovery fails, leave the service stopped and preserve
`/var/lib/job-hunter-automation` for diagnosis. Do not delete the browser profile
or Codex authentication as part of routine rollback.
