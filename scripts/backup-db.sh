#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/celebskin/backups"
DB_NAME="celebskin"
DB_USER="celebskin"
DB_HOST="127.0.0.1"
RETENTION_DAYS=7
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"

# Load password from .env.local if not already set
if [ -z "${PGPASSWORD:-}" ]; then
  ENV_FILE="/opt/celebskin/site/.env.local"
  if [ -f "$ENV_FILE" ]; then
    export PGPASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
  fi
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting backup..."

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Create compressed backup via TCP connection
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$BACKUP_FILE"

# Check backup was created and is non-empty
if [ ! -s "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file is empty or missing!"
  exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# Delete backups older than retention period
DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -type f -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "Cleaned up $DELETED old backups (retention: ${RETENTION_DAYS} days)"

# List current backups
echo "Current backups:"
ls -lh "$BACKUP_DIR"/${DB_NAME}_*.dump 2>/dev/null || echo "  (none)"

echo "$(date '+%Y-%m-%d %H:%M:%S') Backup complete!"
