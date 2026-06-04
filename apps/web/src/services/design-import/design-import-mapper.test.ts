import { describe, it, expect } from 'vitest';
import type { FrameNode, TextNode, RectangleNode } from '@zseven-w/pen-types';

import { mapImportToPenNodes } from './design-import-mapper';
import type { DesignImportDocument } from './design-import-types';

describe('mapImportToPenNodes', () => {
  it('maps a frame with bg + radius into fills + cornerRadius', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'frame',
          name: 'Card',
          w: 200,
          h: 100,
          bg: '#fafafa',
          radius: 12,
        },
      ],
    };

    const { nodes, warnings } = mapImportToPenNodes(doc);

    expect(warnings).toEqual([]);
    expect(nodes).toHaveLength(1);
    const frame = nodes[0] as FrameNode;
    expect(frame.type).toBe('frame');
    expect(frame.name).toBe('Card');
    expect(frame.width).toBe(200);
    expect(frame.height).toBe(100);
    expect(frame.fill).toEqual([{ type: 'solid', color: '#fafafa' }]);
    expect(frame.cornerRadius).toBe(12);
    expect(frame.id).toBeTruthy();
  });

  it('sets typography on text nodes from fontSize/fontWeight/color', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'text',
          name: 'Heading',
          text: 'Tasks',
          fontSize: 24,
          fontWeight: 600,
          color: '#111827',
        },
      ],
    };

    const { nodes, warnings } = mapImportToPenNodes(doc);

    expect(warnings).toEqual([]);
    const text = nodes[0] as TextNode;
    expect(text.type).toBe('text');
    expect(text.content).toBe('Tasks');
    expect(text.fontSize).toBe(24);
    expect(text.fontWeight).toBe(600);
    expect(text.fill).toEqual([{ type: 'solid', color: '#111827' }]);
  });

  it('maps nested flex + gap + pad into autolayout props', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'frame',
          name: 'Row',
          flex: 'row',
          gap: 12,
          padX: 16,
          padY: 8,
          children: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
          ],
        },
      ],
    };

    const { nodes, warnings } = mapImportToPenNodes(doc);

    expect(warnings).toEqual([]);
    const frame = nodes[0] as FrameNode;
    expect(frame.layout).toBe('horizontal');
    expect(frame.gap).toBe(12);
    // padY first (top/bottom), then padX (left/right)
    expect(frame.padding).toEqual([8, 16]);
    expect(frame.children).toHaveLength(2);
    expect((frame.children![0] as TextNode).content).toBe('A');
  });

  it('records a warning for unknown keys and skips them', () => {
    const input = {
      nodes: [
        {
          type: 'frame',
          name: 'Card',
          mystery: 'value',
          anotherUnknown: 42,
        },
      ],
    } as unknown as DesignImportDocument;

    const { nodes, warnings } = mapImportToPenNodes(input);

    expect(nodes).toHaveLength(1);
    expect(warnings.some((w) => w.includes('mystery'))).toBe(true);
    expect(warnings.some((w) => w.includes('anotherUnknown'))).toBe(true);
    const frame = nodes[0] as FrameNode;
    // The unknown key did not leak onto the PenNode.
    expect((frame as unknown as Record<string, unknown>).mystery).toBeUndefined();
  });

  it('inlines a text child when `text` shorthand is set on a non-text node', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'frame',
          name: 'Button',
          w: 120,
          h: 36,
          bg: '#111827',
          text: 'Add task',
          fontSize: 14,
          color: '#ffffff',
        },
      ],
    };

    const { nodes, warnings } = mapImportToPenNodes(doc);

    expect(warnings).toEqual([]);
    const frame = nodes[0] as FrameNode;
    expect(frame.children).toHaveLength(1);
    const text = frame.children![0] as TextNode;
    expect(text.type).toBe('text');
    expect(text.content).toBe('Add task');
    expect(text.fontSize).toBe(14);
    expect(text.fill).toEqual([{ type: 'solid', color: '#ffffff' }]);
  });

  it('keeps rectangle children when present', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'rectangle',
          name: 'Tile',
          w: 100,
          h: 100,
          bg: '#ffffff',
          children: [{ type: 'text', text: 'Hello' }],
        },
      ],
    };

    const { nodes } = mapImportToPenNodes(doc);
    const rect = nodes[0] as RectangleNode;
    expect(rect.type).toBe('rectangle');
    expect(rect.children).toHaveLength(1);
    expect((rect.children![0] as TextNode).content).toBe('Hello');
  });
});
