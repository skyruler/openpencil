import type { PenDocument, PenNode, FrameNode } from '@/types/pen';

import { useHistoryStore } from '@/stores/history-store';
import { useCanvasStore } from '@/stores/canvas-store';
import {
  getActivePageChildren,
  setActivePageChildren,
  insertNodeInTree,
  findNodeInTree,
} from '@/stores/document-tree-utils';

import type { DesignImportDocument, DesignImportResult } from './design-import-types';
import { mapImportToPenNodes } from './design-import-mapper';

type StoreLike = {
  document: PenDocument;
};

type SetState = (
  partial:
    | Partial<{ document: PenDocument; isDirty: boolean }>
    | ((s: StoreLike) => Partial<{ document: PenDocument; isDirty: boolean }>),
) => void;

/**
 * Insert PenNodes mapped from a {@link DesignImportDocument} into the active
 * page. The whole import is wrapped in a single history batch so undo
 * reverses it in one step.
 *
 * Insertion target:
 *   - If the active page has a single root frame, nodes drop into that frame
 *     (mirrors the empty-document scaffold where there's already a root frame).
 *   - Otherwise we prepend at the page root.
 */
export function importDesign(
  set: SetState,
  get: () => StoreLike,
  doc: DesignImportDocument,
): DesignImportResult {
  const { nodes, warnings } = mapImportToPenNodes(doc);

  if (nodes.length === 0) {
    return { inserted: [], warnings };
  }

  const activePageId = useCanvasStore.getState().activePageId;
  const history = useHistoryStore.getState();

  history.startBatch(get().document);
  try {
    const currentChildren = getActivePageChildren(get().document, activePageId);

    // If the page has exactly one root frame container, drop into it. This
    // matches the editor's default empty-document scaffold and keeps imports
    // visually anchored on the canvas.
    const targetParentId = pickTargetParent(currentChildren);

    let nextChildren = currentChildren;
    // Prepend in declared order so the first authored node ends up on top of
    // the layer panel (matching addNode default behaviour).
    for (let i = nodes.length - 1; i >= 0; i--) {
      nextChildren = insertNodeInTree(nextChildren, targetParentId, nodes[i], 0);
    }

    set((s) => ({
      document: setActivePageChildren(s.document, activePageId, nextChildren),
      isDirty: true,
    }));
  } finally {
    history.endBatch(get().document);
  }

  return {
    inserted: nodes.map((n) => n.id),
    warnings,
  };
}

/**
 * Find a single root frame to use as the insertion parent. Returns its id, or
 * null when nodes should be appended at the page root.
 */
function pickTargetParent(children: PenNode[]): string | null {
  if (children.length !== 1) return null;
  const only = children[0];
  if (only.type !== 'frame') return null;

  // Safety: verify the frame is still in the tree (insertNodeInTree expects
  // existing ids when a non-null parent is passed).
  const frame = findNodeInTree(children, only.id) as FrameNode | undefined;
  return frame ? frame.id : null;
}
