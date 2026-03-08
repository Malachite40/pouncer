const BADGE_ID = 'pounce-badge';
const OVERLAY_ID = 'pounce-overlay';
const CONFIRM_ID = 'pounce-confirm';
const CLONE_ID = 'pounce-highlight-clone';

// Badge
export function createBadge(): HTMLElement {
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
        badge = document.createElement('div');
        badge.id = BADGE_ID;
        badge.className = 'pounce-badge';
        badge.textContent = 'Track';
        badge.style.display = 'none';
        document.body.appendChild(badge);
    }
    return badge;
}

export function positionBadge(element: Element): void {
    const badge = document.getElementById(BADGE_ID);
    if (!badge) return;
    const rect = element.getBoundingClientRect();
    badge.style.left = `${rect.right - badge.offsetWidth - 4}px`;
    badge.style.top = `${Math.max(4, rect.top - badge.offsetHeight - 4)}px`;
    badge.style.display = 'block';
}

export function hideBadge(): void {
    const badge = document.getElementById(BADGE_ID);
    if (badge) badge.style.display = 'none';
}

// Overlay
export function createOverlay(): HTMLElement {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.pointerEvents = 'none';
        document.body.appendChild(overlay);
    }
    return overlay;
}

export function removeOverlay(): void {
    document.getElementById(OVERLAY_ID)?.remove();
}

// Overlay clip-path hole
const HOLE_PADDING = 4;
const HOLE_RADIUS = 8;

function updateOverlayHole(rect: DOMRect): void {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const p = HOLE_PADDING;
    const r = HOLE_RADIUS;
    const l = rect.left - p;
    const t = rect.top - p;
    const ri = rect.right + p;
    const b = rect.bottom + p;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const outer = `M0 0H${vw}V${vh}H0Z`;
    const inner = `M${l + r} ${t}H${ri - r}A${r} ${r} 0 0 1 ${ri} ${t + r}V${b - r}A${r} ${r} 0 0 1 ${ri - r} ${b}H${l + r}A${r} ${r} 0 0 1 ${l} ${b - r}V${t + r}A${r} ${r} 0 0 1 ${l + r} ${t}Z`;
    overlay.style.clipPath = `path(evenodd,"${outer}${inner}")`;
}

function resetOverlayHole(): void {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.style.clipPath = 'none';
}

// Highlight clone
export function showHighlightClone(rect: DOMRect): void {
    let clone = document.getElementById(CLONE_ID);
    if (!clone) {
        clone = document.createElement('div');
        clone.id = CLONE_ID;
        clone.className = 'pounce-highlight-clone';
        document.body.appendChild(clone);
    }
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.display = 'block';
    updateOverlayHole(rect);
}

export function hideHighlightClone(): void {
    const clone = document.getElementById(CLONE_ID);
    if (clone) clone.style.display = 'none';
    resetOverlayHole();
}

// Confirm panel
let activeConfirmReject: ((err: Error) => void) | null = null;

interface ConfirmPanelOptions {
    name: string;
    checkType: 'price' | 'stock' | 'both';
    cssSelector: string;
    price: string | null;
    rect: DOMRect;
    existingWatch: { id: string; name: string; checkType: string } | null;
}

interface ConfirmResult {
    name: string;
    checkType: 'price' | 'stock' | 'both';
    skipMerge: boolean;
}

