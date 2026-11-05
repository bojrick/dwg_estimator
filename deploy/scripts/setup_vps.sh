#!/usr/bin/env bash
# ==============================================================================
# Plan Vault PWA - Automated Linux VPS Deployment & Hardening Script
# Compatible with: Ubuntu 22.04 / 24.04 LTS, Debian 12
# ==============================================================================
set -euo pipefail

# Check root privileges
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run this script with sudo or as root:"
    echo "  sudo bash $0 <domain> <email> [install_dir]"
    exit 1
fi

DOMAIN="${1:-}"
EMAIL="${2:-}"
INSTALL_DIR="${3:-/opt/dwg_estimator}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: sudo bash $0 <domain> <certbot_email> [install_dir]"
    echo "Example: sudo bash $0 plans.example.com admin@example.com"
    exit 1
fi

echo "=============================================================================="
echo ">> Starting Plan Vault VPS Setup for domain: $DOMAIN"
echo ">> Installation Directory: $INSTALL_DIR"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# 1. System Package Updates & Dependencies
# ------------------------------------------------------------------------------
echo ">> [1/8] Updating package lists and installing core dependencies..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    nginx \
    certbot \
    python3-certbot-nginx \
    libredwg-tools \
    python3-venv \
    python3-pip \
    build-essential \
    curl \
    git \
    ufw \
    ca-certificates

# Verify LibreDWG binary is in PATH
if ! command -v dwg2dxf >/dev/null 2>&1; then
    echo "ERROR: LibreDWG 'dwg2dxf' binary not found after package installation."
    exit 1
fi
echo "✓ LibreDWG dwg2dxf found at: $(command -v dwg2dxf)"

# ------------------------------------------------------------------------------
# 2. Node.js LTS Setup (if not installed or version < 18)
# ------------------------------------------------------------------------------
echo ">> [2/8] Checking Node.js runtime..."
NEED_NODE=false
if ! command -v node >/dev/null 2>&1; then
    NEED_NODE=true
else
    NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        NEED_NODE=true
    fi
fi

if [ "$NEED_NODE" = true ]; then
    echo "Installing Node.js 20 LTS from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "✓ Node.js $(node -v) & npm $(npm -v) ready"

# ------------------------------------------------------------------------------
# 3. Dedicated System User & Directory Permissions
# ------------------------------------------------------------------------------
echo ">> [3/8] Setting up dedicated system user 'planvault'..."
if ! id -u planvault >/dev/null 2>&1; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" planvault
fi
usermod -a -G www-data planvault

mkdir -p "$INSTALL_DIR/storage"
mkdir -p "$INSTALL_DIR/storage/cloud"
mkdir -p "$INSTALL_DIR/storage/tmp"
mkdir -p /var/www/certbot

chown -R planvault:www-data "$INSTALL_DIR/storage"
chmod -R 775 "$INSTALL_DIR/storage"

# ------------------------------------------------------------------------------
# 4. Firewall Hardening (UFW)
# ------------------------------------------------------------------------------
echo ">> [4/8] Configuring UFW firewall rules..."
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP Nginx'
ufw allow 443/tcp comment 'HTTPS Nginx'
# Ensure backend port 8000 is NOT exposed publicly
ufw deny 8000/tcp comment 'Block Direct FastAPI Access' || true
ufw --force enable
echo "✓ Firewall active: only 22, 80, and 443 permitted"

# ------------------------------------------------------------------------------
# 5. Backend Virtual Environment & Environment Config
# ------------------------------------------------------------------------------
echo ">> [5/8] Setting up backend Python virtual environment..."
cd "$INSTALL_DIR/backend"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# Create .env from template if missing
if [ ! -f ".env" ]; then
    echo "Creating .env from .env.production.example..."
    cp .env.production.example .env
    RANDOM_SECRET=$(openssl rand -hex 32)
    sed -i "s|replace-with-a-secure-random-64-character-hex-secret-key|$RANDOM_SECRET|" .env
    sed -i "s|yourdomain.com|$DOMAIN|g" .env
    sed -i "s|/opt/dwg_estimator|$INSTALL_DIR|g" .env
    chmod 600 .env
    chown planvault:www-data .env
    echo "✓ Generated random AUTH_SECRET_KEY in backend/.env"
fi

# ------------------------------------------------------------------------------
# 6. Frontend Production Build
# ------------------------------------------------------------------------------
echo ">> [6/8] Building frontend production bundle..."
cd "$INSTALL_DIR/frontend"
npm install --no-audit --no-fund
npm run build
chown -R www-data:www-data "$INSTALL_DIR/frontend/dist"

# ------------------------------------------------------------------------------
# 7. Systemd Service Installation
# ------------------------------------------------------------------------------
echo ">> [7/8] Installing and starting Systemd service..."
sed "s|/opt/dwg_estimator|$INSTALL_DIR|g" \
    "$INSTALL_DIR/deploy/systemd/planvault.service" > /etc/systemd/system/planvault.service

systemctl daemon-reload
systemctl enable planvault
systemctl restart planvault

# Wait for backend to come up
sleep 3
if curl -s http://127.0.0.1:8000/api/health >/dev/null; then
    echo "✓ Backend FastAPI is healthy on 127.0.0.1:8000"
else
    echo "WARNING: Backend health check failed. Review logs with: journalctl -u planvault -e"
fi

# ------------------------------------------------------------------------------
# 8. Nginx & Let's Encrypt SSL Configuration
# ------------------------------------------------------------------------------
echo ">> [8/8] Configuring Nginx reverse proxy & SSL certificates..."
mkdir -p /etc/nginx/snippets
cp "$INSTALL_DIR/deploy/nginx/security-headers.conf" /etc/nginx/snippets/planvault-security-headers.conf

# Step 8A: Bootstrap HTTP to allow ACME challenge
sed -e "s|YOUR_DOMAIN|$DOMAIN|g" \
    -e "s|/opt/dwg_estimator|$INSTALL_DIR|g" \
    "$INSTALL_DIR/deploy/nginx/planvault-bootstrap-http.conf" > /etc/nginx/sites-available/planvault

# Remove default site if present
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/planvault /etc/nginx/sites-enabled/planvault
nginx -t
systemctl reload nginx

# Step 8B: Request Let's Encrypt SSL Certificate
echo "Requesting Let's Encrypt SSL certificate for $DOMAIN..."
certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive

# Step 8C: Switch to production hardened SSL configuration
sed -e "s|YOUR_DOMAIN|$DOMAIN|g" \
    -e "s|/opt/dwg_estimator|$INSTALL_DIR|g" \
    -e "s|/opt/dwg_estimator/deploy/nginx/security-headers.conf|/etc/nginx/snippets/planvault-security-headers.conf|g" \
    "$INSTALL_DIR/deploy/nginx/planvault.conf" > /etc/nginx/sites-available/planvault

nginx -t
systemctl reload nginx

echo "=============================================================================="
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "Your application is live at: https://$DOMAIN"
echo ""
echo "Useful Commands:"
echo "  Check backend service:  sudo systemctl status planvault"
echo "  View backend logs:      sudo journalctl -u planvault -f"
echo "  Test SSL auto-renewal:  sudo certbot renew --dry-run"
echo "  Reload Nginx:           sudo systemctl reload nginx"
echo "=============================================================================="

