import { generateId } from '@zseven-w/pen-core';
import type {
  PenNode,
  FrameNode,
  RectangleNode,
  EllipseNode,
  TextNode,
  ImageNode,
  RefNode,
} from '@zseven-w/pen-types';
import type { PenFill, SolidFill } from '@/types/styles';

import type {
  DesignImportDocument,
  DesignImportInstanceOverride,
  DesignImportNode,
  DesignImportType,
} from './design-import-types';

/** Keys the mapper actively consumes — anything else is reported as a warning. */
const KNOWN_KEYS = new Set<keyof DesignImportNode>([
  'type',
  'name',
  'x',
  'y',
  'w',
  'h',
  'bg',
  'text',
  'fontSize',
  'fontWeight',
  'color',
  'radius',
  'padX',
  'padY',
  'gap',
  'flex',
  'src',
  'children',
  'slot',
  'componentName',
  'overrides',
]);

const ALLOWED_TYPES = new Set<DesignImportType>([
  'frame',
  'text',
  'rectangle',
  'ellipse',
  'image',
  'component',
  'instance',
]);

/**
 * Registry built in pass-1: maps a component's author-supplied `name` to its
 * generated FrameNode id and to a {slotName → childId} table so instance
 * overrides can be translated from slot-name keys (author-friendly) to the
 * child-id keys PenNode's RefNode.descendants actually consumes.
 */
interface ComponentRegistryEntry {
  /** Generated FrameNode id — used as the RefNode `ref`. */
  id: string;
  /** slotName → childId, derived from the component's declared `slot[]`. */
  slotChildIds: Record<string, string>;
  /** The emitted FrameNode definition (held so caller can hoist it). */
  frame: FrameNode;
}

type ComponentRegistry = Map<string, ComponentRegistryEntry>;

export interface MapResult {
  /** PenNodes produced from the input tree. */
  nodes: PenNode[];
  /** Non-fatal warnings raised during mapping. */
  warnings: string[];
}

/**
 * Walk an author-friendly import tree and produce canonical PenNodes ready to
 * be inserted into the document store. Unknown nodes / fields are skipped and
 * surfaced as warnings.
 *
 * Two-pass conversion when the tree contains `component` / `instance` nodes:
 *
 *   1. Walk the input tree depth-first registering every `component` node
 *      under its `name`. Each registered component is emitted as a
 *      `FrameNode { reusable: true, … }` and hoisted to the FRONT of the
 *      output array so it precedes any instances that reference it. Duplicate
 *      component names emit a warning and keep the first definition (last-
 *      writer-wins is more error-prone — Mira can rename to disambiguate).
 *
 *   2. The full tree walk substitutes `instance` nodes with `RefNode`s
 *      pointing at the registered component id, translating slot-name
 *      overrides into the child-id keyed `descendants` map RefNode expects.
 *      Instances that reference an unknown `componentName` are dropped with a
 *      warning so the rest of the screen still imports.
 *
 * Components are hoisted (not left in place) so the document tree only walks
 * past each definition once — instances are pure references and don't carry
 * any child geometry that would otherwise re-render.
 */
export function mapImportToPenNodes(doc: DesignImportDocument): MapResult {
  const warnings: string[] = [];
  const registry: ComponentRegistry = new Map();

  // Pass 1 — discover and emit component definitions.
  for (const child of doc.nodes ?? []) {
    registerComponents(child, warnings, '$', registry);
  }

  // Pass 2 — walk the input tree converting nodes, with instances resolving
  // against the registry built in pass 1.
  const nodes: PenNode[] = [];
  for (const child of doc.nodes ?? []) {
    const mapped = mapNode(child, warnings, '$', true, registry);
    if (mapped) nodes.push(mapped);
  }

  // Hoist all component definitions to the front of the output array. The
  // canvas engine resolves RefNodes by id from anywhere in the tree, but
  // keeping definitions first keeps the layer panel readable and matches the
  // convention used elsewhere in pen-core's component utilities.
  if (registry.size > 0) {
    const components = Array.from(registry.values()).map((e) => e.frame as PenNode);
    return { nodes: [ ...components, ...nodes ], warnings };
  }

  return { nodes, warnings };
}

/**
 * Pass 1 — recursively find every `{ type: 'component' }` in the input tree,
 * convert it to a reusable FrameNode, and register it under its author-given
 * name so pass 2 can resolve instance references. Component children are
 * mapped through `mapNode` so all the standard frame styling applies (bg,
 * radius, autolayout, etc.).
 */
