import type { PlasmoCSConfig } from 'plasmo';
import type { Message } from '~lib/messages';
import {
    cancelConfirm,
    disableSelectionMode,
    enableSelectionMode,
    getIsConfirmOpen,
    getIsSelectionMode,
    resetForReentry,
} from './selection';

export const config: PlasmoCSConfig = {
    matches: ['<all_urls>'],
    all_frames: false,
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: Message) => {
    if (message.type === 'ENABLE_SELECTION') {
        if (getIsConfirmOpen()) {
            resetForReentry();
        }
        enableSelectionMode();
    } else if (message.type === 'DISABLE_SELECTION') {
        if (getIsConfirmOpen()) {
            cancelConfirm();
        } else {
            disableSelectionMode();
        }
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Skip if in input fields
    const target = e.target as HTMLElement;
    if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
    ) {
        // Allow ESC even in inputs if selection mode or confirm panel is active
        if (e.key === 'Escape' && (getIsSelectionMode() || getIsConfirmOpen())) {
            if (getIsConfirmOpen()) {
                cancelConfirm();
            } else {
                disableSelectionMode();
            }
            return;
        }
        return;
    }

    // Cmd/Ctrl + Shift + P → toggle selection mode
    if (e.key === 'p' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (getIsConfirmOpen()) {
            resetForReentry();
            enableSelectionMode();
        } else if (getIsSelectionMode()) {
            disableSelectionMode();
        } else {
            enableSelectionMode();
        }
        return;
    }

    // ESC → cancel selection mode or confirm panel
    if (e.key === 'Escape') {
        if (getIsConfirmOpen()) {
            cancelConfirm();
        } else if (getIsSelectionMode()) {
            disableSelectionMode();
        }
    }
});
