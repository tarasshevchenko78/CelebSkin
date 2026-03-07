/**
 * progress.js — Multi-step pipeline progress tracking
 *
 * Format: { steps: { scrape: {...}, ai-process: {...} }, pipeline: {...}, updatedAt: "..." }
 * Each script writes to its own step key. Completed steps stay visible.
 * Frontend renders a panel per step → conveyor belt view.
 * Supports concurrent step writes (conveyor mode).
 */
import { writeFileSync, readFileSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, "..", "logs", "progress.json");
const PROGRESS_TMP = PROGRESS_FILE + ".tmp";

let _lastStep = null;
const _stepStartTimes = {};

// Per-video active items tracking (for concurrent progress bars)
const _activeItems = new Map();

/**
 * Flush activeItems to progress.json (targeted write, no full overwrite).
 */
function _flushActiveItems() {
    if (!_lastStep) return;
    const existing = readProgressFile();
    if (existing.steps?.[_lastStep]) {
        const items = Array.from(_activeItems.values());
        existing.steps[_lastStep].activeItems = items.length > 0 ? items : undefined;
        existing.steps[_lastStep].updatedAt = new Date().toISOString();
        writeProgressFile(existing);
    }
}

/**
 * Set/update an active item being processed (shows as individual progress bar in UI).
 * Auto-flushes to progress.json so frontend sees updates immediately.
 * @param {string} id - unique key (usually video ID)
 * @param {{ label: string, subStep: string, pct: number }} data
 */
export function setActiveItem(id, data) {
    _activeItems.set(id, {
        id,
        label: data.label || id,
        subStep: data.subStep || '',
        pct: data.pct ?? 0,
        startedAt: _activeItems.get(id)?.startedAt || Date.now(),
    });
    _flushActiveItems();
}

/**
 * Remove an active item (when finished processing).
 * @param {string} id
 */
export function removeActiveItem(id) {
    _activeItems.delete(id);
    _flushActiveItems();
}

/**
 * Get all active items as array for progress.json.
 */
export function getActiveItems() {
    return Array.from(_activeItems.values());
}

/**
 * Clear all active items (called on step complete).
 */
export function clearActiveItems() {
    _activeItems.clear();
}

export function readProgressFile() {
    try {
        return JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    } catch {
        return {};
    }
}

function writeProgressFile(data) {
    data.updatedAt = new Date().toISOString();
    // Retry with jitter for concurrent write safety (conveyor mode)
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            // Re-read and merge to minimize data loss from concurrent writes
            if (attempt > 0) {
                const fresh = readProgressFile();
                if (fresh.steps && data.steps) {
                    data.steps = { ...fresh.steps, ...data.steps };
                }
                if (fresh.pipeline && !data.pipeline) {
                    data.pipeline = fresh.pipeline;
                }
            }
            writeFileSync(PROGRESS_TMP, JSON.stringify(data, null, 2));
            renameSync(PROGRESS_TMP, PROGRESS_FILE);
            return;
        } catch {
            if (attempt < 2) {
                // Small jitter delay before retry
                const delay = Math.floor(Math.random() * 50) + 10;
                const start = Date.now();
                while (Date.now() - start < delay) { /* spin */ }
            }
        }
    }
}

/**
 * Initialize all pipeline steps as pending (shows all panels in UI immediately)
 * @param {Array} steps - [{name: 'scrape', label: 'Scraping'}, ...]
 */
export function initSteps(steps) {
    const data = readProgressFile();
    if (!data.steps) data.steps = {};
    for (const step of steps) {
        data.steps[step.name] = {
            step: step.name,
            stepLabel: step.label,
            videosTotal: 0,
            videosDone: 0,
            status: "pending",
        };
    }
    writeProgressFile(data);
}

/**
 * Write progress for a specific step.
 * Accumulates with other steps — each step gets its own key in "steps".
 * Tracks startedAt on first call for the step.
 */
export function writeProgress(data) {
    _lastStep = data.step || "unknown";

    const existing = readProgressFile();
    if (!existing.steps) existing.steps = {};

    // Track start time on first call
    if (!_stepStartTimes[_lastStep]) {
        _stepStartTimes[_lastStep] = new Date().toISOString();
    }

    // Auto-attach activeItems if any exist
    const items = getActiveItems();

    existing.steps[_lastStep] = {
        ...data,
        status: "active",
        startedAt: _stepStartTimes[_lastStep],
        updatedAt: new Date().toISOString(),
        ...(items.length > 0 ? { activeItems: items } : {}),
    };

    writeProgressFile(existing);
}

