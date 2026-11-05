# Plan Vault PWA - Linux VPS & Nginx Production Deployment Guide

This guide walks you through deploying **Plan Vault PWA** (FastAPI backend + React/Vite/Tailwind frontend) on a Linux VPS (Ubuntu 22.04 / 24.04 LTS or Debian 12) with **Nginx**, automated **Let's Encrypt SSL**, performance optimizations, and security hardening.

---

## Architecture Overview

```
                          Internet (HTTPS :443)
                                    │
                                    ▼
                      ┌───────────────────────────┐
                      │    Nginx Reverse Proxy    │
                      │  - Let's Encrypt TLS 1.3  │
                      │  - Gzip Compression       │
                      │  - 1-Year Asset Caching   │
                      │  - Auth Rate Limiting     │
                      │  - 250MB Upload Capacity  │
                      └──────┬─────────────┬──────┘
                             │             │
              Static Files   │             │  Reverse Proxy
             (Vite Build)    │             │  (Keepalive)
                             ▼             ▼
               ┌───────────────────┐  ┌────────────────────────┐
               │   frontend/dist   │  │   FastAPI Service      │
               │ (React + PWA App) │  │ 127.0.0.1:8000          │
               │ (Instant updates) │  │ (Gunicorn / Uvicorn)    │
               └───────────────────┘  └───────────┬────────────┘
                                                  │
                                                  ▼
                                       ┌──────────────────────┐
                                       │ LibreDWG (dwg2dxf)   │
                                       │ Persistent Storage   │
                                       └──────────────────────┘
```

---

## Prerequisites

1. **Linux VPS**: Ubuntu 22.04 / 24.04 LTS or Debian 12 (1 vCPU, 2GB+ RAM recommended).
2. **Domain Name**: A registered domain (e.g., `plans.yourdomain.com`).
3. **DNS A Record**: Point your domain's **DNS A record** to your VPS public IPv4 address.
   - Example: `plans.yourdomain.com -> 203.0.113.50`
   - *Wait 5–15 minutes for DNS to propagate before running the SSL step.*
4. **Root or Sudo Access** to the VPS.

---

## Option A: Automated One-Command Deployment (Recommended)

Connect to your VPS via SSH and execute the following commands:

```bash
# 1. Clone repository to /opt/dwg_estimator
sudo git clone https://github.com/<your-org>/dwg_estimator.git /opt/dwg_estimator
cd /opt/dwg_estimator

# 2. Run the automated setup script
# Usage: sudo bash deploy/scripts/setup_vps.sh <your-domain> <your-email>
sudo bash deploy/scripts/setup_vps.sh plans.suvasam.group plans@suvasam.group
```

### What the automated script handles:
- Installs `nginx`, `certbot`, `python3-venv`, `nodejs` (v20 LTS), and build tools, and builds `LibreDWG` (`dwg2dxf`) from source.
- Configures **UFW firewall** (opens SSH `22`, HTTP `80`, HTTPS `443`, blocks direct FastAPI port `8000`).
- Creates a dedicated non-root system user `planvault` with proper directory permissions.
- Generates a cryptographically strong 64-character hex `AUTH_SECRET_KEY` in `backend/.env`.
- Builds the optimized frontend bundle (`npm run build`).
- Configures and enables the `planvault` **Systemd** service with 4 Gunicorn/Uvicorn workers.
- Requests and configures an **A+ rated Let's Encrypt SSL/TLS** certificate via Certbot.
- Configures static asset caching, rate limiting, and gzip compression.

---

## Option B: Manual Step-by-Step Deployment

If you prefer full control over each component, follow these steps:

### Step 1: Update System Packages & Install LibreDWG

Ubuntu 24.04+ does not provide a pre-built `libredwg` deb package in default repositories. Install dependencies and build LibreDWG from source:

