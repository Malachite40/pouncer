export function generateSelector(element: Element): string {
    // 1. ID
    if (element.id && !isGeneratedId(element.id)) {
        const sel = `#${CSS.escape(element.id)}`;
        if (isUnique(sel)) return sel;
    }

    // 2. data-* attributes
    for (const attr of element.attributes) {
        if (
            attr.name.startsWith('data-') &&
            attr.value &&
            !attr.name.startsWith('data-reactid')
        ) {
            const sel = `[${attr.name}="${CSS.escape(attr.value)}"]`;
            if (isUnique(sel)) return sel;
        }
    }

    // 3. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
        const sel = `[aria-label="${CSS.escape(ariaLabel)}"]`;
        if (isUnique(sel)) return sel;
    }

    // 4. Scoped class combo
    const classSelector = buildClassSelector(element);
    if (classSelector && isUnique(classSelector)) return classSelector;

    // 5. ID-anchored path
    const anchoredPath = buildIdAnchoredPath(element);
    if (anchoredPath && isUnique(anchoredPath)) return anchoredPath;

    // 6. Full nth-of-type path from body
    return buildFullPath(element);
}

export function getElementText(el: Element): string {
    const text = (el as HTMLElement).innerText || el.textContent || '';
    return text.trim().replace(/\s+/g, ' ').slice(0, 100);
}

function isUnique(selector: string): boolean {
    try {
        return document.querySelectorAll(selector).length === 1;
    } catch {
        return false;
    }
}

function isGeneratedId(id: string): boolean {
    // UUIDs
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
    // Long hex strings
    if (/^[0-9a-f]{16,}$/i.test(id)) return true;
    // React-style :R...:
    if (/^:R/.test(id)) return true;
    // Radix/headless UI ids
    if (/^radix-/.test(id)) return true;
    // Numeric only
    if (/^\d+$/.test(id)) return true;
    return false;
}

function isMeaningfulClass(cls: string): boolean {
    if (cls.length <= 1) return false;
    // Ignore classes injected by the extension itself.
    if (cls.startsWith('pounce-')) return false;
    // CSS Module hashes
    if (/^[a-zA-Z]+_[a-zA-Z0-9_]{5,}$/.test(cls)) return false;
    // Tailwind patterns: single-word utilities with values like px-4, text-sm, bg-red-500
    if (/^-?[a-z]+-\[/.test(cls)) return false; // arbitrary values like w-[200px]
    if (/^(sm|md|lg|xl|2xl):/.test(cls)) return false; // responsive prefixes
    if (/^(hover|focus|active|disabled|group):/.test(cls)) return false; // state prefixes
    // Common Tailwind single-token utilities
    if (
        /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|overflow|pointer|cursor|transition|duration|ease|transform|scale|rotate|translate|opacity|z|gap|space|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min|max|top|bottom|left|right|inset|border|rounded|shadow|ring|outline|bg|text|font|leading|tracking|whitespace|break|truncate|list|decoration|underline|italic|uppercase|lowercase|capitalize|normal|ordinal|sr|not)-/.test(
            cls,
        )
    )
        return false;
    // Pure numbers
    if (/^\d+$/.test(cls)) return false;
    return true;
}

function buildClassSelector(element: Element): string | null {
    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList).filter(isMeaningfulClass);
    if (classes.length === 0) return null;

    // Try tag + single meaningful class
    for (const cls of classes) {
        const sel = `${tag}.${CSS.escape(cls)}`;
        if (isUnique(sel)) return sel;
    }

    // Try tag + combo of 2 classes
    for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
            const sel = `${tag}.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
            if (isUnique(sel)) return sel;
        }
    }

    // Try just classes without tag
    if (classes.length >= 2) {
        const sel = classes.map((c) => `.${CSS.escape(c)}`).join('');
        if (isUnique(sel)) return sel;
    }

    return null;
}

function buildIdAnchoredPath(element: Element): string | null {
    let current: Element | null = element;
    const parts: string[] = [];

    while (current && current !== document.body) {
        if (current !== element && current.id && !isGeneratedId(current.id)) {
            const anchor = `#${CSS.escape(current.id)}`;
            parts.reverse();
            const sel = `${anchor} > ${parts.join(' > ')}`;
            if (isUnique(sel)) return sel;
            // Try without strict child combinators
            const looseSel = `${anchor} ${parts.join(' > ')}`;
            if (isUnique(looseSel)) return looseSel;
            return null;
        }
        parts.push(getNthChildSelector(current));
        current = current.parentElement;
    }
    return null;
}

function buildFullPath(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body && current !== document.documentElement) {
        parts.unshift(getNthChildSelector(current));
        current = current.parentElement;
    }

    return `body > ${parts.join(' > ')}`;
}

function getNthChildSelector(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) return tag;

    const siblings = Array.from(parent.children).filter(
        (el) => el.tagName === element.tagName,
    );

    if (siblings.length === 1) return tag;

    const index = siblings.indexOf(element) + 1;
    return `${tag}:nth-of-type(${index})`;
}
