import { describe, expect, it } from 'vitest';
import {
  hasVisibleStroke,
  resolveStrokeSideEdges,
  shouldUseTransparentFallbackFill,
} from '../paint-utils';

describe('hasVisibleStroke', () => {
  it('returns true for a normal colored stroke', () => {
    expect(
      hasVisibleStroke({
        thickness: 4,
        fill: [{ type: 'solid', color: '#60A5FA' }],
      }),
    ).toBe(true);
  });

  it('returns false when stroke is missing a visible color', () => {
    expect(
      hasVisibleStroke({
        thickness: 4,
        fill: [{ type: 'solid', color: '#00000000' }],
      }),
    ).toBe(true);
    expect(
      hasVisibleStroke({
        thickness: 4,
        fill: [],
      }),
    ).toBe(false);
  });

  it('returns false when stroke width resolves to zero', () => {
    expect(
      hasVisibleStroke({
        thickness: 0,
        fill: [{ type: 'solid', color: '#60A5FA' }],
      }),
    ).toBe(false);
  });
});

describe('shouldUseTransparentFallbackFill', () => {
  it('keeps stroke-only shapes hollow instead of falling back to default fill', () => {
    expect(
      shouldUseTransparentFallbackFill(undefined, {
        thickness: 12,
        fill: [{ type: 'solid', color: '#22C55E' }],
      }),
    ).toBe(true);
  });

  it('keeps fill-less containers transparent', () => {
    expect(shouldUseTransparentFallbackFill(undefined, undefined, true)).toBe(true);
  });

  it('does not override explicit fills', () => {
    expect(
      shouldUseTransparentFallbackFill([{ type: 'solid', color: '#00000000' }], {
        thickness: 4,
        fill: [{ type: 'solid', color: '#60A5FA' }],
      }),
    ).toBe(false);
  });
});

describe('resolveStrokeSideEdges — partial per-side strokes', () => {
  // 240 × 100 sidebar at (0, 0) — same shape Mira emits for the right
  // divider example in the prompt.
  const x = 0;
  const y = 0;
  const w = 240;
  const h = 100;

  it('returns null when stroke is undefined', () => {
    expect(resolveStrokeSideEdges(undefined, x, y, w, h)).toBeNull();
  });

  it('returns null when sides is missing (full border)', () => {
    expect(
      resolveStrokeSideEdges(
        { thickness: 1, fill: [{ type: 'solid', color: '#e5e7eb' }] },
        x,
        y,
        w,
        h,
      ),
    ).toBeNull();
  });

  it('returns null when sides lists all four edges (full border)', () => {
    expect(
      resolveStrokeSideEdges(
        {
          thickness: 1,
          sides: ['top', 'right', 'bottom', 'left'],
          fill: [{ type: 'solid', color: '#e5e7eb' }],
        },
        x,
        y,
        w,
        h,
      ),
    ).toBeNull();
  });

  it('draws ONE line segment for a right-only stroke (sidebar divider)', () => {
    const edges = resolveStrokeSideEdges(
      {
        thickness: 1,
        sides: ['right'],
        fill: [{ type: 'solid', color: '#e5e7eb' }],
      },
      x,
      y,
      w,
      h,
    );
    expect(edges).not.toBeNull();
    expect(edges).toHaveLength(1);
    // Right edge: vertical line from (w, 0) to (w, h)
    expect(edges![0]).toEqual([w, y, w, y + h]);
  });

  it('emits the correct segment for each of the four sides', () => {
    expect(
      resolveStrokeSideEdges(
        { thickness: 1, sides: ['top'], fill: [{ type: 'solid', color: '#000' }] },
        x,
        y,
        w,
        h,
      ),
    ).toEqual([[x, y, x + w, y]]);
    expect(
      resolveStrokeSideEdges(
        { thickness: 1, sides: ['bottom'], fill: [{ type: 'solid', color: '#000' }] },
        x,
        y,
        w,
        h,
      ),
    ).toEqual([[x, y + h, x + w, y + h]]);
    expect(
      resolveStrokeSideEdges(
        { thickness: 1, sides: ['left'], fill: [{ type: 'solid', color: '#000' }] },
        x,
        y,
        w,
        h,
      ),
    ).toEqual([[x, y, x, y + h]]);
  });

  it('returns multiple segments for a top+bottom stroke', () => {
    const edges = resolveStrokeSideEdges(
      {
        thickness: 1,
        sides: ['top', 'bottom'],
        fill: [{ type: 'solid', color: '#e5e7eb' }],
      },
      x,
      y,
      w,
      h,
    );
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual([x, y, x + w, y]);
    expect(edges).toContainEqual([x, y + h, x + w, y + h]);
  });

  it('dedupes repeated sides within the same array', () => {
    const edges = resolveStrokeSideEdges(
      { thickness: 1, sides: ['right', 'right'], fill: [{ type: 'solid', color: '#000' }] },
      x,
      y,
      w,
      h,
    );
    expect(edges).toHaveLength(1);
  });
});
