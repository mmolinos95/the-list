#!/usr/bin/env bash
# Builds the bot and copies it to the VM, then restarts the service.
# Run from anywhere on your computer (needs gcloud logged in to the club account):
#
#   bot/deploy/upload.sh          # code only
#   bot/deploy/upload.sh --env    # also copy bot/.env (first time, or after changing a setting)
#
# VM and ZONE can be overridden: VM=listbot ZONE=us-east1-b bot/deploy/upload.sh
set -euo pipefail

VM="${VM:-listbot}"
ZONE="${ZONE:-us-east1-b}"
BOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BOT"

npm ci
npm run build

TARBALL="$(mktemp -d)/listbot.tgz"
tar czf "$TARBALL" dist package.json package-lock.json deploy/listbot.service
gcloud compute scp "$TARBALL" "$VM:/tmp/listbot.tgz" --zone "$ZONE"

if [ "${1:-}" = "--env" ]; then
  [ -f .env ] || { echo "No bot/.env to upload. Copy bot/.env.example to bot/.env and fill it in." >&2; exit 1; }
  gcloud compute scp .env "$VM:/tmp/listbot.env" --zone "$ZONE"
fi

gcloud compute ssh "$VM" --zone "$ZONE" -- bash -s <<'REMOTE'
set -euo pipefail
sudo tar xzf /tmp/listbot.tgz -C /opt/listbot
rm -f /tmp/listbot.tgz
if [ -f /tmp/listbot.env ]; then
  sudo install -o listbot -g listbot -m 600 /tmp/listbot.env /opt/listbot/.env
  rm -f /tmp/listbot.env
fi
sudo chown -R listbot:listbot /opt/listbot
cd /opt/listbot
sudo -u listbot -H npm ci --omit=dev --no-audit --no-fund
sudo install -m 644 /opt/listbot/deploy/listbot.service /etc/systemd/system/listbot.service
sudo systemctl daemon-reload
sudo systemctl enable listbot >/dev/null
if [ -d /opt/listbot/data/auth ]; then
  sudo systemctl restart listbot
  sleep 5
  sudo systemctl --no-pager status listbot | head -n 5
else
  echo "Uploaded. WhatsApp isn't linked on the VM yet; see bot/README.md, \"Link WhatsApp on the VM\"."
fi
REMOTE
