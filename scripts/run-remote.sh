#!/bin/bash
# Run a pipeline script on Contabo in the background
# Usage: ./run-remote.sh <script.js> [args...]

CONTABO="root@161.97.142.117"
SSH_KEY="/root/.ssh/id_ed25519"
SCRIPTS_DIR="/opt/celebskin/scripts"
LOG_FILE="${SCRIPTS_DIR}/logs/pipeline.log"

SCRIPT="$1"
shift
ARGS="$*"

if [ -z "$SCRIPT" ]; then
    echo '{"error":"No script specified"}'
    exit 1
fi

ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "$SSH_KEY" "$CONTABO" \
    "cd $SCRIPTS_DIR && nohup node $SCRIPT $ARGS >> $LOG_FILE 2>&1 &" </dev/null >/dev/null 2>&1

echo '{"success":true}'
