import { generateId } from '@zseven-w/pen-core';
import type {
  PenNode,
  FrameNode,
  RectangleNode,
  EllipseNode,
  TextNode,
  ImageNode,
} from '@zseven-w/pen-types';
import type { PenFill, SolidFill } from '@/types/styles';

import type {
  DesignImportDocument,
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
]);

const ALLOWED_TYPES = new Set<DesignImportType>([
  'frame',
  'text',
  'rectangle',
  'ellipse',
  'image',
]);

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
 */
export function mapImportToPenNodes(doc: DesignImportDocument): MapResult {
  const warnings: string[] = [];
  const nodes: PenNode[] = [];

  for (const child of doc.nodes ?? []) {
    const mapped = mapNode(child, warnings, '$');
    if (mapped) nodes.push(mapped);
  }

  return { nodes, warnings };
}

function mapNode(
  input: DesignImportNode,
  warnings: string[],
  path: string,
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
      return mapFrame(input, warnings, nodePath);
    case 'rectangle':
      return mapRectangle(input, warnings, nodePath);
    case 'ellipse':
      return mapEllipse(input, warnings, nodePath);
    case 'text':
      return mapText(input, warnings);
    case 'image':
      return mapImage(input, warnings, nodePath);
    default: {
      // Exhaustiveness — `type` is constrained but be defensive.
      const exhaustive: never = input.type;
      warnings.push(`${nodePath}: unhandled type "${String(exhaustive)}"`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-type mappers
// ---------------------------------------------------------------------------

function mapFrame(input: DesignImportNode, warnings: string[], path: string): FrameNode {
  const id = generateId();
  const children: PenNode[] = [];

  for (const child of input.children ?? []) {
    const mapped = mapNode(child, warnings, path);
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
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.w,
    height: input.h,
    children,
  };

  applyContainerStyle(node, input);
  applyAutoLayout(node, input);

  return node;
}

function mapRectangle(input: DesignImportNode, warnings: string[], path: string): RectangleNode {
  const children: PenNode[] = [];
  for (const child of input.children ?? []) {
    const mapped = mapNode(child, warnings, path);
    if (mapped) children.push(mapped);
  }

  if (typeof input.text === 'string' && input.text.length > 0) {
    children.unshift(makeImpliedTextChild(input));
  }

  const node: RectangleNode = {
    id: generateId(),
    type: 'rectangle',
    name: input.name ?? 'Rectangle',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.w,
    height: input.h,
    children: children.length > 0 ? children : undefined,
  };

  applyContainerStyle(node, input);
  applyAutoLayout(node, input);

  return node;
}

function mapEllipse(input: DesignImportNode, warnings: string[], path: string): EllipseNode {
  if (input.children && input.children.length > 0) {
    warnings.push(`${path}: ellipse cannot have children — they were dropped`);
  }

  const node: EllipseNode = {
    id: generateId(),
    type: 'ellipse',
    name: input.name ?? 'Ellipse',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.w,
    height: input.h,
  };

  if (typeof input.radius === 'number') node.cornerRadius = input.radius;
  const fill = makeSolidFill(input.bg);
  if (fill) node.fill = [fill];

  return node;
}

function mapText(input: DesignImportNode, warnings: string[]): TextNode {
  const content = typeof input.text === 'string' ? input.text : '';
  if (!content) warnings.push(`text node "${input.name ?? ''}": empty content`);

  const node: TextNode = {
    id: generateId(),
    type: 'text',
    name: input.name ?? 'Text',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.w,
    height: input.h,
    content,
  };

  if (typeof input.fontSize === 'number') node.fontSize = input.fontSize;
  if (input.fontWeight !== undefined) node.fontWeight = input.fontWeight;
  const fill = makeSolidFill(input.color);
  if (fill) node.fill = [fill];

  return node;
}

function mapImage(input: DesignImportNode, warnings: string[], path: string): ImageNode | null {
  if (!input.src || typeof input.src !== 'string') {
    warnings.push(`${path}: image without "src" — skipped`);
    return null;
  }

  const node: ImageNode = {
    id: generateId(),
    type: 'image',
    name: input.name ?? 'Image',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.w,
    height: input.h,
    src: input.src,
  };

  if (typeof input.radius === 'number') node.cornerRadius = input.radius;

  return node;
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
