#!/bin/bash
# Run a pipeline script on Contabo in the background
# Usage: ./run-remote.sh [--action=NAME] <script.js> [args...]

# Force clean SSH environment (PM2 may have stale agent socket)
export HOME=/root
unset SSH_AUTH_SOCK
unset SSH_AGENT_PID

CONTABO="root@161.97.142.117"
SSH_KEY="/root/.ssh/id_ed25519"
SSH_BIN="/usr/bin/ssh"
SCRIPTS_DIR="/opt/celebskin/scripts"
LOG_FILE="${SCRIPTS_DIR}/logs/pipeline.log"

# Parse --action=NAME if present
ACTION=""
if [[ "$1" == --action=* ]]; then
    ACTION="${1#--action=}"
    shift
fi

SCRIPT="$1"
shift
ARGS="$*"

if [ -z "$SCRIPT" ]; then
    echo '{"success":false,"error":"No script specified"}'
    exit 1
fi

# Derive action name from script if not provided
if [ -z "$ACTION" ]; then
    case "$SCRIPT" in
        scrape-boobsradar.js) ACTION="scrape" ;;
        process-with-ai.js)   ACTION="ai-process" ;;
        enrich-metadata.js)   ACTION="tmdb-enrich" ;;
        watermark.js)         ACTION="watermark" ;;
        generate-thumbnails.js) ACTION="thumbnails" ;;
        upload-to-cdn.js)     ACTION="cdn-upload" ;;
        publish-to-site.js)   ACTION="publish" ;;
        run-pipeline.js)      ACTION="full-pipeline" ;;
        *)                    ACTION="unknown" ;;
    esac
fi

# Use temp file for stderr (command substitution $() would hang waiting for backgrounded process)
SSH_ERR_FILE=$(mktemp)

$SSH_BIN -f -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "$SSH_KEY" "$CONTABO" \
    "cd $SCRIPTS_DIR && nohup bash lib/run-and-log.sh $ACTION $SCRIPT $ARGS >> $LOG_FILE 2>&1 </dev/null" \
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
