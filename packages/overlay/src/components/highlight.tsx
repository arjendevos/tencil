import type { BoxModel } from '@tencildev/protocol';
import { quickLabel } from '../lib/element-context.ts';
import {
    type Box,
    boxModel,
    boxOf,
    gapBoxes,
    roundPx,
    type Side,
    spacingClass,
} from '../lib/measure.ts';
import { hovered, layoutTick, measuring, mode } from '../lib/state.ts';

export function Highlight() {
    layoutTick.value;
    const element = hovered.value;
    if (mode.value !== 'picking' || !element) return null;
    const rect = element.getBoundingClientRect();
    const labelBelow = rect.top < 28;
    return (
        <>
            {/* Alt swaps the box model for distances (MeasureGuides). */}
            {!measuring.value && <BoxModelBands element={element} box={boxOf(rect)} />}
            <div class="highlight" style={boxStyle(boxOf(rect))} />
            <div
                class="highlight-label"
                style={{
                    transform: `translate(${Math.max(4, rect.left)}px, ${labelBelow ? rect.bottom + 6 : rect.top - 26}px)`,
                }}
            >
                {quickLabel(element)}
                <span class="highlight-size">
                    {roundPx(rect.width)}×{roundPx(rect.height)}
                </span>
            </div>
        </>
    );
}

interface Band {
    kind: 'margin' | 'padding' | 'gap';
    box: Box;
    value: number;
    /** Show the value on this band (gaps repeat, so only the first per axis). */
    labelled: boolean;
    /** The utility class that sets it, e.g. `pt-4`. */
    utility?: string;
}

/** Margin, padding and gap shaded around and inside the hovered element, devtools style. */
function BoxModelBands({ element, box }: { element: Element; box: Box }) {
    const model = boxModel(element);
    const bands = [
        ...marginBands(element, box, model),
        ...paddingBands(element, box, model),
        ...gapBands(element, box, model),
    ];
    return (
        <>
            {bands.map((band, index) => (
                <div
                    key={`band-${index}`}
                    class={`band band-${band.kind}`}
                    style={boxStyle(band.box)}
                />
            ))}
            {bands
                .filter(band => band.labelled)
                .map((band, index) => (
                    <span
                        key={`value-${index}`}
                        class={`band-value band-value-${band.kind}`}
                        style={{ transform: centeredAt(band.box) }}
                    >
                        {band.value}
                        {band.utility && <span class="band-utility">{band.utility}</span>}
                    </span>
                ))}
        </>
    );
}

function marginBands(element: Element, box: Box, { margin }: BoxModel): Band[] {
    // Negative margins pull neighbours in; there's no space to shade.
    const [top, right, bottom, left] = margin.map(value => Math.max(0, value));
    const outer = {
        left: box.left - left!,
        top: box.top - top!,
        right: box.right + right!,
        bottom: box.bottom + bottom!,
    };
    return sideBands(element, 'margin', [
        ['top', top!, { ...outer, bottom: box.top }],
        [
            'right',
            right!,
            { left: box.right, right: outer.right, top: box.top, bottom: box.bottom },
        ],
        ['bottom', bottom!, { ...outer, top: box.bottom }],
        ['left', left!, { left: outer.left, right: box.left, top: box.top, bottom: box.bottom }],
    ]);
}

function paddingBands(element: Element, box: Box, { padding, border }: BoxModel): Band[] {
    const [top, right, bottom, left] = padding;
    const inner = {
        left: box.left + border[3],
        top: box.top + border[0],
        right: box.right - border[1],
        bottom: box.bottom - border[2],
    };
    const middle = { top: inner.top + top, bottom: inner.bottom - bottom };
    return sideBands(element, 'padding', [
        ['top', top, { ...inner, bottom: middle.top }],
        ['right', right, { ...middle, left: inner.right - right, right: inner.right }],
        ['bottom', bottom, { ...inner, top: middle.bottom }],
        ['left', left, { ...middle, left: inner.left, right: inner.left + left }],
    ]);
}

function sideBands(
    element: Element,
    kind: 'margin' | 'padding',
    sides: Array<[Side, number, Box]>,
): Band[] {
    return sides
        .filter(([, value, box]) => value > 0 && box.right > box.left && box.bottom > box.top)
        .map(([side, value, box]) => ({
            kind,
            box,
            value,
            labelled: true,
            utility: spacingClass(element, kind, side, value),
        }));
}

function gapBands(element: Element, box: Box, { gap, padding, border }: BoxModel): Band[] {
    if (!gap) return [];
    const content = {
        left: box.left + border[3] + padding[3],
        top: box.top + border[0] + padding[0],
        right: box.right - border[1] - padding[1],
        bottom: box.bottom - border[2] - padding[2],
    };
    const labelled = new Set<'row' | 'column'>();
    return gapBoxes(element, gap, content).map(space => {
        const { axis, ...rest } = space;
        const first = !labelled.has(axis);
        labelled.add(axis);
        return {
            kind: 'gap',
            box: rest,
            value: gap[axis],
            labelled: first,
            utility: first ? spacingClass(element, 'gap', axis, gap[axis]) : undefined,
        };
    });
}

export function boxStyle(box: Box) {
    return {
        transform: `translate(${box.left}px, ${box.top}px)`,
        width: `${box.right - box.left}px`,
        height: `${box.bottom - box.top}px`,
    };
}

export function centeredAt(box: Box): string {
    return `translate(${(box.left + box.right) / 2}px, ${(box.top + box.bottom) / 2}px) translate(-50%, -50%)`;
}
