#!/usr/bin/env bash
# One-time setup of the bot's VM: Ubuntu 24.04 on a Google Cloud e2-micro
# (free tier, us-east1). Run it ON the VM, once:
#
#   gcloud compute scp bot/deploy/setup.sh listbot:/tmp/setup.sh --zone us-east1-b
#   gcloud compute ssh listbot --zone us-east1-b -- sudo bash /tmp/setup.sh
#
# Installs Node 24, adds 1 GB of swap (the e2-micro has 1 GB of RAM), and
# creates the `listbot` user that owns /opt/listbot. Safe to run again.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi

# Swap
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node 24 (NodeSource)
apt-get update
apt-get install -y ca-certificates curl gnupg
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Security updates install themselves.
apt-get install -y unattended-upgrades

# The bot's user and folder. data/ holds the WhatsApp login and the local
# database of linked members: personal data, readable by listbot only.
id listbot >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/listbot --shell /usr/sbin/nologin listbot
install -d -o listbot -g listbot -m 755 /opt/listbot
install -d -o listbot -g listbot -m 700 /opt/listbot/data

echo
echo "Done. Node $(node --version). Next, from your computer: bot/deploy/upload.sh --env"
