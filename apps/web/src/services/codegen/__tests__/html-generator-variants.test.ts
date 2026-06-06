import { describe, it, expect } from 'vitest';
import type { PenNode, FrameNode, RefNode } from '@zseven-w/pen-types';
import { generateHtml } from '../html-generator';

/**
 * Variant properties on a component master + per-instance `variants`
 * selection on the ref baked into html-generator output. The wireframe
 * does NOT carry runtime variants — each instance is materialised with
 * the variant-resolved descendants merged in at codegen time.
 */

function buttonMaster(): FrameNode {
  return {
    id: 'comp-btn',
    type: 'frame',
    name: 'Button',
    reusable: true,
    properties: {
      Type: {
        type: 'variant',
        values: ['Primary', 'Secondary'],
        default: 'Primary',
        descendants: {
          Primary: {
            'btn-bg': { fill: [{ type: 'solid', color: '#111827' }] },
          },
          Secondary: {
            'btn-bg': { fill: [{ type: 'solid', color: '#f3f4f6' }] },
          },
        },
      },
    },
    children: [
      {
        id: 'btn-bg',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 120,
        height: 40,
        fill: [{ type: 'solid', color: '#000000' }],
      } as PenNode,
    ],
  } as FrameNode;
}

describe('html-generator — variant property resolution at codegen time', () => {
  it('emits distinct background colors for two refs picking different variants', () => {
    const master = buttonMaster();
    const refPrimary: RefNode = {
      id: 'rp',
      type: 'ref',
      ref: 'comp-btn',
      name: 'Buy now',
      variants: { Type: 'Primary' },
    };
    const refSecondary: RefNode = {
      id: 'rs',
      type: 'ref',
      ref: 'comp-btn',
      name: 'Cancel',
      variants: { Type: 'Secondary' },
    };

    const html = generateHtml([master as PenNode, refPrimary as PenNode, refSecondary as PenNode], {
      document: false,
    });

    expect(html).toContain('background-color: #111827');
    expect(html).toContain('background-color: #f3f4f6');
    // Black master fill is not emitted on its own — only the variant-selected
    // descendants are, plus reusable masters are skipped at top level.
    expect(html).not.toContain('background-color: #000000');
  });

  it('uses property defaults when ref omits `variants`', () => {
    const master = buttonMaster();
    const refDefault: RefNode = {
      id: 'rd',
      type: 'ref',
      ref: 'comp-btn',
      name: 'Default',
    };

    const html = generateHtml([master as PenNode, refDefault as PenNode], { document: false });
    expect(html).toContain('background-color: #111827');
    expect(html).not.toContain('background-color: #f3f4f6');
  });

  it('ref.descendants overrides variant-default fills', () => {
    const master = buttonMaster();
    const refCustom: RefNode = {
      id: 'rc',
      type: 'ref',
      ref: 'comp-btn',
      name: 'Custom',
      variants: { Type: 'Primary' },
      descendants: {
        'btn-bg': { fill: [{ type: 'solid', color: '#ff0000' }] },
      },
    };

    const html = generateHtml([master as PenNode, refCustom as PenNode], { document: false });
    expect(html).toContain('background-color: #ff0000');
    expect(html).not.toContain('background-color: #111827');
  });
});
