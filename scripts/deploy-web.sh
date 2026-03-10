#!/bin/bash
set -euo pipefail

SITE_DIR="/opt/celebskin/site"
LOG_DIR="/opt/celebskin/logs"

echo "=== CelebSkin Web Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting deploy..."

# Ensure log directory exists
mkdir -p "$LOG_DIR"

cd "$SITE_DIR"

# Pull latest code
echo "→ Pulling latest code..."
git pull origin main

# Install dependencies
echo "→ Installing dependencies..."
npm ci --production=false

# Build
echo "→ Building..."
npm run build

# Reload PM2 (zero-downtime)
echo "→ Reloading PM2..."
pm2 reload celebskin || pm2 start ecosystem.config.js

echo "$(date '+%Y-%m-%d %H:%M:%S') Deploy complete!"
pm2 status celebskin
