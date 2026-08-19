#!/usr/bin/env bash
set -euo pipefail

install_root=/opt/job-hunter-automation
state_root=/var/lib/job-hunter-automation
config_root=/etc/job-hunter-automation
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/versions.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run packaging/install.sh as root" >&2
  exit 1
fi

node_version="$(node --version)"
node_major="$(sed -E 's/^v([0-9]+).*/\1/' <<<"$node_version")"
if [[ "$node_major" != "$NODE_MAJOR" || "$node_version" != "v$NODE_VERSION" ]]; then
  echo "Node.js $NODE_VERSION is required" >&2
  exit 1
fi

id job-hunter-automation >/dev/null 2>&1 || useradd --system --home-dir "$state_root" --shell /usr/sbin/nologin job-hunter-automation
install -d -o job-hunter-automation -g job-hunter-automation -m 0750 "$state_root" "$state_root/canary-workspace"
install -d -o job-hunter-automation -g job-hunter-automation -m 0700 "$state_root/chrome-profile" "$state_root/codex"
install -d -o root -g job-hunter-automation -m 0750 "$config_root"

cd "$(dirname "$script_dir")"
npm ci
npm run verify
installed_playwright_version="$(node -p "require('./node_modules/playwright/package.json').version")"
if [[ "$installed_playwright_version" != "$PLAYWRIGHT_VERSION" ]]; then
  echo "Playwright version does not match packaging/versions.env" >&2
  exit 1
fi
npm prune --omit=dev
npm install --global "@openai/codex@$CODEX_VERSION"
npx playwright install --with-deps chrome

install -d -o root -g root -m 0755 "$install_root"
cp -a dist node_modules package.json "$install_root/"
install -o job-hunter-automation -g job-hunter-automation -m 0600 \
  "$script_dir/automation-canary.config.toml" "$state_root/codex/automation-canary.config.toml"
install -o root -g root -m 0644 "$script_dir/job-hunter-automation.service" /etc/systemd/system/job-hunter-automation.service

if [[ ! -f "$config_root/runner.env" ]]; then
  install -o root -g root -m 0600 "$script_dir/runner.env.example" "$config_root/runner.env"
fi

chown -R job-hunter-automation:job-hunter-automation "$state_root"
systemctl daemon-reload

echo "Edit $config_root/runner.env, authenticate Codex under $state_root/codex, then enable and start the service."