```bash
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends \
    nginx \
    certbot \
    python3-certbot-nginx \
    python3-venv \
    python3-pip \
    build-essential \
    gcc \
    python3-dev \
    autoconf \
    libtool \
    swig \
    texinfo \
    curl \
    git \
    ufw

# Build and install LibreDWG from source (if dwg2dxf is not yet installed):
if ! command -v dwg2dxf >/dev/null 2>&1; then
    curl -fsSL https://ftp.gnu.org/gnu/libredwg/libredwg-0.14.tar.xz | tar -xJ /tmp/libredwg --strip-components=1 2>/dev/null || \
      git clone --depth 1 --recurse-submodules https://git.savannah.gnu.org/git/libredwg.git /tmp/libredwg
    cd /tmp/libredwg
    [ -f configure ] || sh autogen.sh
    ./configure --enable-shared --disable-static --disable-bindings
    make -j"$(nproc)"
    sudo make install
    sudo ldconfig
    cd - && rm -rf /tmp/libredwg
fi

# Verify LibreDWG conversion tool is present:
which dwg2dxf
dwg2dxf --version
# Output should show: /usr/local/bin/dwg2dxf and version 0.14
```

### Step 2: Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v # Should report v20.x.x
```

### Step 3: Create Dedicated System User & Storage

```bash
sudo useradd -r -s /bin/false -d /opt/dwg_estimator planvault
sudo usermod -a -G www-data planvault

sudo mkdir -p /opt/dwg_estimator/storage/{cloud,tmp}
sudo chown -R planvault:www-data /opt/dwg_estimator/storage
sudo chmod -R 775 /opt/dwg_estimator/storage
```

### Step 4: Configure Firewall (UFW)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 8000/tcp
sudo ufw --force enable
```

### Step 5: Configure Backend & Python Virtualenv

```bash
cd /opt/dwg_estimator/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# Copy production environment configuration
cp .env.production.example .env

# Generate high-entropy secret key
RANDOM_SECRET=$(openssl rand -hex 32)
sed -i "s|replace-with-a-secure-random-64-character-hex-secret-key|$RANDOM_SECRET|" .env
sed -i "s|yourdomain.com|plans.yourdomain.com|g" .env

# Lock down file permissions
sudo chmod 600 .env
sudo chown planvault:www-data .env
```

### Step 6: Install and Enable Systemd Service

```bash
sudo cp /opt/dwg_estimator/deploy/systemd/planvault.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable planvault
sudo systemctl start planvault

# Check service status:
sudo systemctl status planvault
# Test health endpoint:
curl http://127.0.0.1:8000/api/health
```

### Step 7: Build Frontend Production Bundle

```bash
cd /opt/dwg_estimator/frontend
npm install --no-audit --no-fund
npm run build
sudo chown -R www-data:www-data /opt/dwg_estimator/frontend/dist
```

### Step 8: Configure Nginx & Let's Encrypt SSL

1. Install security headers snippet:
```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp /opt/dwg_estimator/deploy/nginx/security-headers.conf /etc/nginx/snippets/planvault-security-headers.conf
```

2. Bootstrap HTTP configuration for ACME verification:
```bash
sudo mkdir -p /var/www/certbot
sudo sed "s|YOUR_DOMAIN|plans.yourdomain.com|g" \
    /opt/dwg_estimator/deploy/nginx/planvault-bootstrap-http.conf > /etc/nginx/sites-available/planvault

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/planvault /etc/nginx/sites-enabled/planvault
sudo nginx -t
sudo systemctl reload nginx
```

3. Obtain Let's Encrypt certificate:
```bash
sudo certbot certonly --webroot -w /var/www/certbot \
    -d plans.yourdomain.com \
    --email admin@yourdomain.com \
    --agree-tos \
    --non-interactive
```

4. Enable production SSL configuration:
```bash
sudo sed -e "s|YOUR_DOMAIN|plans.yourdomain.com|g" \
    -e "s|/opt/dwg_estimator/deploy/nginx/security-headers.conf|/etc/nginx/snippets/planvault-security-headers.conf|g" \
    /opt/dwg_estimator/deploy/nginx/planvault.conf > /etc/nginx/sites-available/planvault

sudo nginx -t
sudo systemctl reload nginx
```

