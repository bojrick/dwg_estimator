#!/usr/bin/env bash
# ==============================================================================
# Plan Vault PWA - One-Step Application Update Script
# ==============================================================================
set -euo pipefail

INSTALL_DIR="${1:-/home/ubuntu/dwg_estimator}"

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run this script with sudo or as root:"
    echo "  sudo bash $0 [install_dir]"
    exit 1
fi

echo "=============================================================================="
echo ">> Updating Plan Vault PWA in $INSTALL_DIR..."
echo "=============================================================================="

cd "$INSTALL_DIR"

# 1. Pull latest code
echo ">> Pulling latest git changes..."
git pull

# 2. Update Python dependencies if requirements changed
echo ">> Updating backend Python packages..."
cd "$INSTALL_DIR/backend"
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# 3. Build frontend
echo ">> Building frontend assets..."
cd "$INSTALL_DIR/frontend"
npm install --no-audit --no-fund
npm run build
chown -R www-data:www-data "$INSTALL_DIR/frontend/dist"

# 4. Ensure swap headroom and restart backend service
echo ">> Ensuring storage/logs directory permissions & restarting FastAPI backend service..."
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
if [ "${SWAP_MB:-0}" -lt 2048 ] && [ ! -f /swapfile ]; then
    echo ">> Provisioning 4G swapfile for LibreDWG memory spikes..."
    (
        (fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none) && \
        chmod 600 /swapfile && \
        mkswap /swapfile && \
        swapon /swapfile && \
        (grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab)
    ) || echo "WARNING: Could not configure swapfile"
fi
mkdir -p "$INSTALL_DIR/storage/logs"
chown -R planvault:www-data "$INSTALL_DIR/storage"
systemctl restart planvault

# 5. Reload Nginx
echo ">> Testing and reloading Nginx..."
nginx -t
systemctl reload nginx

echo "=============================================================================="
echo "✓ Update complete and application reloaded successfully!"
echo "=============================================================================="

