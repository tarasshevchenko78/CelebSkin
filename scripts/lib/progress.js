/**
 * progress.js — Multi-step pipeline progress tracking
 * 
 * Format: { steps: { scrape: {...}, ai-process: {...} }, pipeline: {...}, updatedAt: "..." }
 * Each script writes to its own step key. Completed steps stay visible.
 * Frontend renders a panel per step → conveyor belt view.
 */
import { writeFileSync, readFileSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, "..", "logs", "progress.json");
const PROGRESS_TMP = PROGRESS_FILE + ".tmp";

let _lastStep = null;

function readProgressFile() {
    try {
        return JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    } catch {
        return {};
    }
}

function writeProgressFile(data) {
    try {
        data.updatedAt = new Date().toISOString();
        writeFileSync(PROGRESS_TMP, JSON.stringify(data, null, 2));
        renameSync(PROGRESS_TMP, PROGRESS_FILE);
    } catch {
        // Non-critical
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
        if (!data.steps[step.name]) {
            data.steps[step.name] = {
                step: step.name,
                stepLabel: step.label,
                videosTotal: 0,
                videosDone: 0,
                status: "pending",
            };
        }
    }
    writeProgressFile(data);
}

/**
 * Write progress for a specific step.
 * Accumulates with other steps — each step gets its own key in "steps".
 */
export function writeProgress(data) {
    _lastStep = data.step || "unknown";

    const existing = readProgressFile();
    if (!existing.steps) existing.steps = {};

    existing.steps[_lastStep] = {
        ...data,
        status: "active",
        updatedAt: new Date().toISOString(),
    };

    writeProgressFile(existing);
}

/**
 * Mark current step as completed (keeps it visible in UI with checkmark).
 */
export function clearProgress() {
    if (_lastStep) {
        const existing = readProgressFile();
        if (existing.steps && existing.steps[_lastStep]) {
            existing.steps[_lastStep].status = "completed";
            existing.steps[_lastStep].updatedAt = new Date().toISOString();
            delete existing.steps[_lastStep].currentVideo;
            delete existing.steps[_lastStep].downloads;
            writeProgressFile(existing);
        }
        _lastStep = null;
    }
    // Do NOT delete file here — other steps may still be tracked.
    // Use clearAllProgress() to remove the file entirely.
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
    try { unlinkSync(PROGRESS_FILE); } catch {}
}
