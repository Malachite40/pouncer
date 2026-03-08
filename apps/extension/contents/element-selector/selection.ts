import type { Message } from '~lib/messages';
import { detectCheckType, detectName, detectPrice } from './detector';
import { generateSelector } from './selector-generator';
import { injectStyles, removeStyles, removeToast, showToast } from './styles';
import {
    createBadge,
    createOverlay,
    hideBadge,
    hideConfirmPanel,
    hideHighlightClone,
    positionBadge,
    removeOverlay,
    showConfirmPanel,
    showHighlightClone,
} from './ui';

function mergeCheckType(a: string, b: string): 'price' | 'stock' | 'both' {
    if (a === 'both' || b === 'both') return 'both';
    if (a === b) return a as 'price' | 'stock';
    return 'both';
}

let isSelectionMode = false;
let confirmPanelOpen = false;
let currentHoveredElement: Element | null = null;
let lastMouseX = 0;
let lastMouseY = 0;
let removeStylesTimer: ReturnType<typeof setTimeout> | null = null;
const listeners: Array<[string, EventListener, boolean, EventTarget?]> = [];

function scheduleRemoveStyles(ms: number): void {
    cancelRemoveStyles();
    removeStylesTimer = setTimeout(removeStyles, ms);
}

function cancelRemoveStyles(): void {
    if (removeStylesTimer !== null) {
        clearTimeout(removeStylesTimer);
        removeStylesTimer = null;
    }
}

export function getIsConfirmOpen(): boolean {
    return confirmPanelOpen;
}

export function resetForReentry(): void {
    confirmPanelOpen = false;
    isSelectionMode = false;
    hideConfirmPanel();
    cancelRemoveStyles();
}

export function cancelConfirm(): void {
    if (confirmPanelOpen) {
        confirmPanelOpen = false;
        hideConfirmPanel();
    }
}

function getPageElementAtPoint(x: number, y: number): Element | null {
    const pounceEls = document.querySelectorAll('[id^="pounce-"]');
    const saved: Array<[HTMLElement, string]> = [];
    pounceEls.forEach((el) => {
        const htmlEl = el as HTMLElement;
        saved.push([htmlEl, htmlEl.style.display]);
        htmlEl.style.display = 'none';
    });
    const element = document.elementFromPoint(x, y);
    for (const [el, display] of saved) {
        el.style.display = display;
    }
    return element;
}

export function getIsSelectionMode(): boolean {
    return isSelectionMode;
}

export function enableSelectionMode(): void {
    if (isSelectionMode) return;
    isSelectionMode = true;
    cancelRemoveStyles();

    injectStyles();
    createOverlay();
    createBadge();

    addListener('mousemove', handleMouseMove, true);
    addListener('mouseleave', handleMouseLeave, false);
    addListener('click', handleClick, true);
    addListener('mousedown', handleMouseDown, true);
    addListener('scroll', handleScrollOrResize, true);
    addListener('resize', handleScrollOrResize, false, window);

    showToast('Select any element to track. Press ESC to cancel.');
}

export function disableSelectionMode(): void {
    if (!isSelectionMode) return;
    isSelectionMode = false;

    if (currentHoveredElement) {
        currentHoveredElement.classList.remove('pounce-highlight');
        currentHoveredElement = null;
    }

    hideBadge();
    hideHighlightClone();
    hideConfirmPanel();
    removeOverlay();
    removeToast();

    for (const [event, handler, capture, target] of listeners) {
        (target ?? document).removeEventListener(event, handler, capture);
    }
    listeners.length = 0;

    // Delay style removal so toasts from confirm flow can still render
    scheduleRemoveStyles(500);
}

function addListener(event: string, handler: EventListener, capture: boolean, target: EventTarget = document): void {
    target.addEventListener(event, handler, capture);
    listeners.push([event, handler, capture, target]);
}

function handleMouseMove(e: Event): void {
    const me = e as MouseEvent;
    lastMouseX = me.clientX;
    lastMouseY = me.clientY;
    if (!isSelectionMode) return;

    const target = getPageElementAtPoint(lastMouseX, lastMouseY);
    if (!target || target === currentHoveredElement) return;

    if (currentHoveredElement) {
        currentHoveredElement.classList.remove('pounce-highlight');
    }

    currentHoveredElement = target;
    target.classList.add('pounce-highlight');
    positionBadge(target);
    showHighlightClone(target.getBoundingClientRect());
}

function handleMouseLeave(): void {
    if (!isSelectionMode) return;
    if (currentHoveredElement) {
        currentHoveredElement.classList.remove('pounce-highlight');
        currentHoveredElement = null;
        hideBadge();
        hideHighlightClone();
    }
}

function handleScrollOrResize(): void {
    if (!isSelectionMode || !currentHoveredElement) return;
    const rect = currentHoveredElement.getBoundingClientRect();
    positionBadge(currentHoveredElement);
    showHighlightClone(rect);
}

function handleMouseDown(e: Event): void {
    if (!isSelectionMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

async function handleClick(e: Event): Promise<void> {
    if (!isSelectionMode) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const element = getPageElementAtPoint(lastMouseX, lastMouseY);
    if (!element) return;
    const rect = element.getBoundingClientRect();

    // Generate selector and detect info
    const cssSelector = generateSelector(element);
    const name = detectName();
    const checkType = detectCheckType(element);
    const price = detectPrice(element);

    // Remove highlight and exit selection mode
    element.classList.remove('pounce-highlight');
    hideBadge();
    hideHighlightClone();

    // Remove listeners but keep styles for confirm panel
    isSelectionMode = false;
    for (const [event, handler, capture, target] of listeners) {
        (target ?? document).removeEventListener(event, handler, capture);
    }
    listeners.length = 0;
    removeOverlay();
    removeToast();
    currentHoveredElement = null;

    try {
        // Check for existing watch on this URL
        const existingResponse = await chrome.runtime.sendMessage<Message>({
            type: 'CHECK_EXISTING_WATCH',
            payload: { url: window.location.href },
        });
        const existingWatch: { id: string; name: string; checkType: string } | null =
            existingResponse?.payload ?? null;

        const defaultCheckType = existingWatch
            ? mergeCheckType(existingWatch.checkType, checkType)
            : checkType;

        confirmPanelOpen = true;
        const result = await showConfirmPanel({
            name,
            checkType: defaultCheckType,
            cssSelector,
            price,
            rect,
            existingWatch,
        });
        confirmPanelOpen = false;

        showToast(result.skipMerge || !existingWatch ? 'Creating watch...' : 'Saving watch...');

        const response = await chrome.runtime.sendMessage<Message>({
            type: 'ELEMENT_SELECTED',
            payload: {
                url: window.location.href,
                cssSelector,
                name: result.name,
                checkType: result.checkType,
                skipMerge: result.skipMerge,
            },
        });

        if (response?.type === 'WATCH_CREATED') {
            const msg = response.payload.merged
                ? `Watch updated: ${response.payload.name}`
                : `Watch created: ${response.payload.name}`;
            showToast(msg, 4000);
        } else if (response?.type === 'WATCH_FAILED') {
            if (response.payload.authRequired) {
                showToast('Sign in to Pounce to create watches', 5000);
            } else {
                showToast(`Error: ${response.payload.error}`, 5000);
            }
        }
    } catch {
        confirmPanelOpen = false;
        showToast('Cancelled', 2000);
    }

    scheduleRemoveStyles(4000);
}
