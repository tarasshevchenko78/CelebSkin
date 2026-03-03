#!/bin/bash
# Run a pipeline script on Contabo in the background
# Usage: ./run-remote.sh <script.js> [args...]

# Force clean SSH environment (PM2 may have stale agent socket)
export HOME=/root
unset SSH_AUTH_SOCK
unset SSH_AGENT_PID

CONTABO="root@161.97.142.117"
SSH_KEY="/root/.ssh/id_ed25519"
SSH_BIN="/usr/bin/ssh"
SCRIPTS_DIR="/opt/celebskin/scripts"
LOG_FILE="${SCRIPTS_DIR}/logs/pipeline.log"

SCRIPT="$1"
shift
ARGS="$*"

if [ -z "$SCRIPT" ]; then
    echo '{"success":false,"error":"No script specified"}'
    exit 1
fi

# Use temp file for stderr (command substitution $() would hang waiting for backgrounded process)
SSH_ERR_FILE=$(mktemp)

$SSH_BIN -f -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "$SSH_KEY" "$CONTABO" \
    "cd $SCRIPTS_DIR && nohup node $SCRIPT $ARGS >> $LOG_FILE 2>&1 </dev/null" \
    </dev/null 2>"$SSH_ERR_FILE"

SSH_EXIT=$?

if [ $SSH_EXIT -ne 0 ]; then
    SAFE_ERR=$(cat "$SSH_ERR_FILE" | tr '\n' ' ' | sed 's/"/\\"/g')
    rm -f "$SSH_ERR_FILE"
    echo "{\"success\":false,\"error\":\"SSH failed (exit $SSH_EXIT): $SAFE_ERR\"}"
    exit 1
fi

rm -f "$SSH_ERR_FILE"
echo '{"success":true}'