---

## Production Verification & Security Audit

Run these checks to confirm all protections and optimizations are active:

### 1. SSL & Server Header Check
```bash
curl -I https://plans.yourdomain.com
```
**Expected headers**:
- `HTTP/2 200`
- `server: nginx` (Nginx version number must NOT be visible)
- `strict-transport-security: max-age=31536000; includeSubDomains`
- `x-frame-options: SAMEORIGIN`
- `x-content-type-options: nosniff`

### 2. Static Asset Caching Check
```bash
curl -I https://plans.yourdomain.com/assets/index-<hash>.js
```
**Expected**: `cache-control: public, max-age=31536000, immutable`

### 3. PWA Cache Busting Check
```bash
curl -I https://plans.yourdomain.com/sw.js
```
**Expected**: `cache-control: no-cache, no-store, must-revalidate`

### 4. Hidden & Sensitive File Blocking Check
```bash
curl -I https://plans.yourdomain.com/.env
curl -I https://plans.yourdomain.com/.git/
```
**Expected**: `HTTP/2 403 Forbidden`

### 5. Backend Health Check
```bash
curl https://plans.yourdomain.com/api/health
```
**Expected**: `{"status":"ok","service":"plan-vault-pwa","storage_backend":"local"}`

### 6. SSL Auto-Renewal Dry Run
Let's Encrypt certificates renew automatically via a systemd timer. Verify renewal works:
```bash
sudo certbot renew --dry-run
```

---

## Updating the Application

When you push new updates to git, update your VPS with zero downtime:

```bash
sudo bash /opt/dwg_estimator/deploy/scripts/update.sh
```

Or manually:
```bash
cd /opt/dwg_estimator
git pull
cd backend && .venv/bin/pip install -r requirements.txt
cd ../frontend && npm run build
sudo systemctl restart planvault
sudo systemctl reload nginx
```

---

## Troubleshooting & FAQ

### 1. `502 Bad Gateway` Error
FastAPI backend is not running or crashed.
- Check service logs: `sudo journalctl -u planvault -e --no-pager`
- Check if port 8000 is listening: `sudo ss -tulpn | grep 8000`
- Restart service: `sudo systemctl restart planvault`

### 2. `413 Request Entity Too Large`
An uploaded DWG/DXF or PDF exceeds the configured limit.
- In `/etc/nginx/sites-available/planvault`, ensure: `client_max_body_size 250M;`
- Reload Nginx: `sudo systemctl reload nginx`

### 3. DWG File Upload fails with `dwg2dxf not found`
The LibreDWG binary is missing from system PATH.
- Verify installation: `which dwg2dxf && dwg2dxf --version` (or rebuild from source via Step 1)
- Test conversion manually: `dwg2dxf -h`

### 4. `504 Gateway Timeout` on huge drawings
Parsing drawings with hundreds of thousands of CAD entities may take >60 seconds.
- In `/etc/nginx/sites-available/planvault`, ensure:
  ```nginx
  proxy_connect_timeout 60s;
  proxy_send_timeout 300s;
  proxy_read_timeout 300s;
  ```
- Reload Nginx: `sudo systemctl reload nginx`

---

## Monitoring & Service Management Cheat Sheet

| Task | Command |
|---|---|
| View Live Backend Logs | `sudo journalctl -u planvault -f` |
| View Recent Nginx Access Logs | `sudo tail -f /var/log/nginx/access.log` |
| View Nginx Error Logs | `sudo tail -f /var/log/nginx/error.log` |
| Restart Backend Service | `sudo systemctl restart planvault` |
| Test Nginx Configuration | `sudo nginx -t` |
| Reload Nginx (Zero Downtime) | `sudo systemctl reload nginx` |
| Check Firewall Status | `sudo ufw status verbose` |
| Check Memory & CPU Usage | `htop` |

