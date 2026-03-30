#!/bin/bash
set -euo pipefail

CONTABO_HOST="161.97.142.117"
CONTABO_DIR="/opt/celebskin/scripts"
LOCAL_SCRIPTS="scripts/"

echo "=== CelebSkin Pipeline Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S') Deploying scripts to Contabo..."

# Sync scripts to Contabo
rsync -avz --delete \
  "$LOCAL_SCRIPTS" \
  "root@${CONTABO_HOST}:${CONTABO_DIR}/" \
  --exclude=tmp \
  --exclude=node_modules \
  --exclude=.env \
  --exclude=logs \
  --exclude='*.log'

# Install dependencies on Contabo
echo "→ Installing dependencies on Contabo..."
ssh "root@${CONTABO_HOST}" "cd ${CONTABO_DIR} && npm install --production"

echo "$(date '+%Y-%m-%d %H:%M:%S') Pipeline deploy complete!"
