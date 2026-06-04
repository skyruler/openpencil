import { describe, expect, it, beforeEach } from 'vitest';

import { useCanvasStore } from '@/stores/canvas-store';
import { useDocumentStore } from '@/stores/document-store';
import { useHistoryStore } from '@/stores/history-store';
import type { PenNode, RefNode } from '@/types/pen';

function setupDocWithRef() {
  useDocumentStore.getState().newDocument();
  useHistoryStore.getState().clear();
  const docStore = useDocumentStore.getState();

  // The default new document already has a frame on page-1. We add a
  // reusable component and a ref instance to that page.
  const master: PenNode = {
    id: 'master-1',
    type: 'frame',
    name: 'Card',
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    reusable: true,
    fill: [{ type: 'solid', color: '#fff' }],
    children: [
      {
        id: 'master-title',
        type: 'text',
        x: 0,
        y: 0,
        content: 'Original title',
        fontSize: 16,
      } as PenNode,
    ],
  } as PenNode;

  const ref: RefNode = {
    id: 'ref-1',
    type: 'ref',
    ref: 'master-1',
    name: 'CardInstance',
    x: 300,
    y: 0,
  };

  docStore.addNode(null, master);
  docStore.addNode(null, ref as PenNode);
}

describe('updateRefDescendant store action', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      activePageId: useCanvasStore.getState().activePageId,
    });
    setupDocWithRef();
  });

  it('writes a new descendants entry on the ref node', () => {
    useHistoryStore.getState().clear();
    useDocumentStore
      .getState()
      .updateRefDescendant('ref-1', 'master-title', { content: 'Instance title' } as Partial<PenNode>);

    const ref = useDocumentStore.getState().getNodeById('ref-1') as RefNode;
    expect(ref.descendants?.['master-title']).toEqual({ content: 'Instance title' });
  });

  it('does NOT mutate the master component', () => {
    useDocumentStore
      .getState()
      .updateRefDescendant('ref-1', 'master-title', { content: 'Instance title' } as Partial<PenNode>);

    const master = useDocumentStore.getState().getNodeById('master-1') as PenNode & {
      children?: PenNode[];
    };
    const masterTitle = master.children?.find((c) => c.id === 'master-title') as
      | (PenNode & { content?: string })
      | undefined;
    expect(masterTitle?.content).toBe('Original title');
  });

  it('merges into existing descendants without clobbering sibling overrides', () => {
    const docStore = useDocumentStore.getState();
    docStore.updateRefDescendant('ref-1', 'master-title', {
      content: 'first',
    } as Partial<PenNode>);
    docStore.updateRefDescendant('ref-1', 'master-subtitle', {
      content: 'sibling',
    } as Partial<PenNode>);
    docStore.updateRefDescendant('ref-1', 'master-title', {
      content: 'second',
    } as Partial<PenNode>);

    const ref = useDocumentStore.getState().getNodeById('ref-1') as RefNode;
    expect(ref.descendants?.['master-title']).toEqual({ content: 'second' });
    expect(ref.descendants?.['master-subtitle']).toEqual({ content: 'sibling' });
  });

  it('pushes history BEFORE mutating (undo restores prior descendants)', () => {
    useHistoryStore.getState().clear();
    useDocumentStore
      .getState()
      .updateRefDescendant('ref-1', 'master-title', { content: 'After' } as Partial<PenNode>);

    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useDocumentStore.getState().isDirty).toBe(true);

    const refBefore = useDocumentStore.getState().getNodeById('ref-1') as RefNode;
    expect(refBefore.descendants?.['master-title']).toEqual({ content: 'After' });
  });

  it('is a no-op when refId does not resolve to a ref node', () => {
    const docBefore = useDocumentStore.getState().document;
    useDocumentStore
      .getState()
      .updateRefDescendant('does-not-exist', 'whatever', { content: 'x' } as Partial<PenNode>);
    const docAfter = useDocumentStore.getState().document;
    expect(docAfter).toBe(docBefore);
  });
});