export function showConfirmPanel(
    options: ConfirmPanelOptions,
): Promise<ConfirmResult> {
    return new Promise((resolve, reject) => {
        hideConfirmPanel();
        activeConfirmReject = reject;

        const clearReject = () => { activeConfirmReject = null; };

        const panel = document.createElement('div');
        panel.id = CONFIRM_ID;

        // Position near the selected element
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const panelWidth = 340;
        const panelHeight = 300; // approximate

        let left = options.rect.right + 12;
        if (left + panelWidth > viewportWidth) {
            left = options.rect.left - panelWidth - 12;
        }
        if (left < 8) left = 8;

        let top = options.rect.top;
        if (top + panelHeight > viewportHeight) {
            top = viewportHeight - panelHeight - 12;
        }
        if (top < 8) top = 8;

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;

        let selectedType = options.checkType;
        let skipMerge = false;
        const isExisting = options.existingWatch != null;

        // Title
        const title = document.createElement('div');
        title.textContent = isExisting ? 'Update Watch' : 'Create Watch';
        title.className = 'pounce-confirm-title';
        panel.appendChild(title);

        // Existing watch banner
        let banner: HTMLElement | null = null;
        let separateLink: HTMLElement | null = null;
        if (isExisting) {
            banner = document.createElement('div');
            banner.className = 'pounce-merge-banner';
            banner.textContent = `You already have a watch for this page tracking ${options.existingWatch!.checkType}. This will be combined.`;
            panel.appendChild(banner);

            separateLink = document.createElement('button');
            separateLink.className = 'pounce-link-btn';
            separateLink.textContent = 'Create separate watch instead';
            separateLink.addEventListener('click', () => {
                skipMerge = !skipMerge;
                if (skipMerge) {
                    title.textContent = 'Create Watch';
                    if (banner) banner.style.display = 'none';
                    separateLink!.textContent = 'Merge with existing watch';
                    createBtn.textContent = 'Create Watch';
                } else {
                    title.textContent = 'Update Watch';
                    if (banner) banner.style.display = 'block';
                    separateLink!.textContent = 'Create separate watch instead';
                    createBtn.textContent = 'Update Watch';
                }
            });
            panel.appendChild(separateLink);
        }

        // Name field
        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Name';
        panel.appendChild(nameLabel);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = options.name;
        nameInput.style.marginBottom = '12px';
        panel.appendChild(nameInput);

        // Check type
        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'Check Type';
        panel.appendChild(typeLabel);

        const typeRow = document.createElement('div');
        typeRow.style.cssText =
            'display: flex !important; gap: 8px !important; margin-bottom: 12px !important;';

        const types: Array<{ value: 'price' | 'stock' | 'both'; label: string }> = [
            { value: 'price', label: 'Price' },
            { value: 'stock', label: 'Stock' },
            { value: 'both', label: 'Both' },
        ];

        const typeButtons: HTMLButtonElement[] = [];
        for (const t of types) {
            const btn = document.createElement('button');
            btn.className = `pounce-type-btn${t.value === selectedType ? ' pounce-active' : ''}`;
            btn.textContent = t.label;
            btn.addEventListener('click', () => {
                selectedType = t.value;
                for (const b of typeButtons) {
                    b.className = 'pounce-type-btn';
                }
                btn.className = 'pounce-type-btn pounce-active';
            });
            typeButtons.push(btn);
            typeRow.appendChild(btn);
        }
        panel.appendChild(typeRow);

        // Price display
        if (options.price) {
            const priceLabel = document.createElement('label');
            priceLabel.textContent = 'Detected Price';
            panel.appendChild(priceLabel);

            const priceDisplay = document.createElement('div');
            priceDisplay.className = 'pounce-price-display';
            priceDisplay.textContent = options.price;
            priceDisplay.style.marginBottom = '12px';
            panel.appendChild(priceDisplay);
        }

        // Selector preview
        const selLabel = document.createElement('label');
        selLabel.textContent = 'CSS Selector';
        panel.appendChild(selLabel);

        const selPreview = document.createElement('div');
        selPreview.className = 'pounce-selector-preview';
        selPreview.textContent =
            options.cssSelector.length > 60
                ? `${options.cssSelector.slice(0, 57)}...`
                : options.cssSelector;
        selPreview.title = options.cssSelector;
        selPreview.style.marginBottom = '16px';
        panel.appendChild(selPreview);

        // Buttons
        const btnRow = document.createElement('div');
        btnRow.style.cssText =
            'display: flex !important; gap: 8px !important; justify-content: flex-end !important;';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pounce-btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
            clearReject();
            hideConfirmPanel();
            reject(new Error('cancelled'));
        });

        const createBtn = document.createElement('button');
        createBtn.className = 'pounce-btn-primary';
        createBtn.textContent = isExisting ? 'Update Watch' : 'Create Watch';
        createBtn.addEventListener('click', () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.style.borderColor = '#f5312c';
                return;
            }
            clearReject();
            hideConfirmPanel();
            resolve({ name, checkType: selectedType, skipMerge });
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(createBtn);
        panel.appendChild(btnRow);

        document.body.appendChild(panel);

        // Re-clamp position using actual rendered size so the modal stays in-viewport
        const actualRect = panel.getBoundingClientRect();
        const clampedLeft = Math.max(8, Math.min(left, viewportWidth - actualRect.width - 8));
        const clampedTop = Math.max(8, Math.min(top, viewportHeight - actualRect.height - 8));
        panel.style.left = `${clampedLeft}px`;
        panel.style.top = `${clampedTop}px`;

        // Focus name input
        setTimeout(() => nameInput.focus(), 50);
    });
}

export function hideConfirmPanel(): void {
    document.getElementById(CONFIRM_ID)?.remove();
    if (activeConfirmReject) {
        const rej = activeConfirmReject;
        activeConfirmReject = null;
        rej(new Error('cancelled'));
    }
}
