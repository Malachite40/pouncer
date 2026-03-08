import type { Message } from '~lib/messages';
import { createWatch, findWatchByUrl } from './api';
import { checkAndRefreshAuth, clearAuth } from './auth';
import { API_BASE_URL } from '~lib/constants';
import { getAuthToken } from '~lib/storage';

async function openPopupOrLogin(windowId?: number): Promise<void> {
    try {
        await chrome.action.openPopup(windowId ? { windowId } : undefined);
    } catch {
        chrome.tabs.create({ url: `${API_BASE_URL}/login` });
    }
}

chrome.runtime.onMessage.addListener(
    (message: Message, sender, sendResponse) => {
        if (message.type === 'ELEMENT_SELECTED') {
            const windowId = sender.tab?.windowId;
            getAuthToken().then(async (token) => {
                if (!token) {
                    await openPopupOrLogin(windowId);
                    sendResponse({
                        type: 'WATCH_FAILED',
                        payload: { error: 'Not signed in', authRequired: true },
                    });
                    return;
                }

                const result = await createWatch(message.payload);
                if (result.success) {
                    sendResponse({
                        type: 'WATCH_CREATED',
                        payload: result.watch,
                    });
                } else {
                    if (result.authRequired) {
                        await openPopupOrLogin(windowId);
                    }
                    sendResponse({
                        type: 'WATCH_FAILED',
                        payload: { error: result.error, authRequired: result.authRequired },
                    });
                }
            });
            return true; // async response
        }

        if (message.type === 'CHECK_EXISTING_WATCH') {
            findWatchByUrl(message.payload.url).then((result) => {
                sendResponse({ type: 'EXISTING_WATCH_RESULT', payload: result });
            });
            return true;
        }

        if (message.type === 'AUTH_STATUS_REQUEST') {
            checkAndRefreshAuth().then((status) => {
                sendResponse({ type: 'AUTH_STATUS', payload: status });
            });
            return true;
        }

        if (message.type === 'SIGN_OUT') {
            clearAuth().then(() => {
                sendResponse({ type: 'AUTH_STATUS', payload: { authenticated: false } });
            });
            return true;
        }

        return false;
    },
);

// Keyboard shortcut → send ENABLE_SELECTION to active tab
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-selection') {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'ENABLE_SELECTION' });
        }
    }
});
