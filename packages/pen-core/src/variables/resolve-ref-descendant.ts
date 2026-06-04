import type { PenDocument, PenNode, RefNode } from '@zseven-w/pen-types';
import { findNodeInTree, getAllChildren } from '../tree-utils.js';

/**
 * Virtual-ID delimiter used by `remapIds` in pen-renderer/document-flattener.
 *
 * When the renderer expands a `ref` node it rewrites every descendant's id to
 * `${refId}__${descendantOriginalId}` so multiple instances of the same
 * component don't collide in the spatial index. The original descendant id is
 * what RefNode.descendants is keyed by.
 */
const REF_VIRTUAL_ID_DELIMITER = '__';

export interface RefDescendantTarget {
  /** The `ref` node's own id (where `descendants[descendantTargetId]` lives). */
  refId: string;
  /**
   * The descendant id within the COMPONENT MASTER's subtree. Use this as the
   * key when writing into `RefNode.descendants`.
   */
  descendantTargetId: string;
}

/**
 * Given a rendered node id (which may be a virtual id of the form
 * `${refId}__${descendantId}` produced by the renderer when expanding a
 * `ref`), return the ref node it belongs to and the descendant id used as the
 * key in `RefNode.descendants`.
 *
 * Returns `null` when the node is NOT inside a ref instance (i.e. it lives
 * directly in the page tree and should be edited via the normal `updateNode`
 * path).
 *
 * For nested refs (a ref child of a component which itself is referenced as a
 * ref), the renderer remaps with the OUTER ref's id, so this helper resolves
 * to the OUTER (nearest) ref — which matches the user's mental model of "I
 * clicked text inside instance X, edit instance X".
 */
export function resolveRefDescendantTarget(
  nodeId: string,
  document: PenDocument,
): RefDescendantTarget | null {
  // No delimiter → not a remapped ref descendant.
  const delimIdx = nodeId.indexOf(REF_VIRTUAL_ID_DELIMITER);
  if (delimIdx === -1) return null;

  const allNodes = getAllChildren(document);

  // The delimiter `__` is two underscores; nanoid uses single underscores so
  // collisions are unlikely. But to be robust we scan possible split points
  // (left-to-right) and accept the first one where the left side is an actual
  // ref node id in the document. Real refs sit somewhere in the doc tree.
  let searchFrom = delimIdx;
  while (searchFrom !== -1) {
    const candidateRefId = nodeId.slice(0, searchFrom);
    const candidateDescendantId = nodeId.slice(searchFrom + REF_VIRTUAL_ID_DELIMITER.length);
    if (candidateRefId && candidateDescendantId) {
      const candidate = findNodeInTree(allNodes, candidateRefId);
      if (candidate && candidate.type === 'ref') {
        return {
          refId: candidateRefId,
          descendantTargetId: candidateDescendantId,
        };
      }
    }
    searchFrom = nodeId.indexOf(
      REF_VIRTUAL_ID_DELIMITER,
      searchFrom + REF_VIRTUAL_ID_DELIMITER.length,
    );
  }

  return null;
}

/**
 * Merge a patch into `refNode.descendants[descendantTargetId]` returning a
 * NEW RefNode. Existing overrides for that descendant id are preserved and
 * spread under the new patch. Other descendant entries are untouched.
 *
 * Pure helper — caller is responsible for placing the new node back into the
 * document tree.
 */
export function mergeRefDescendantPatch(
  refNode: RefNode,
  descendantTargetId: string,
  patch: Partial<PenNode>,
): RefNode {
  const existing = refNode.descendants?.[descendantTargetId];
  const mergedEntry = { ...existing, ...patch } as Partial<PenNode>;
  return {
    ...refNode,
    descendants: {
      ...refNode.descendants,
      [descendantTargetId]: mergedEntry,
    },
  };
}
