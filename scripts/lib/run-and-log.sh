#!/bin/bash
# run-and-log.sh — Wrapper that runs a pipeline script and logs start/end
# Usage: run-and-log.sh <action-name> <script.js> [args...]
#
# - Logs start time
# - Runs the node script
# - Logs completion/failure with exit code

ACTION="$1"
SCRIPT="$2"
shift 2
ARGS="$*"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${SCRIPT_DIR}/logs/pipeline.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "${TIMESTAMP} [INFO] ============================================================" >> "$LOG_FILE"
echo "${TIMESTAMP} [INFO] Starting: ${ACTION} (${SCRIPT} ${ARGS})" >> "$LOG_FILE"
echo "${TIMESTAMP} [INFO] ============================================================" >> "$LOG_FILE"

cd "$SCRIPT_DIR" || exit 1

# Run the script, capturing output to log
node "$SCRIPT" $ARGS >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

TIMESTAMP_END=$(date '+%Y-%m-%d %H:%M:%S')
if [ $EXIT_CODE -eq 0 ]; then
    echo "${TIMESTAMP_END} [INFO] Completed: ${ACTION} (exit code 0)" >> "$LOG_FILE"
else
    echo "${TIMESTAMP_END} [ERROR] Failed: ${ACTION} (exit code ${EXIT_CODE})" >> "$LOG_FILE"
fi

exit $EXIT_CODE
