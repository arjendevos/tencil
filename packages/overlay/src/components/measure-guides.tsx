import { type Box, boxOf, type Guide, measureBetween } from '../lib/measure.ts';
import type { Point } from '../lib/position.ts';
import { draft, hovered, layoutTick, measuring, mode } from '../lib/state.ts';
import { boxStyle, centeredAt } from './highlight.tsx';

/**
 * Red distance lines, Figma style. Alt while picking: from the hovered element
 * to its parent. Alt with a comment open: from its element to the hovered one,
 * and after an Alt-click, to that element for as long as the comment is open.
 */
export function MeasureGuides() {
    layoutTick.value;
    const pair = measuredPair();
    if (!pair) return null;
    const [element, other] = pair;
    if (!element.isConnected || !other.isConnected) return null;
    const own = boxOf(element.getBoundingClientRect());
    const target = boxOf(other.getBoundingClientRect());
    const guides = measureBetween(own, target);
    return (
        <>
            {mode.value !== 'picking' && <div class="measure-box" style={boxStyle(own)} />}
            <div class="measure-target" style={boxStyle(target)} />
            {guides.map(guide => (
                <GuideLine key={guide.side} guide={guide} />
            ))}
        </>
    );
}

function measuredPair(): [Element, Element] | null {
    const element = hovered.value;
    if (mode.value === 'picking') {
        const parent = element?.parentElement;
        if (!measuring.value || !element || !parent || parent === document.documentElement) {
            return null;
        }
        return [element, parent];
    }
    const open = draft.value;
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