function registerComponents(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  registry: ComponentRegistry,
): void {
  if (!input || typeof input !== 'object') return;

  if (input.type === 'component') {
    const name = typeof input.name === 'string' ? input.name : '';
    if (!name) {
      warnings.push(`${path}: component without "name" — skipped`);
      return;
    }
    if (registry.has(name)) {
      warnings.push(`${path}: duplicate component name "${name}" — first definition kept`);
      return;
    }

    const frame = buildComponentFrame(input, warnings, `${path}.${name}`, registry);
    const slotChildIds: Record<string, string> = {};
    for (const slotName of input.slot ?? []) {
      const match = findChildIdByName(frame.children, slotName);
      if (match) slotChildIds[slotName] = match;
    }
    registry.set(name, { id: frame.id, slotChildIds, frame });
    return;
  }

  for (const child of input.children ?? []) {
    registerComponents(child, warnings, `${path}.${input.name ?? input.type}`, registry);
  }
}

/** Build the FrameNode that backs a component definition. */
function buildComponentFrame(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  registry: ComponentRegistry,
): FrameNode {
  const id = generateId();
  const children: PenNode[] = [];
  for (const child of input.children ?? []) {
    // Skip nested `component` declarations — they're handled by pass-1
    // recursion separately so each component sits as its own top-level
    // definition rather than nesting under a parent component.
    if (child?.type === 'component') continue;
    const mapped = mapNode(child, warnings, path, false, registry);
    if (mapped) children.push(mapped);
  }

  const frame: FrameNode = {
    id,
    type: 'frame',
    name: input.name ?? 'Component',
    reusable: true,
    width: input.w,
    height: input.h,
    children,
  };
  if (Array.isArray(input.slot) && input.slot.length > 0) {
    frame.slot = [ ...input.slot ];
  }
  applyContainerStyle(frame, input);
  applyAutoLayout(frame, input);
  return frame;
}

function findChildIdByName(children: PenNode[] | undefined, slotName: string): string | undefined {
  if (!children) return undefined;
  for (const child of children) {
    if (child.name === slotName) return child.id;
    if ('children' in child && child.children) {
      const nested = findChildIdByName(child.children, slotName);
      if (nested) return nested;
    }
  }
  return undefined;
}

function mapNode(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  isRoot: boolean,
  registry: ComponentRegistry,
): PenNode | null {
  if (!input || typeof input !== 'object') {
    warnings.push(`${path}: skipped non-object node`);
    return null;
  }

  if (!ALLOWED_TYPES.has(input.type)) {
    warnings.push(`${path}: unsupported type "${String(input.type)}" — skipped`);
    return null;
  }

  // Surface unknown keys for the caller — they're skipped silently otherwise.
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key as keyof DesignImportNode)) {
      warnings.push(`${path}: unknown key "${key}" — skipped`);
    }
  }

  const nodePath = `${path}.${input.name ?? input.type}`;

  switch (input.type) {
    case 'frame':
      return mapFrame(input, warnings, nodePath, isRoot, registry);
    case 'rectangle':
      return mapRectangle(input, warnings, nodePath, isRoot, registry);
    case 'ellipse':
      return mapEllipse(input, warnings, nodePath, isRoot);
    case 'text':
      return mapText(input, warnings, isRoot);
    case 'image':
      return mapImage(input, warnings, nodePath, isRoot);
    case 'component':
      // Component definitions are registered + hoisted in pass 1. In pass 2
      // we skip them in-place so the same frame doesn't render twice.
      return null;
    case 'instance':
      return mapInstance(input, warnings, nodePath, isRoot, registry);
    default: {
      // Exhaustiveness — `type` is constrained but be defensive.
      const exhaustive: never = input.type;
      warnings.push(`${nodePath}: unhandled type "${String(exhaustive)}"`);
      return null;
    }
  }
}

/**
 * Assign x/y onto an output PenNode following autolayout-friendly rules:
 *
 *   - If the input explicitly carries `x` (or `y`), pass it through.
 *   - Otherwise, leave the field absent when the node is nested inside a
 *     parent. PenNodeBase makes both fields optional, so absent coordinates
 *     let the layout engine — and `normalizeTreeLayout`'s "infer vertical
 *     fallback" heuristic — position children purely from `gap` / `padding`
 *     instead of being trapped at (0, 0).
 *   - For root nodes (top of the imported tree) default to 0 so the screen
 *     lands at the canvas origin rather than floating undefined.
 *
 * The previous behavior (`x: input.x ?? 0`) actively broke autolayout: every
 * child carried a numeric x/y, which `normalizeTreeLayout` interpreted as
 * "this parent uses absolute positioning, don't verticalize" — leaving
 * layout-less frames with their children piled at the parent origin.
 */
