import { type Box, boxOf, type Guide, measureBetween } from '../lib/measure.ts';
import type { Point } from '../lib/position.ts';
import { draft, hovered, layoutTick, measuring, mode, rulerAnchor, rulerOn } from '../lib/state.ts';
import { boxStyle, centeredAt, ElementLabel } from './highlight.tsx';

/**
 * Red distance lines, Figma style, with the ruler on. Alt while picking, or
 * anywhere with nothing selected: from the hovered element to its parent.
 * Alt with a comment open: from its element to the hovered one, and after an
 * Alt-click, to that element for as long as the comment is open. Outside
 * comment mode, an Alt-click selects an element to measure from.
 */
export function MeasureGuides() {
    layoutTick.value;
    if (!rulerOn.value) return null;
    const anchor = mode.value === 'idle' && !draft.value ? rulerAnchor.value?.element : undefined;
    const pair = measuredPair(anchor);
    const anchorBox = anchor?.isConnected ? boxOf(anchor.getBoundingClientRect()) : null;
    return (
        <>
            {anchor && anchorBox && (
                <>
                    <div class="measure-box" style={boxStyle(anchorBox)} />
                    <ElementLabel element={anchor} box={anchorBox} />
                </>
            )}
            {pair && <Guides pair={pair} />}
        </>
    );
}

function Guides({ pair: [element, other] }: { pair: [Element, Element] }) {
    if (!element.isConnected || !other.isConnected) return null;
    const own = boxOf(element.getBoundingClientRect());
    const target = boxOf(other.getBoundingClientRect());
    const open = draft.value;
    return (
        <>
            {/* The hovered element already has the picking highlight. */}
            {open?.element === element && <div class="measure-box" style={boxStyle(own)} />}
            <div class="measure-target" style={boxStyle(target)} />
            {measureBetween(own, target).map(guide => (
                <GuideLine key={guide.side} guide={guide} />
            ))}
        </>
    );
}

function measuredPair(anchor: Element | undefined): [Element, Element] | null {
    const element = hovered.value;
    const open = draft.value;
    if (mode.value === 'picking' || (!open && !anchor)) {
        const parent = element?.parentElement;
        if (!measuring.value || !element || !parent || parent === document.documentElement) {
            return null;
        }
        return [element, parent];
    }
    if (anchor) {
        return measuring.value && element && element !== anchor ? [anchor, element] : null;
    }
    if (!open) return null;
    if (measuring.value && element && element !== open.element) return [open.element, element];
    return open.measuredTo ? [open.element, open.measuredTo.element] : null;
}

function GuideLine({ guide }: { guide: Guide }) {
    return (
        <>
            {guide.extension && (
                <div class="guide guide-extension" style={lineStyle(guide.extension)} />
            )}
            <div class="guide" style={lineStyle(guide)} />
            <span class="guide-value" style={{ transform: centeredAt(lineBox(guide)) }}>
                {guide.value}
            </span>
        </>
    );
}

function lineStyle(line: { from: Point; to: Point }) {
    const box = lineBox(line);
    const vertical = box.left === box.right;
    return boxStyle(
        vertical
            ? { ...box, left: box.left - 0.5, right: box.left + 0.5 }
            : { ...box, top: box.top - 0.5, bottom: box.top + 0.5 },
    );
}

function lineBox({ from, to }: { from: Point; to: Point }): Box {
    return {
        left: Math.min(from.x, to.x),
        right: Math.max(from.x, to.x),
        top: Math.min(from.y, to.y),
        bottom: Math.max(from.y, to.y),
    };
}
