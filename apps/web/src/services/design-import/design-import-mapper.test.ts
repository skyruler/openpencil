import { describe, it, expect } from 'vitest';
import type { FrameNode, TextNode, RectangleNode, RefNode } from '@zseven-w/pen-types';

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

  it('omits x/y on nested children when input does not specify them', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'frame',
          name: 'Col',
          flex: 'col',
          gap: 12,
          padX: 16,
          padY: 24,
          children: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
            { type: 'text', text: 'C' },
          ],
        },
      ],
    };

    const { nodes, warnings } = mapImportToPenNodes(doc);
    expect(warnings).toEqual([]);
    const root = nodes[0] as FrameNode;
    // Root nodes default to (0, 0) so they anchor at the canvas origin.
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);
    expect(root.layout).toBe('vertical');
    for (const child of root.children!) {
      // Nested children must NOT carry numeric x/y when input was silent —
      // otherwise normalizeTreeLayout interprets them as absolute-positioning
      // hints and refuses to verticalize layout-less parents.
      expect((child as TextNode).x).toBeUndefined();
      expect((child as TextNode).y).toBeUndefined();
    }
  });

  it('preserves explicit x/y on nested children', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'frame',
          name: 'Stage',
          children: [
            { type: 'rectangle', name: 'pin', x: 12, y: 34, w: 8, h: 8 },
          ],
        },
      ],
    };
    const { nodes } = mapImportToPenNodes(doc);
    const root = nodes[0] as FrameNode;
    const pin = root.children![0] as RectangleNode;
    expect(pin.x).toBe(12);
    expect(pin.y).toBe(34);
  });

  it('keeps siblings positionable in a deeply nested autolayout column', () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'frame',
          name: 'Outer',
          flex: 'col',
          gap: 10,
          padY: 8,
          children: [
            {
              type: 'frame',
              name: 'Inner',
              flex: 'col',
              gap: 4,
              children: [
                { type: 'text', text: 'leaf-a' },
                { type: 'text', text: 'leaf-b' },
              ],
            },
            { type: 'text', text: 'sibling' },
          ],
        },
      ],
    };
    const { nodes } = mapImportToPenNodes(doc);
    const outer = nodes[0] as FrameNode;
    const inner = outer.children![0] as FrameNode;
    // Inner frame is NOT the root — its x/y must be absent so autolayout
    // computes them via the parent's gap + padding (not be stuck at 0,0).
    expect(inner.x).toBeUndefined();
    expect(inner.y).toBeUndefined();
    expect(inner.layout).toBe('vertical');
    for (const leaf of inner.children!) {
      expect((leaf as TextNode).x).toBeUndefined();
      expect((leaf as TextNode).y).toBeUndefined();
    }
  });

  describe('components + instances', () => {
    it('hoists a single component definition and emits one RefNode per instance', () => {
      const doc: DesignImportDocument = {
        nodes: [
          {
            type: 'frame',
            name: 'Screen',
            flex: 'col',
            children: [
              {
                type: 'component',
                name: 'TaskRow',
                slot: [ 'title' ],
                w: 240, h: 40,
                bg: '#ffffff',
                children: [ { type: 'text', name: 'title', text: 'Placeholder' } ],
              },
              { type: 'instance', componentName: 'TaskRow' },
              { type: 'instance', componentName: 'TaskRow' },
              { type: 'instance', componentName: 'TaskRow' },
            ],
          },
        ],
      };

      const { nodes, warnings } = mapImportToPenNodes(doc);
      expect(warnings).toEqual([]);

      // First node should be the hoisted component definition (a reusable frame).
      const def = nodes[0] as FrameNode;
      expect(def.type).toBe('frame');
      expect(def.reusable).toBe(true);
      expect(def.name).toBe('TaskRow');

      // Second node is the screen frame whose children contain three RefNodes
      // (and the in-place component definition is suppressed).
      const screen = nodes[1] as FrameNode;
      const refs = (screen.children ?? []).filter((c) => c.type === 'ref') as RefNode[];
      expect(refs).toHaveLength(3);
      for (const ref of refs) {
        expect(ref.ref).toBe(def.id);
      }
    });

    it('records a warning and drops the instance when componentName is unknown', () => {
      const doc: DesignImportDocument = {
        nodes: [
          {
            type: 'frame',
            name: 'Screen',
            children: [
              { type: 'instance', componentName: 'Ghost' },
            ],
          },
        ],
      };

      const { nodes, warnings } = mapImportToPenNodes(doc);
      expect(warnings.some((w) => w.includes('Ghost'))).toBe(true);
      const screen = nodes[0] as FrameNode;
      expect(screen.children ?? []).toHaveLength(0);
    });

    it('translates slot-name overrides into RefNode.descendants keyed by child id', () => {
      const doc: DesignImportDocument = {
        nodes: [
          {
            type: 'component',
            name: 'TaskRow',
            slot: [ 'title' ],
            children: [ { type: 'text', name: 'title', text: 'Placeholder' } ],
          },
          {
            type: 'instance',
            componentName: 'TaskRow',
            overrides: { title: { text: 'Hello' } },
          },
        ],
      };

      const { nodes, warnings } = mapImportToPenNodes(doc);
      expect(warnings).toEqual([]);

      const def = nodes[0] as FrameNode;
      const titleChild = (def.children ?? [])[0] as TextNode;
      const ref = nodes[1] as RefNode;
      expect(ref.type).toBe('ref');
      expect(ref.descendants).toBeDefined();
      const patch = ref.descendants![titleChild.id] as Partial<TextNode>;
      expect(patch.content).toBe('Hello');
    });

    it('registers a component nested inside a regular frame', () => {
      const doc: DesignImportDocument = {
        nodes: [
          {
            type: 'frame',
            name: 'Wrapper',
            children: [
              {
                type: 'component',
                name: 'Pill',
                slot: [ 'label' ],
                children: [ { type: 'text', name: 'label', text: '?' } ],
              },
            ],
          },
          { type: 'instance', componentName: 'Pill', overrides: { label: { text: 'New' } } },
        ],
      };

      const { nodes, warnings } = mapImportToPenNodes(doc);
      expect(warnings).toEqual([]);

      // First node is the hoisted Pill definition; second is the Wrapper frame
      // (now empty inside, since the in-place component is suppressed); third
      // is the RefNode instance.
      const def = nodes[0] as FrameNode;
      expect(def.reusable).toBe(true);
      expect(def.name).toBe('Pill');

      const ref = nodes[2] as RefNode;
      expect(ref.type).toBe('ref');
      expect(ref.ref).toBe(def.id);
    });

    it('warns and keeps the first definition when two components share a name', () => {
      const doc: DesignImportDocument = {
        nodes: [
          { type: 'component', name: 'Dup', children: [ { type: 'text', text: 'first' } ] },
          { type: 'component', name: 'Dup', children: [ { type: 'text', text: 'second' } ] },
          { type: 'instance', componentName: 'Dup' },
        ],
      };

      const { nodes, warnings } = mapImportToPenNodes(doc);
      expect(warnings.some((w) => w.toLowerCase().includes('duplicate'))).toBe(true);

      const def = nodes[0] as FrameNode;
      expect(def.reusable).toBe(true);
      const firstChild = (def.children ?? [])[0] as TextNode;
      // The FIRST definition wins; the second's "second" string never appears.
      expect(firstChild.content).toBe('first');
    });
  });

  it('verticalizes layout-less HTML-converted frames after the import action runs', async () => {
    // The HTML→JSON converter emits frames without `flex` for vanilla
    // `<div>` containers. Together with the mapper omitting x/y, the
    // store-action's normalizeTreeLayout pass must verticalize them so
    // children don't collapse onto the parent origin.
    const { htmlToImportJson } = await import('./html-to-import-json');
    const { normalizeTreeLayout } = await import('@zseven-w/pen-core');
    // No padding/gap on the outer div — keeps inferLayout() returning
    // undefined so the ≥2-child vertical fallback fires.
    const { document } = htmlToImportJson(
      '<div class="bg-white"><p>one</p><p>two</p><p>three</p></div>',
    );
    const { nodes } = mapImportToPenNodes(document);
    for (const n of nodes) normalizeTreeLayout(n);
    const root = nodes[0] as FrameNode;
    expect(root.layout).toBe('vertical');
    // Children must remain without numeric x/y so computeLayoutPositions can
    // place them by gap/padding at render time.
    expect(root.children).toHaveLength(3);
    for (const child of root.children!) {
      expect((child as TextNode).x).toBeUndefined();
      expect((child as TextNode).y).toBeUndefined();
    }
  });
});