function assignPosition(
  out: { x?: number; y?: number },
  input: DesignImportNode,
  isRoot: boolean,
): void {
  if (typeof input.x === 'number') out.x = input.x;
  else if (isRoot) out.x = 0;
  if (typeof input.y === 'number') out.y = input.y;
  else if (isRoot) out.y = 0;
}

// ---------------------------------------------------------------------------
// Per-type mappers
// ---------------------------------------------------------------------------

function mapFrame(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  isRoot: boolean,
  registry: ComponentRegistry,
): FrameNode {
  const id = generateId();
  const children: PenNode[] = [];

  for (const child of input.children ?? []) {
    const mapped = mapNode(child, warnings, path, false, registry);
    if (mapped) children.push(mapped);
  }

  // `text` shorthand on a non-text node => prepend a child text node.
  if (typeof input.text === 'string' && input.text.length > 0) {
    children.unshift(makeImpliedTextChild(input));
  }

  const node: FrameNode = {
    id,
    type: 'frame',
    name: input.name ?? 'Frame',
    width: input.w,
    height: input.h,
    children,
  };
  assignPosition(node, input, isRoot);

  applyContainerStyle(node, input);
  applyAutoLayout(node, input);

  return node;
}

function mapRectangle(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  isRoot: boolean,
  registry: ComponentRegistry,
): RectangleNode {
  const children: PenNode[] = [];
  for (const child of input.children ?? []) {
    const mapped = mapNode(child, warnings, path, false, registry);
    if (mapped) children.push(mapped);
  }

  if (typeof input.text === 'string' && input.text.length > 0) {
    children.unshift(makeImpliedTextChild(input));
  }

  const node: RectangleNode = {
    id: generateId(),
    type: 'rectangle',
    name: input.name ?? 'Rectangle',
    width: input.w,
    height: input.h,
    children: children.length > 0 ? children : undefined,
  };
  assignPosition(node, input, isRoot);

  applyContainerStyle(node, input);
  applyAutoLayout(node, input);

  return node;
}

function mapEllipse(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  isRoot: boolean,
): EllipseNode {
  if (input.children && input.children.length > 0) {
    warnings.push(`${path}: ellipse cannot have children — they were dropped`);
  }

  const node: EllipseNode = {
    id: generateId(),
    type: 'ellipse',
    name: input.name ?? 'Ellipse',
    width: input.w,
    height: input.h,
  };
  assignPosition(node, input, isRoot);

  if (typeof input.radius === 'number') node.cornerRadius = input.radius;
  const fill = makeSolidFill(input.bg);
  if (fill) node.fill = [fill];

  return node;
}

function mapText(input: DesignImportNode, warnings: string[], isRoot: boolean): TextNode {
  const content = typeof input.text === 'string' ? input.text : '';
  if (!content) warnings.push(`text node "${input.name ?? ''}": empty content`);

  const node: TextNode = {
    id: generateId(),
    type: 'text',
    name: input.name ?? 'Text',
    width: input.w,
    height: input.h,
    content,
  };
  assignPosition(node, input, isRoot);

  if (typeof input.fontSize === 'number') node.fontSize = input.fontSize;
  if (input.fontWeight !== undefined) node.fontWeight = input.fontWeight;
  const fill = makeSolidFill(input.color);
  if (fill) node.fill = [fill];

  return node;
}

function mapImage(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  isRoot: boolean,
): ImageNode | null {
  if (!input.src || typeof input.src !== 'string') {
    warnings.push(`${path}: image without "src" — skipped`);
    return null;
  }

  const node: ImageNode = {
    id: generateId(),
    type: 'image',
    name: input.name ?? 'Image',
    width: input.w,
    height: input.h,
    src: input.src,
  };
  assignPosition(node, input, isRoot);

  if (typeof input.radius === 'number') node.cornerRadius = input.radius;

  return node;
}

