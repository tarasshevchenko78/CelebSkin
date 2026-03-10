/**
 * state-machine.js — Video processing state machine
 *
 * Formal definition of allowed video states and transitions.
 * Used by pipeline scripts to validate status changes.
 */

import { isCdnUrl } from './bunny.js';

export const VIDEO_STATES = {
    NEW: 'new',
    PROCESSING: 'processing',
    ENRICHED: 'enriched',
    AUTO_RECOGNIZED: 'auto_recognized',
    NEEDS_REVIEW: 'needs_review',
    UNKNOWN: 'unknown',
    UNKNOWN_WITH_SUGGESTIONS: 'unknown_with_suggestions',
    WATERMARKED: 'watermarked',
    PUBLISHED: 'published',
    REJECTED: 'rejected',
    DMCA_REMOVED: 'dmca_removed',
    FAILED: 'failed',
};

export const ALLOWED_TRANSITIONS = {
    [VIDEO_STATES.NEW]: [VIDEO_STATES.PROCESSING, VIDEO_STATES.REJECTED],
    [VIDEO_STATES.PROCESSING]: [VIDEO_STATES.ENRICHED, VIDEO_STATES.FAILED, VIDEO_STATES.NEEDS_REVIEW],
    [VIDEO_STATES.ENRICHED]: [VIDEO_STATES.AUTO_RECOGNIZED, VIDEO_STATES.NEEDS_REVIEW, VIDEO_STATES.UNKNOWN_WITH_SUGGESTIONS, VIDEO_STATES.WATERMARKED],
    [VIDEO_STATES.AUTO_RECOGNIZED]: [VIDEO_STATES.WATERMARKED, VIDEO_STATES.NEEDS_REVIEW, VIDEO_STATES.REJECTED],
    [VIDEO_STATES.NEEDS_REVIEW]: [VIDEO_STATES.WATERMARKED, VIDEO_STATES.REJECTED, VIDEO_STATES.PROCESSING],
    [VIDEO_STATES.UNKNOWN]: [VIDEO_STATES.NEEDS_REVIEW, VIDEO_STATES.REJECTED],
    [VIDEO_STATES.UNKNOWN_WITH_SUGGESTIONS]: [VIDEO_STATES.NEEDS_REVIEW, VIDEO_STATES.REJECTED],
    [VIDEO_STATES.WATERMARKED]: [VIDEO_STATES.PUBLISHED, VIDEO_STATES.NEEDS_REVIEW],
    [VIDEO_STATES.PUBLISHED]: [VIDEO_STATES.DMCA_REMOVED, VIDEO_STATES.NEEDS_REVIEW],
    [VIDEO_STATES.REJECTED]: [VIDEO_STATES.NEEDS_REVIEW],
    [VIDEO_STATES.DMCA_REMOVED]: [],
    [VIDEO_STATES.FAILED]: [VIDEO_STATES.NEW, VIDEO_STATES.PROCESSING],
};

/**
 * Check if a state transition is allowed.
 * @param {string} fromState
 * @param {string} toState
 * @returns {boolean}
 */
export function canTransition(fromState, toState) {
    const allowed = ALLOWED_TRANSITIONS[fromState];
    if (!allowed) return false;
    return allowed.includes(toState);
}

/**
 * Validate a state transition. Throws if not allowed.
 * @param {string} fromState
 * @param {string} toState
 * @throws {Error}
 */
export function validateTransition(fromState, toState) {
    if (!ALLOWED_TRANSITIONS[fromState]) {
        throw new Error(`[StateMachine] Unknown source state: "${fromState}". Known states: ${Object.values(VIDEO_STATES).join(', ')}`);
    }
    if (!Object.values(VIDEO_STATES).includes(toState)) {
        throw new Error(`[StateMachine] Unknown target state: "${toState}". Known states: ${Object.values(VIDEO_STATES).join(', ')}`);
    }
    if (!canTransition(fromState, toState)) {
        const allowed = ALLOWED_TRANSITIONS[fromState];
        throw new Error(
            `[StateMachine] Invalid transition: "${fromState}" → "${toState}". ` +
            `Allowed transitions from "${fromState}": [${allowed.join(', ')}]`
        );
    }
}

/**
 * Get allowed next states for a given state.
 * @param {string} currentState
 * @returns {string[]}
 */
export function getNextStates(currentState) {
    return ALLOWED_TRANSITIONS[currentState] || [];
}

/**
 * Validate that a video is ready for publishing.
 * Checks: status, CDN video URL, CDN thumbnail URL, celebrity linkage.
 * @param {object} video - Video row from DB (must have status, video_url, thumbnail_url; celebrity_count optional)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePrePublish(video) {
    const errors = [];

    if (video.status !== VIDEO_STATES.WATERMARKED) {
        errors.push(`Status must be "watermarked", got "${video.status}"`);
    }

    const videoUrl = video.video_url_watermarked || video.video_url;
    if (!isCdnUrl(videoUrl)) {
        errors.push(`Video URL must be on CDN, got "${(videoUrl || 'null').substring(0, 80)}"`);
    }

    if (!isCdnUrl(video.thumbnail_url)) {
        errors.push(`Thumbnail URL must be on CDN, got "${(video.thumbnail_url || 'null').substring(0, 80)}"`);
    }

    if (video.celebrity_count !== undefined && parseInt(video.celebrity_count) === 0) {
        errors.push('No celebrities linked to this video');
    }

    return { valid: errors.length === 0, errors };
}
