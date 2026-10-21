import { describe, expect, it } from 'vitest';
import { type Box, measureBetween, toSpacing } from './measure.ts';

const box = (left: number, top: number, width: number, height: number): Box => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
});

const values = (a: Box, b: Box) =>
    Object.fromEntries(measureBetween(a, b).map(guide => [guide.side, guide.value]));

describe('measureBetween', () => {
    it('measures the gap to an element above', () => {
        expect(values(box(0, 100, 100, 40), box(0, 0, 100, 76))).toEqual({ top: 24 });
    });

    it('measures the gap to an element on the right', () => {
        const [guide] = measureBetween(box(0, 0, 100, 40), box(116, 10, 50, 40));
        expect(guide).toMatchObject({ side: 'right', value: 16 });
        // Drawn through the middle of where the two overlap vertically.
        expect(guide?.from).toEqual({ x: 100, y: 25 });
        expect(guide?.extension).toBeUndefined();
    });

    it('measures both gaps to a diagonal element, with dashed projections', () => {
        const guides = measureBetween(box(100, 100, 50, 50), box(0, 0, 60, 70));
        expect(Object.fromEntries(guides.map(guide => [guide.side, guide.value]))).toEqual({
            top: 30,
            left: 40,
        });
        expect(guides.every(guide => guide.extension)).toBe(true);
    });

    it('measures from each edge to the parent around it', () => {
        expect(values(box(16, 24, 200, 40), box(0, 0, 232, 88))).toEqual({
            top: 24,
            right: 16,
            bottom: 24,
            left: 16,
        });
    });

    it('measures matching edges of overlapping elements and skips aligned ones', () => {
        expect(values(box(0, 0, 100, 100), box(50, 0, 100, 120))).toEqual({
            right: 50,
            bottom: 20,
            left: 50,
        });
    });

    it('keeps fractional pixels to one decimal', () => {
        expect(values(box(0, 10.25, 10, 10), box(0, 0, 10, 2))).toEqual({ top: 8.3 });
    });
});

describe('toSpacing', () => {
    it('turns guides into the spacing sent with the pin', () => {
        const guides = measureBetween(box(16, 24, 200, 40), box(0, 0, 232, 64));
        expect(toSpacing(guides, { to: 'Card · div', parent: true })).toEqual({
            to: 'Card · div',
            parent: true,
            top: 24,
            right: 16,
            left: 16,
        });
    });
});