/**
 * Translate a `{ type: 'instance', componentName: 'X', overrides: {...} }`
 * import node into a PenNode `RefNode`. Returns null when the referenced
 * component name is unknown so the caller can skip it without aborting the
 * rest of the import.
 */
function mapInstance(
  input: DesignImportNode,
  warnings: string[],
  path: string,
  isRoot: boolean,
  registry: ComponentRegistry,
): RefNode | null {
  const name = typeof input.componentName === 'string' ? input.componentName : '';
  if (!name) {
    warnings.push(`${path}: instance without "componentName" — skipped`);
    return null;
  }
  const entry = registry.get(name);
  if (!entry) {
    warnings.push(`${path}: instance references unknown component "${name}" — skipped`);
    return null;
  }

  const node: RefNode = {
    id: generateId(),
    type: 'ref',
    name: input.name ?? name,
    ref: entry.id,
  };
  assignPosition(node, input, isRoot);

  const descendants = buildDescendants(input.overrides, entry, warnings, path);
  if (descendants) node.descendants = descendants;

  return node;
}

/**
 * Translate the author's `overrides: { <slotName>: { text, bg, color } }`
 * shape into RefNode's `descendants: Record<childId, Partial<PenNode>>` map.
 * Unknown slot names are reported as warnings and skipped so a typo in one
 * slot doesn't kill the rest of the overrides.
 */
function buildDescendants(
  overrides: Record<string, DesignImportInstanceOverride> | undefined,
  entry: ComponentRegistryEntry,
  warnings: string[],
  path: string,
): Record<string, Partial<PenNode>> | undefined {
  if (!overrides) return undefined;
  const out: Record<string, Partial<PenNode>> = {};
  let any = false;

  for (const [slotName, override] of Object.entries(overrides)) {
    const childId = entry.slotChildIds[slotName];
    if (!childId) {
      warnings.push(`${path}: override targets unknown slot "${slotName}" — skipped`);
      continue;
    }
    const patch: Partial<PenNode> = {};
    if (typeof override.text === 'string') {
      (patch as Partial<TextNode>).content = override.text;
    }
    const bg = makeSolidFill(override.bg);
    if (bg) {
      (patch as Partial<FrameNode>).fill = [bg];
    }
    const color = makeSolidFill(override.color);
    if (color) {
      // `color` is the text-fill shorthand on the author side; in PenNode
      // both frames and text use the `fill` field, so a text override slot
      // that asks for a new color just becomes a fill on the descendant.
      (patch as Partial<TextNode>).fill = [color];
    }
    if (Object.keys(patch).length > 0) {
      out[childId] = patch;
      any = true;
    }
  }

  return any ? out : undefined;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function applyContainerStyle(
  node: FrameNode | RectangleNode,
  input: DesignImportNode,
): void {
  const fill = makeSolidFill(input.bg);
  if (fill) node.fill = [fill];
  if (typeof input.radius === 'number') node.cornerRadius = input.radius;
}

function applyAutoLayout(
  node: FrameNode | RectangleNode,
  input: DesignImportNode,
): void {
  const hasLayoutHint =
    input.flex !== undefined ||
    typeof input.gap === 'number' ||
    typeof input.padX === 'number' ||
    typeof input.padY === 'number';

  if (!hasLayoutHint) return;

  if (input.flex === 'row') node.layout = 'horizontal';
  else if (input.flex === 'col') node.layout = 'vertical';

  if (typeof input.gap === 'number') node.gap = input.gap;

  const padY = typeof input.padY === 'number' ? input.padY : undefined;
  const padX = typeof input.padX === 'number' ? input.padX : undefined;
  if (padY !== undefined || padX !== undefined) {
    node.padding = [padY ?? 0, padX ?? 0];
  }
}

function makeSolidFill(color: string | undefined): SolidFill | null {
  if (!color || typeof color !== 'string') return null;
  return { type: 'solid', color } satisfies SolidFill;
}

function makeImpliedTextChild(input: DesignImportNode): TextNode {
  const text: TextNode = {
    id: generateId(),
    type: 'text',
    name: 'Text',
    content: input.text ?? '',
  };
  if (typeof input.fontSize === 'number') text.fontSize = input.fontSize;
  if (input.fontWeight !== undefined) text.fontWeight = input.fontWeight;
  const fill = makeSolidFill(input.color);
  if (fill) text.fill = [fill];
  return text;
}

// PenFill re-export so callers can stay in this module without reaching into
// pen-types directly when extending the mapper.
export type { PenFill };
