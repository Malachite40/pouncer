import { BRAND, FONTS, RADIUS } from '~lib/constants';

const STYLE_ID = 'pounce-injected-styles';
const FONT_LINK_ID = 'pounce-injected-fonts';

export function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;

    if (!document.getElementById(FONT_LINK_ID)) {
        const link = document.createElement('link');
        link.id = FONT_LINK_ID;
        link.rel = 'stylesheet';
        link.href =
            'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap';
        document.head.appendChild(link);
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .pounce-highlight {
            cursor: crosshair !important;
        }

        .pounce-highlight-clone {
            position: fixed !important;
            z-index: 2147483645 !important;
            pointer-events: none !important;
            border: none !important;
            background-color: transparent !important;
            border-radius: 4px !important;
            transition: all 0.15s ease !important;
            box-shadow:
                0 0 0 4px rgba(232, 123, 53, 0.3),
                0 8px 32px rgba(232, 123, 53, 0.5),
                0 16px 48px rgba(232, 123, 53, 0.3) !important;
        }

        #pounce-overlay {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.55) 100%) !important;
            backdrop-filter: blur(2px) !important;
            -webkit-backdrop-filter: blur(2px) !important;
            z-index: 2147483640 !important;
            pointer-events: none !important;
            transition: clip-path 0.15s ease !important;
        }

        .pounce-badge {
            position: fixed !important;
            background: ${BRAND.primary} !important;
            color: ${BRAND.primaryForeground} !important;
            font-family: ${FONTS.sans} !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            padding: 3px 10px !important;
            border-radius: 12px !important;
            z-index: 2147483646 !important;
            pointer-events: none !important;
            white-space: nowrap !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
        }

        #pounce-toast {
            position: fixed !important;
            bottom: 24px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: ${BRAND.card} !important;
            color: ${BRAND.foreground} !important;
            font-family: ${FONTS.sans} !important;
            font-size: 14px !important;
            padding: 10px 20px !important;
            border-radius: ${RADIUS} !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
            border: 1px solid ${BRAND.primaryBorder} !important;
            transition: opacity 0.3s ease !important;
        }

        #pounce-confirm {
            position: fixed !important;
            z-index: 2147483647 !important;
            background: ${BRAND.card} !important;
            border: 1px solid ${BRAND.border} !important;
            border-radius: ${RADIUS} !important;
            padding: 20px !important;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
            font-family: ${FONTS.sans} !important;
            color: ${BRAND.foreground} !important;
            width: 340px !important;
            box-sizing: border-box !important;
        }

        #pounce-confirm * {
            box-sizing: border-box !important;
        }

        #pounce-confirm label {
            display: block !important;
            font-size: 10px !important;
            font-weight: 600 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.18em !important;
            color: ${BRAND.mutedForeground} !important;
            margin-bottom: 4px !important;
        }

        #pounce-confirm input[type="text"] {
            width: 100% !important;
            padding: 8px 10px !important;
            border: 1px solid ${BRAND.border} !important;
            border-radius: ${RADIUS} !important;
            background: ${BRAND.input} !important;
            color: ${BRAND.foreground} !important;
            font-size: 14px !important;
            font-family: inherit !important;
            outline: none !important;
        }

        #pounce-confirm input[type="text"]:focus {
            border-color: ${BRAND.primary} !important;
            box-shadow: 0 0 0 2px ${BRAND.primaryLight} !important;
        }

        .pounce-confirm-title {
            font-family: ${FONTS.display} !important;
            font-size: 16px !important;
            font-weight: 700 !important;
            margin-bottom: 16px !important;
            color: ${BRAND.primary} !important;
            letter-spacing: -0.04em !important;
        }

        .pounce-type-btn {
            padding: 6px 14px !important;
            border: 1px solid ${BRAND.border} !important;
            border-radius: ${RADIUS} !important;
            background: ${BRAND.input} !important;
            color: ${BRAND.mutedForeground} !important;
            font-size: 13px !important;
            font-family: inherit !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
        }

        .pounce-type-btn:hover {
            border-color: ${BRAND.primary} !important;
            color: ${BRAND.foreground} !important;
        }

        .pounce-type-btn.pounce-active {
            background: ${BRAND.primaryLight} !important;
            border-color: ${BRAND.primary} !important;
            color: ${BRAND.primary} !important;
            font-weight: 600 !important;
        }

        .pounce-selector-preview {
            font-family: 'SF Mono', 'Fira Code', monospace !important;
            font-size: 11px !important;
            color: ${BRAND.mutedForeground} !important;
            background: ${BRAND.input} !important;
            padding: 6px 8px !important;
            border-radius: 4px !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            border: 1px solid ${BRAND.border} !important;
        }

        .pounce-btn-primary {
            padding: 8px 20px !important;
            border: none !important;
            border-radius: ${RADIUS} !important;
            background: ${BRAND.primary} !important;
            color: ${BRAND.primaryForeground} !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            font-family: inherit !important;
            cursor: pointer !important;
            transition: background 0.15s ease !important;
        }

        .pounce-btn-primary:hover {
            background: ${BRAND.primaryHover} !important;
        }

        .pounce-btn-primary:disabled {
            opacity: 0.6 !important;
            cursor: not-allowed !important;
        }

        .pounce-btn-cancel {
            padding: 8px 16px !important;
            border: 1px solid ${BRAND.border} !important;
            border-radius: ${RADIUS} !important;
            background: transparent !important;
            color: ${BRAND.mutedForeground} !important;
            font-size: 14px !important;
            font-family: inherit !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
        }

        .pounce-btn-cancel:hover {
            border-color: ${BRAND.destructive} !important;
            color: ${BRAND.destructive} !important;
        }

        .pounce-price-display {
            font-size: 13px !important;
            color: ${BRAND.green} !important;
            font-weight: 600 !important;
        }

        .pounce-merge-banner {
            font-size: 12px !important;
            color: ${BRAND.foreground} !important;
            background: ${BRAND.primaryLight} !important;
            border: 1px solid ${BRAND.primaryBorder} !important;
            border-radius: ${RADIUS} !important;
            padding: 8px 10px !important;
            margin-bottom: 8px !important;
            line-height: 1.4 !important;
        }

        .pounce-link-btn {
            display: inline !important;
            background: none !important;
            border: none !important;
            color: ${BRAND.primary} !important;
            font-size: 12px !important;
            font-family: inherit !important;
            cursor: pointer !important;
            padding: 0 !important;
            margin-bottom: 12px !important;
            text-decoration: underline !important;
        }

        .pounce-link-btn:hover {
            color: ${BRAND.primaryHover} !important;
        }
    `;
    document.head.appendChild(style);
}

export function removeStyles(): void {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(FONT_LINK_ID)?.remove();
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, duration = 3000): void {
    let toast = document.getElementById('pounce-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'pounce-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        if (toast) toast.style.opacity = '0';
        toastTimeout = setTimeout(() => toast?.remove(), 300);
    }, duration);
}

export function removeToast(): void {
    if (toastTimeout) clearTimeout(toastTimeout);
    document.getElementById('pounce-toast')?.remove();
}
