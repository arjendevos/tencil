import { threads } from './connection.ts';
import { captureContext, quickLabel } from './element-context.ts';
import { offsetsIn } from './position.ts';
import {
    currentPage,
    draft,
    hidden,
    hovered,
    inboxOpen,
    layoutTick,
    measuring,
    mode,
    openThreadId,
    pageKey,
    settingsOpen,
    startPicking,
    stopPicking,
} from './state.ts';

const BLOCKED_WHILE_PICKING = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'dblclick',
    'contextmenu',
    'auxclick',
] as const;

/**
 * Global listeners: hover tracking + click capture in comment mode, the `C`
 * shortcut, Alt to measure, and layout invalidation for anchored UI. Everything
 * is attached in the capture phase so the page never sees comment-mode clicks.
 */
export function installPicker(host: HTMLElement): () => void {
    const isOurs = (event: Event) => event.composedPath().includes(host);

    const elementAt = (x: number, y: number): Element | null => {
        for (const element of document.elementsFromPoint(x, y)) {
            if (element === host || host.contains(element)) return null;
            if (element === document.documentElement) continue;
            return element;
        }
        return null;
    };

    // With a comment open, Alt-hovering the page measures from its element.
    const capturing = () => mode.value === 'picking' || (draft.value !== null && measuring.value);

    let pointer: { x: number; y: number; ours: boolean } | null = null;
    const track = () => {
        if (!capturing()) {
            if (hovered.value) hovered.value = null;
            return;
        }
        hovered.value = !pointer || pointer.ours ? null : elementAt(pointer.x, pointer.y);
    };

    const onPointerMove = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY, ours: isOurs(event) };
        measuring.value = event.altKey;
        track();
    };

    // Pressing or releasing Alt redraws right away, without moving the mouse.
    const onAlt = (event: KeyboardEvent) => {
        if (event.key !== 'Alt') return;
        measuring.value = event.type === 'keydown';
        // Windows browsers focus their menu bar when Alt is released.
        if (mode.value === 'picking' || draft.value) event.preventDefault();
        track();
    };
    const onBlur = () => {
        measuring.value = false;
        track();
    };

    const block = (event: Event) => {
        // Clicking the page dismisses an open pin (the page still gets the click).
        if (!capturing() && event.type === 'pointerdown' && !isOurs(event)) {
            settingsOpen.value = false;
            // Docked (unpinned) threads stay open while you use the page.
            const open = openThreadId.value ? threads.value.get(openThreadId.value) : undefined;
            if (open?.anchor) openThreadId.value = null;
            return;
        }
        if (!capturing() || isOurs(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    const onClick = (event: MouseEvent) => {
        if (!capturing() || isOurs(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const element = elementAt(event.clientX, event.clientY);
        if (!element) return;
        const open = draft.value;
        if (mode.value !== 'picking' && open) {
            // Alt-click: measure the open comment's element against this one.
            draft.value = {
                ...open,
                measuredTo:
                    element === open.element
                        ? undefined
                        : { element, label: quickLabel(element), parent: false },
            };
            return;
        }
        const parent = element.parentElement;
        stopPicking();
        const context = captureContext(element);
        draft.value = {
            element,
            label: quickLabel(element),
            anchor: {
                // Filled in once context resolves; the live element reference drives layout until then.
                selector: '',
                ...offsetsIn(element, { x: event.clientX, y: event.clientY }),
            },
            context,
            // Alt-click while picking: measure against the parent, as the guides showed.
            ...(event.altKey && parent && parent !== document.documentElement
                ? { measuredTo: { element: parent, label: quickLabel(parent), parent: true } }
                : {}),
        };
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (isOurs(event)) return;
        if (event.key === 'Escape') {
            if (mode.value === 'picking') stopPicking();
            else if (draft.value) draft.value = null;
            else if (openThreadId.value) openThreadId.value = null;
            else if (inboxOpen.value) inboxOpen.value = false;
            else return;
            event.preventDefault();
            return;
        }
        if (isTyping(event)) return;
        if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            hidden.value = false;
            if (mode.value === 'picking') stopPicking();
            else startPicking();
        }
    };

    let frame = 0;
    const invalidate = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            layoutTick.value++;
        });
    };
    const mutations = new MutationObserver(records => {
        if (records.every(record => host.contains(record.target) || record.target === host)) return;
        invalidate();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });

    // SPA navigations don't fire an event we can rely on everywhere; poll cheaply.
    const navigation = setInterval(() => {
        const key = pageKey(location.href);
        if (key !== currentPage.value) {
            currentPage.value = key;
            draft.value = null;
            openThreadId.value = null;
        }
    }, 400);

    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    for (const type of BLOCKED_WHILE_PICKING) window.addEventListener(type, block, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', onAlt, true);
    window.addEventListener('keyup', onAlt, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    window.addEventListener('resize', invalidate, { passive: true });

    return () => {
        window.removeEventListener('pointermove', onPointerMove, true);
        for (const type of BLOCKED_WHILE_PICKING) window.removeEventListener(type, block, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keydown', onAlt, true);
        window.removeEventListener('keyup', onAlt, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('scroll', invalidate, true);
        window.removeEventListener('resize', invalidate);
        mutations.disconnect();
        clearInterval(navigation);
        cancelAnimationFrame(frame);
    };
}

function isTyping(event: KeyboardEvent): boolean {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
    );
}
