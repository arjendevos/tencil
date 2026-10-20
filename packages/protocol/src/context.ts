import { z } from 'zod';

/** A resolved source location for the element, usually from React's owner stack. */
export const SourceLocation = z.object({
    file: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const ComponentFrame = z.object({
    name: z.string(),
    source: SourceLocation.optional(),
    /** `node_modules` package the component lives in, if it isn't app code. */
    library: z.string().optional(),
});
export type ComponentFrame = z.infer<typeof ComponentFrame>;

export const Rect = z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
});
export type Rect = z.infer<typeof Rect>;

/** CSS pixels per side, in CSS order: top, right, bottom, left. */
export const Sides = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Sides = z.infer<typeof Sides>;

/** The element's computed box model. */
export const BoxModel = z.object({
    margin: Sides,
    padding: Sides,
    border: Sides,
    /** Only on flex and grid containers with a gap. */
    gap: z.object({ row: z.number(), column: z.number() }).optional(),
});
export type BoxModel = z.infer<typeof BoxModel>;

/**
 * Distances measured from the element to another one (Alt in the overlay):
 * the space on each side of the element, up to the other element's nearest edge.
 */
export const Spacing = z.object({
    /** Label of the other element (component · tag). */
    to: z.string(),
    selector: z.string().optional(),
    /** The other element is the picked one's parent. */
    parent: z.boolean().optional(),
    top: z.number().optional(),
    right: z.number().optional(),
    bottom: z.number().optional(),
    left: z.number().optional(),
});
export type Spacing = z.infer<typeof Spacing>;

/**
 * Everything the overlay knows about the picked element. Captured once when
 * the pin is placed and forwarded to the agent as context.
 */
export const ElementContext = z.object({
    tagName: z.string(),
    selector: z.string(),
    /** Trimmed outerHTML preview, safe to put in a prompt. */
    html: z.string(),
    text: z.string().optional(),
    /** Innermost component first. */
    components: z.array(ComponentFrame).default([]),
    rect: Rect,
    viewport: z.object({ width: z.number(), height: z.number(), dpr: z.number() }),
    /** Selected text inside the element at pin time, if any. */
    selection: z.string().optional(),
    box: BoxModel.optional(),
    spacing: Spacing.optional(),
});
export type ElementContext = z.infer<typeof ElementContext>;

/** Where a pin sits: the element plus the click offset inside it (0..1). */
export const Anchor = z.object({
    selector: z.string(),
    offsetX: z.number().min(0).max(1),
    offsetY: z.number().min(0).max(1),
});
export type Anchor = z.infer<typeof Anchor>;

export const ImageAttachment = z.object({
    name: z.string(),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    dataUrl: z.string().startsWith('data:image/').max(14_000_000),
});
export type ImageAttachment = z.infer<typeof ImageAttachment>;
