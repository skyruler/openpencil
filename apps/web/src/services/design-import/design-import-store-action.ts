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

// Bake every `ref` node into a deep clone of its component subtree so
// every label/title/text in the screens becomes an editable Text node
// in the canvas. Refs themselves stay un-editable in OP's editor; the
// detach gives the user direct click-to-edit on every instance.
function detachRefsInDocument(doc: PenDocument): PenDocument {
  const componentsById = new Map<string, FrameNode>();
  const indexComponents = (nodes: PenNode[] | undefined): void => {
    if (!nodes) return;
    for (const n of nodes) {
      if (n.type === 'frame' && (n as FrameNode & { reusable?: boolean }).reusable === true) {
        componentsById.set(n.id, n as FrameNode);
      }
      const kids = (n as { children?: PenNode[] }).children;
      if (kids) indexComponents(kids);
    }
  };
  indexComponents(doc.children);
  for (const p of doc.pages ?? []) indexComponents(p.children);

  let idCounter = 0;
  const freshId = (): string => `dt-${Date.now().toString(36)}-${idCounter++}`;

  const deepClone = (node: PenNode): PenNode => {
    const cloned: PenNode = { ...node, id: freshId() };
    const kids = (node as { children?: PenNode[] }).children;
    if (kids) (cloned as { children?: PenNode[] }).children = kids.map(deepClone);
    return cloned;
  };

  const detach = (node: PenNode): PenNode => {
    if (node.type === 'ref') {
      const refTarget = (node as { ref?: string }).ref;
      const component = refTarget ? componentsById.get(refTarget) : undefined;
      if (!component) return { ...node }; // ref points nowhere — leave as-is
      const cloned = deepClone({ ...component, reusable: undefined } as PenNode) as FrameNode;
      // Carry the ref's own position/name onto the materialised frame.
      const refMeta = node as { x?: number; y?: number; name?: string };
      if (typeof refMeta.x === 'number') (cloned as { x?: number }).x = refMeta.x;
      if (typeof refMeta.y === 'number') (cloned as { y?: number }).y = refMeta.y;
      if (refMeta.name) (cloned as { name?: string }).name = refMeta.name;
      return cloned;
    }
    const out: PenNode = { ...node };
    const kids = (node as { children?: PenNode[] }).children;
    if (kids) (out as { children?: PenNode[] }).children = kids.map(detach);
    return out;
  };

  const next: PenDocument = {
    ...doc,
    children: (doc.children ?? []).map(detach),
  };
  if (doc.pages) {
    // Detach refs in every screen page. Drop reusable frames so the
    // template definitions don't render above the screen content.
    next.pages = doc.pages.map((p) => ({
      ...p,
      children: p.children
        .filter((n) => !(n.type === 'frame' && (n as FrameNode & { reusable?: boolean }).reusable === true))
        .map(detach),
    }));
  }
  return next;
}

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
  //
  // pen-core's normalizePenDocument unconditionally calls
  // `doc.children.map(...)`; if Mira emitted only `pages` (no top-level
  // `children`), that crashes with "Cannot read properties of undefined
  // (reading 'map')". Pad it so the store gets a stable shape.
  //
  // Then DETACH every `ref` so every screen has its own editable copy
  // of the component — refs make text un-editable in-place, and for
  // wireframe iteration the user wants click-to-edit on every label.
  const safeDoc: PenDocument = {
    ...doc,
    children: Array.isArray(doc.children) ? doc.children : [],
  };
  const detached = detachRefsInDocument(safeDoc);
  applyExternalDocument(detached);

  // Report ids visible on the active page so callers can correlate the
  // load with what the user actually sees.
  const next = getDocument();
  const activePageId = useCanvasStore.getState().activePageId;
  const children = getActivePageChildren(next, activePageId);
  const inserted = flattenNodes(children).map((n) => n.id);

  return { inserted, warnings };
}
