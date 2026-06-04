import type { PenDocument, PenNode, FrameNode } from '@/types/pen';
import { normalizeTreeLayout } from '@zseven-w/pen-core';

import { useHistoryStore } from '@/stores/history-store';
import { useCanvasStore } from '@/stores/canvas-store';
import {
  getActivePageChildren,
  setActivePageChildren,
  insertNodeInTree,
  findNodeInTree,
  flattenNodes,
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

  // Run the autolayout normalizer on each mapped subtree:
  //   - Infers `layout: 'vertical'` on layout-less frames that hold ≥2
  //     children (so HTML→JSON output with vanilla `<div>` containers stops
  //     piling children at (0,0)).
  //   - Strips stale x/y from children of active-layout frames so
  //     `computeLayoutPositions` is free to place them via gap + padding.
  for (const node of nodes) {
    normalizeTreeLayout(node);
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

// ---------------------------------------------------------------------------
// Native PenDocument import (no mapping, no information loss).
//
// This is the path Mira's wireframes phase uses now: she emits a
// PenDocument directly and the canvas loads it as-is via
// `useDocumentStore.applyExternalDocument`. The simplified
// DesignImportDocument shape is kept only for the SAMPLE_TASKS_INDEX
// dev-button and any third-party callers that still rely on it.
// ---------------------------------------------------------------------------

/**
 * Minimal type-guard for a PenDocument-shaped object. A document is a
 * PenDocument when it carries `version` AND either a `pages` array or a
 * `children` array at the top level — matching pen.ts.
 */
export function isPenDocumentShape(value: unknown): value is PenDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string') return false;
  return Array.isArray(candidate.pages) || Array.isArray(candidate.children);
}

/**
 * Load a native PenDocument onto the canvas via the document store's
 * `applyExternalDocument` action. No mapping, no shape downgrade — the
 * doc lands in the store exactly as authored.
 *
 * Returns the ids of every node visible in the resulting active page plus
 * any warnings raised during minimal pre-flight validation. Warnings are
 * advisory; the doc is always applied when it parses.
 *
 * The caller supplies the `applyExternalDocument` action so this module
 * stays decoupled from the document-store import (which itself depends
 * on this file — closing the cycle).
 */
export function importPenDocument(
  doc: PenDocument,
  applyExternalDocument: (doc: PenDocument) => void,
  getDocument: () => PenDocument,
): DesignImportResult {
  const warnings: string[] = [];

  // Defensive: assert the shape minimally so we don't hand the store an
  // obviously broken object. Anything thinner than this fails store
  // invariants downstream.
  if (!isPenDocumentShape(doc)) {
    warnings.push('Document does not look like a PenDocument (missing version + pages/children)');
    return { inserted: [], warnings };
  }

  const hasPages = Array.isArray(doc.pages) && doc.pages.length > 0;
  const hasChildren = Array.isArray(doc.children) && doc.children.length > 0;
  if (!hasPages && !hasChildren) {
    warnings.push('Document has no pages or top-level children — applying anyway');
  }

  // Hand the doc to the store — applyExternalDocument runs the standard
  // normalize → migrateToPages → ensureDocumentNodeIds pipeline plus the
  // history-push so this load is undoable.
  applyExternalDocument(doc);

  // Report ids visible on the active page so callers can correlate the
  // load with what the user actually sees.
  const next = getDocument();
  const activePageId = useCanvasStore.getState().activePageId;
  const children = getActivePageChildren(next, activePageId);
  const inserted = flattenNodes(children).map((n) => n.id);

  return { inserted, warnings };
}
