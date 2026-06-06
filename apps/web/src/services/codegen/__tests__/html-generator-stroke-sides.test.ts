import { describe, it, expect } from 'vitest';
import type { PenNode } from '@zseven-w/pen-types';
import { generateHtml } from '../html-generator';

/**
 * Per-side stroke (Tailwind `border-r`, `border-t border-b`, etc) is the
 * round-trip representation of partial borders on rectangular nodes.
 * These tests pin the html-generator's emission so the canvas-side
 * representation survives codegen back to Tailwind.
 */

function frame(props: Partial<Record<string, unknown>>): PenNode {
  return {
    id: 'f',
    type: 'frame',
    name: 'F',
    x: 0,
    y: 0,
    width: 240,
    height: 100,
    ...props,
  } as unknown as PenNode;
}

describe('html-generator — stroke.sides → Tailwind border classes', () => {
  it('emits `border-r` for a right-only stroke (sidebar divider)', () => {
    const node = frame({
      stroke: {
        thickness: 1,
        sides: ['right'],
        fill: [{ type: 'solid', color: '#e5e7eb' }],
      },
    });
    const html = generateHtml([node], { document: false });
    expect(html).toMatch(/\bborder-r\b/);
    expect(html).not.toMatch(/\bborder-t\b/);
    expect(html).not.toMatch(/\bborder-b\b/);
    expect(html).not.toMatch(/\bborder-l\b/);
    expect(html).not.toMatch(/class="[^"]*\bborder\b(?![-a-z])/);
    expect(html).toContain('border-color: #e5e7eb');
  });

  it('emits `border-t border-b` for top+bottom strokes', () => {
    const node = frame({
      stroke: {
        thickness: 1,
        sides: ['top', 'bottom'],
        fill: [{ type: 'solid', color: '#e5e7eb' }],
      },
    });
    const html = generateHtml([node], { document: false });
    expect(html).toMatch(/\bborder-t\b/);
    expect(html).toMatch(/\bborder-b\b/);
    expect(html).not.toMatch(/\bborder-r\b/);
    expect(html).not.toMatch(/\bborder-l\b/);
  });

  it('emits the plain `border` class when no sides are set', () => {
    const node = frame({
      stroke: {
        thickness: 1,
        fill: [{ type: 'solid', color: '#e5e7eb' }],
      },
    });
    const html = generateHtml([node], { document: false });
    expect(html).toMatch(/class="[^"]*\bborder\b/);
  });

  it('emits the plain `border` class when all four sides are listed', () => {
    const node = frame({
      stroke: {
        thickness: 1,
        sides: ['top', 'right', 'bottom', 'left'],
        fill: [{ type: 'solid', color: '#e5e7eb' }],
      },
    });
    const html = generateHtml([node], { document: false });
    expect(html).toMatch(/class="[^"]*\bborder\b/);
    expect(html).not.toMatch(/\bborder-t\b/);
  });

  it('emits no border classes when there is no stroke', () => {
    const node = frame({});
    const html = generateHtml([node], { document: false });
    expect(html).not.toMatch(/\bborder(-[trbl])?\b/);
  });

  it('adds an arbitrary-value thickness class when stroke is thicker than 1px', () => {
    const node = frame({
      stroke: {
        thickness: 2,
        sides: ['bottom'],
        fill: [{ type: 'solid', color: '#111827' }],
      },
    });
    const html = generateHtml([node], { document: false });
    expect(html).toMatch(/\bborder-b\b/);
    expect(html).toMatch(/border-\[2px\]/);
  });
});
