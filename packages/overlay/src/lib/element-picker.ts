import type { Anchor } from '@tencildev/protocol';
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
    rulerAnchor,
    rulerOn,
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
 * shortcut, Alt to measure (with the ruler on, anywhere on the page), and
 * layout invalidation for anchored UI. Everything is attached in the capture
 * phase so the page never sees comment-mode or measuring clicks.
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

    // With the ruler on, Alt-hovering the page measures, comment open or not.
    const capturing = () => mode.value === 'picking' || (measuring.value && rulerOn.value);

    let pointer: { x: number; y: number; ours: boolean } | null = null;
    /** The element last measured against the ruler's anchor; `C` sends the spacing to it. */
    let measuredFromAnchor: Element | null = null;
    const track = () => {
        if (!capturing()) {
            if (hovered.value) hovered.value = null;
            return;
        }
        hovered.value = !pointer || pointer.ours ? null : elementAt(pointer.x, pointer.y);
        const anchor = rulerAnchor.value?.element;
        if (anchor && hovered.value && hovered.value !== anchor) {
            measuredFromAnchor = hovered.value;
        }
    };

    const openDraft = (
        element: Element,
        offsets: Pick<Anchor, 'offsetX' | 'offsetY'>,
        measuredTo?: { element: Element; parent: boolean },
    ) => {
        stopPicking();
        rulerAnchor.value = null;
        draft.value = {
            element,
            label: quickLabel(element),
            anchor: {
                // Filled in once context resolves; the live element reference drives layout until then.
                selector: '',
                ...offsets,
            },
            context: captureContext(element),
            ...(measuredTo
                ? { measuredTo: { ...measuredTo, label: quickLabel(measuredTo.element) } }
                : {}),
        };
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
        if (rulerOn.value) event.preventDefault();
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
        const offsets = offsetsIn(element, { x: event.clientX, y: event.clientY });
        if (mode.value !== 'picking') {
            const open = draft.value;
            if (open) {
                // Alt-click: measure the open comment's element against this one.
                draft.value = {
                    ...open,
                    measuredTo:
                        element === open.element
                            ? undefined
                            : { element, label: quickLabel(element), parent: false },
                };
            } else {
                // Alt-click: measure from this element; again to let go of it.
                const same = rulerAnchor.value?.element === element;
                rulerAnchor.value = same ? null : { element, offsets };
                measuredFromAnchor = null;
                // The blocked click can't take focus off the toolbar; do it so `C` works.
                const focused = host.shadowRoot?.activeElement;
                if (focused instanceof HTMLElement) focused.blur();
            }
            return;
        }
        const parent = element.parentElement;
        // Alt-click while picking: measure against the parent, as the guides showed.
        const measureParent =
            event.altKey && rulerOn.value && parent && parent !== document.documentElement;
        openDraft(element, offsets, measureParent ? { element: parent, parent: true } : undefined);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (isOurs(event)) return;
        if (event.key === 'Escape') {
            if (mode.value === 'picking') stopPicking();
            else if (draft.value) draft.value = null;
            else if (rulerAnchor.value) rulerAnchor.value = null;
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
            const anchor = rulerAnchor.value;
            if (mode.value === 'picking') stopPicking();
            else if (anchor?.element.isConnected && !draft.value) {
                // Comment on what the ruler selected, with the spacing it last measured.
                const other = measuredFromAnchor?.isConnected ? measuredFromAnchor : null;
                openDraft(
                    anchor.element,
                    anchor.offsets,
                    other ? { element: other, parent: false } : undefined,
                );
            } else startPicking();
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
            rulerAnchor.value = null;
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