/**
 * Mark current step as completed with final data.
 * Saves videosDone, elapsedMs, completedVideos, finishedAt.
 * @param {Object} finalData - { videosDone, elapsedMs, completedVideos, errors, videosTotal }
 */
export function completeStep(finalData = {}) {
    if (_lastStep) {
        const existing = readProgressFile();
        if (existing.steps && existing.steps[_lastStep]) {
            // Always ensure error tracking fields are present
            const errorCount = finalData.errorCount ?? (finalData.errors?.length || 0);
            const hasErrors = errorCount > 0;

            Object.assign(existing.steps[_lastStep], finalData, {
                status: "completed",
                errorCount,
                hasErrors,
                finishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            // Keep only last 20 error details to avoid bloating progress.json
            if (existing.steps[_lastStep].errors?.length > 20) {
                existing.steps[_lastStep].errors = existing.steps[_lastStep].errors.slice(0, 20);
            }
            delete existing.steps[_lastStep].currentVideo;
            delete existing.steps[_lastStep].downloads;
            delete existing.steps[_lastStep].activeItems;
            clearActiveItems();
            writeProgressFile(existing);
        }
        _lastStep = null;
    }
}

/**
 * Mark current step as completed (legacy — use completeStep for better data).
 */
export function clearProgress() {
    completeStep();
}

/**
 * Mark a named step as completed (called by orchestrator for steps that had 0 items).
 * @param {string} stepName - e.g. 'visual-recognize'
 * @param {Object} finalData - { elapsedMs, videosDone, videosTotal }
 */
export function markStepDone(stepName, finalData = {}) {
    const existing = readProgressFile();
    if (existing.steps && existing.steps[stepName]) {
        // Only update if not already completed by the script itself
        if (existing.steps[stepName].status !== 'completed') {
            const errorCount = finalData.errorCount ?? (finalData.errors?.length || 0);
            Object.assign(existing.steps[stepName], finalData, {
                status: "completed",
                errorCount,
                hasErrors: errorCount > 0,
                finishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            writeProgressFile(existing);
        }
    }
}

/**
 * Update step status without overwriting per-video progress.
 * Used by conveyor orchestrator to set step phase (idle, waiting, etc.)
 * @param {string} stepName
 * @param {string} status - 'idle' | 'waiting' | 'active' | 'completed' | 'pending'
 * @param {Object} extra - additional fields to merge
 */
export function writeStepStatus(stepName, status, extra = {}) {
    const existing = readProgressFile();
    if (!existing.steps) existing.steps = {};
    existing.steps[stepName] = {
        ...existing.steps[stepName],
        status,
        ...extra,
        updatedAt: new Date().toISOString(),
    };
    writeProgressFile(existing);
}

/**
 * Write pipeline-level metadata.
 */
export function writePipelineProgress(data) {
    const existing = readProgressFile();
    existing.pipeline = {
        ...data,
        updatedAt: new Date().toISOString(),
    };
    writeProgressFile(existing);
}

/**
 * Read completed step result data (called by orchestrator to check for errors).
 * @param {string} stepName - e.g. 'watermark'
 * @returns {{ errorCount: number, hasErrors: boolean, videosDone: number, errors: Array }} | null
 */
export function readStepResult(stepName) {
    const progress = readProgressFile();
    const step = progress.steps?.[stepName];
    if (!step) return null;
    return {
        status: step.status,
        errorCount: step.errorCount || 0,
        hasErrors: step.hasErrors || false,
        videosDone: step.videosDone || 0,
        videosTotal: step.videosTotal || 0,
        errors: step.errors || [],
        elapsedMs: step.elapsedMs || 0,
    };
}

/**
 * Delete the progress file entirely.
 */
export function clearAllProgress() {
    _lastStep = null;
    Object.keys(_stepStartTimes).forEach(k => delete _stepStartTimes[k]);
    try { unlinkSync(PROGRESS_FILE); } catch {}
}
