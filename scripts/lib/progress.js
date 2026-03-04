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

    existing.steps[_lastStep] = {
        ...data,
        status: "active",
        startedAt: _stepStartTimes[_lastStep],
        updatedAt: new Date().toISOString(),
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
            Object.assign(existing.steps[_lastStep], finalData, {
                status: "completed",
                finishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            delete existing.steps[_lastStep].currentVideo;
            delete existing.steps[_lastStep].downloads;
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
            Object.assign(existing.steps[stepName], finalData, {
                status: "completed",
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
 * Delete the progress file entirely.
 */
export function clearAllProgress() {
    _lastStep = null;
    Object.keys(_stepStartTimes).forEach(k => delete _stepStartTimes[k]);
    try { unlinkSync(PROGRESS_FILE); } catch {}
}
