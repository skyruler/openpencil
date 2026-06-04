import { describe, it, expect } from 'vitest';
import type { PenDocument, PenNode, RefNode, TextNode, FrameNode } from '@zseven-w/pen-types';
import {
  resolveRefDescendantTarget,
  mergeRefDescendantPatch,
} from '../variables/resolve-ref-descendant';

function makeDoc(children: PenNode[]): PenDocument {
  return {
    version: '1.0.0',
    pages: [{ id: 'page-1', name: 'Page 1', children }],
    children: [],
  };
}

function refNode(id: string, ref: string, descendants?: RefNode['descendants']): RefNode {
  return {
    id,
    type: 'ref',
    ref,
    name: id,
    x: 0,
    y: 0,
    descendants,
  };
}

function frameNode(id: string, children: PenNode[] = [], reusable = false): FrameNode {
  return {
    id,
    type: 'frame',
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fill: [{ type: 'solid', color: '#fff' }],
    reusable: reusable || undefined,
    children,
  };
}

function textNode(id: string, content = 'hello'): TextNode {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    content,
    fontSize: 16,
  } as TextNode;
}

describe('resolveRefDescendantTarget', () => {
  it('returns refId + descendantTargetId for a text inside a ref', () => {
    const master = frameNode('comp-1', [textNode('child-text')], true);
    const ref = refNode('ref-A', 'comp-1');
    const doc = makeDoc([master, ref]);

    // Renderer's virtual id format: `${refId}__${childId}`
    const virtualId = 'ref-A__child-text';
    const result = resolveRefDescendantTarget(virtualId, doc);

    expect(result).toEqual({ refId: 'ref-A', descendantTargetId: 'child-text' });
  });

  it('returns null for a text outside any ref', () => {
    const standalone = textNode('plain-text');
    const doc = makeDoc([standalone]);

    const result = resolveRefDescendantTarget('plain-text', doc);
    expect(result).toBeNull();
  });

  it('returns null when the candidate refId does not point to a ref node', () => {
    // Frame with a name containing __ should not be mistaken for a ref id.
    const frame = frameNode('plain-frame', [textNode('inner')]);
    const doc = makeDoc([frame]);

    // Construct a fake virtual id whose left side is the frame id (not a ref).
    const result = resolveRefDescendantTarget('plain-frame__inner', doc);
    expect(result).toBeNull();
  });

  it('returns the NEAREST (outer) ref for nested refs', () => {
    // The renderer remaps with the OUTER ref's id when expanding a ref whose
    // component contains another ref or a deeply nested child.
    const innerMaster = frameNode('comp-inner', [textNode('leaf')], true);
    const outerMaster = frameNode(
      'comp-outer',
      [refNode('inner-ref-in-master', 'comp-inner')],
      true,
    );
    const outerRef = refNode('ref-outer', 'comp-outer');
    const doc = makeDoc([innerMaster, outerMaster, outerRef]);

    const virtualId = 'ref-outer__leaf';
    const result = resolveRefDescendantTarget(virtualId, doc);
    expect(result).toEqual({ refId: 'ref-outer', descendantTargetId: 'leaf' });
  });

  it('handles refs that live nested inside frames on the page', () => {
    const master = frameNode('comp-X', [textNode('headline')], true);
    const ref = refNode('ref-Y', 'comp-X');
    const wrapper = frameNode('wrapper', [ref]);
    const doc = makeDoc([master, wrapper]);

    const result = resolveRefDescendantTarget('ref-Y__headline', doc);
    expect(result).toEqual({ refId: 'ref-Y', descendantTargetId: 'headline' });
  });
});

describe('mergeRefDescendantPatch', () => {
  it('creates descendants entry when none exists', () => {
    const ref = refNode('r1', 'c1');
    const next = mergeRefDescendantPatch(ref, 'child-1', { content: 'new text' });
    expect(next.descendants).toEqual({ 'child-1': { content: 'new text' } });
  });

  it('merges into an existing descendant entry without clobbering other patches', () => {
    const ref = refNode('r1', 'c1', {
      'child-1': { content: 'old', visible: true } as Partial<PenNode>,
      'child-2': { content: 'sibling override' } as Partial<PenNode>,
    });

    const next = mergeRefDescendantPatch(ref, 'child-1', { content: 'updated' });

    // child-1.visible preserved, content updated
    expect(next.descendants?.['child-1']).toEqual({ content: 'updated', visible: true });
    // child-2 untouched
    expect(next.descendants?.['child-2']).toEqual({ content: 'sibling override' });
  });

  it('returns a new RefNode (does not mutate input)', () => {
    const ref = refNode('r1', 'c1', { 'child-1': { content: 'orig' } as Partial<PenNode> });
    const next = mergeRefDescendantPatch(ref, 'child-1', { content: 'new' });
    expect(next).not.toBe(ref);
    expect(next.descendants).not.toBe(ref.descendants);
    // input unchanged
    expect(ref.descendants?.['child-1']).toEqual({ content: 'orig' });
  });
});
