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

/**
 * Minimal PenNode → HTML generator.
 *
 * Designed to consume the subset of PenNode types our import mapper emits
 * (`frame`, `rectangle`, `ellipse`, `text`, `image`, `ref` for component
 * instances). Outputs a single self-contained HTML document with Tailwind
 * loaded from the CDN so the result can be opened in a browser or embedded
 * in an iframe without further tooling.
 *
 * Translation rules — kept intentionally narrow because Mira's import JSON
 * uses a shorthand subset (bg, radius, padX/padY, gap, flex) that the
 * design-import-mapper has already normalized onto canonical PenNode fields:
 *
 *   - container nodes (frame, rectangle, ref) → `<div>` with Tailwind utility
 *     classes derived from fill / cornerRadius / layout / gap / padding.
 *   - ellipse                                  → `<div>` with `rounded-full`
 *     and the same fill rules as a container.
 *   - text                                     → `<span>` (block when it
 *     has explicit width) carrying inline content; font-size/weight/color
 *     resolved to Tailwind utilities + fall-back inline styles when no
 *     utility matches.
 *   - image                                    → `<img>` with `src` carried
 *     through verbatim and `object-cover` as a sensible default.
 *
 * Components (RefNodes pointing at a reusable FrameNode declared earlier in
 * the tree) are resolved by looking up the referenced node and rendering it
 * in-place. `descendants` overrides are applied during emission so the
 * generated HTML reflects the per-instance text / fill swaps.
 *
 * This is a wireframe-grade renderer, not a pixel-perfect Skia equivalent —
 * its job is to give Rails / the iframe view a quick HTML preview of what
 * the canvas will show, NOT to match exact CanvasKit metrics.
 */

export interface HtmlGenOptions {
  /** Document title used in the wrapping <html>/<title>. Defaults to "Wireframe". */
  title?: string;
  /**
   * When true, wraps the generated body in a full `<!doctype html>` shell
   * with the Tailwind CDN loaded. When false, returns just the body markup
   * (useful when the caller wants to embed inside its own document).
   * Defaults to true.
   */
  document?: boolean;
}

interface ComponentRegistry {
  byId: Map<string, FrameNode>;
}

/** Render a PenNode tree to HTML. */
export function generateHtml(nodes: PenNode[], options: HtmlGenOptions = {}): string {
  const registry: ComponentRegistry = { byId: new Map() };
  collectComponents(nodes, registry);

  const body = nodes
    .map((node) => renderNode(node, registry, /* isInsideRef */ false))
    .filter((html) => html.length > 0)
    .join('\n');

  if (options.document === false) return body;

  const title = escapeHtml(options.title ?? 'Wireframe');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-gray-900">
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Component discovery
// ---------------------------------------------------------------------------

function collectComponents(nodes: PenNode[] | undefined, registry: ComponentRegistry): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type === 'frame' && (node as FrameNode).reusable) {
      registry.byId.set(node.id, node as FrameNode);
    }
    if ('children' in node && node.children) {
      collectComponents(node.children as PenNode[], registry);
    }
  }
}

// ---------------------------------------------------------------------------
// Node dispatch
// ---------------------------------------------------------------------------

function renderNode(node: PenNode, registry: ComponentRegistry, isInsideRef: boolean): string {
  // Reusable component definitions are emitted only when referenced via a
  // RefNode — skip them at the top level so the wireframe renders the
  // instances rather than the templates.
  if (node.type === 'frame' && (node as FrameNode).reusable && !isInsideRef) {
    return '';
  }

  switch (node.type) {
    case 'frame':
      return renderFrame(node as FrameNode, registry);
    case 'rectangle':
      return renderRectangle(node as RectangleNode, registry);
    case 'ellipse':
      return renderEllipse(node as EllipseNode);
    case 'text':
      return renderText(node as TextNode);
    case 'image':
      return renderImage(node as ImageNode);
    case 'ref':
      return renderRef(node as RefNode, registry);
    default:
      // Group / line / polygon / path / icon_font aren't emitted by the
      // import mapper today — skip them silently so a future expansion of
      // the contract doesn't crash the renderer.
      return '';
  }
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

function renderFrame(node: FrameNode, registry: ComponentRegistry): string {
  return renderContainer(node, registry);
}

function renderRectangle(node: RectangleNode, registry: ComponentRegistry): string {
  return renderContainer(node, registry);
}

function renderContainer(
  node: FrameNode | RectangleNode,
  registry: ComponentRegistry,
  overrideChildren?: PenNode[],
  overrideName?: string,
): string {
  const classes = containerClasses(node);
  const style = containerStyle(node);
  const name = overrideName ?? node.name ?? '';
  const dataAttr = name ? ` data-name="${escapeHtml(name)}"` : '';
  const styleAttr = style ? ` style="${style}"` : '';
  const children = overrideChildren ?? (node.children as PenNode[] | undefined) ?? [];

  const inner = children
    .map((c) => renderNode(c, registry, false))
    .filter((s) => s.length > 0)
    .join('\n');

  return `<div class="${classes}"${styleAttr}${dataAttr}>${inner ? `\n${inner}\n` : ''}</div>`;
}

function renderEllipse(node: EllipseNode): string {
  const classes = ['rounded-full', ...sizeClasses(node), ...fillClasses(node.fill)]
    .filter(Boolean)
    .join(' ');
  const style = ellipseStyle(node);
  const name = node.name ?? '';
  const dataAttr = name ? ` data-name="${escapeHtml(name)}"` : '';
  const styleAttr = style ? ` style="${style}"` : '';
  return `<div class="${classes}"${styleAttr}${dataAttr}></div>`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function renderText(node: TextNode): string {
  const content = typeof node.content === 'string' ? node.content : segmentsToString(node.content);
  const classes = textClasses(node).join(' ');
  const style = textStyle(node);
  const styleAttr = style ? ` style="${style}"` : '';
  const dataAttr = node.name ? ` data-name="${escapeHtml(node.name)}"` : '';
  // Wrap multi-line text content with <br /> so newlines survive HTML.
  const html = escapeHtml(content).replace(/\n/g, '<br />');
  return `<span class="${classes}"${styleAttr}${dataAttr}>${html}</span>`;
}

function segmentsToString(segments: unknown): string {
  if (!Array.isArray(segments)) return '';
  return segments
    .map((seg) =>
      seg && typeof seg === 'object' && 'text' in seg ? String((seg as { text: unknown }).text) : '',
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function renderImage(node: ImageNode): string {
  const classes = ['object-cover', ...sizeClasses(node), ...radiusClasses(node.cornerRadius)]
    .filter(Boolean)
    .join(' ');
  const dataAttr = node.name ? ` data-name="${escapeHtml(node.name)}"` : '';
  const alt = escapeHtml(node.name ?? '');
  const src = escapeAttr(node.src);
  return `<img src="${src}" alt="${alt}" class="${classes}"${dataAttr} />`;
}

// ---------------------------------------------------------------------------
// Component instance (RefNode)
// ---------------------------------------------------------------------------

function renderRef(node: RefNode, registry: ComponentRegistry): string {
  const target = registry.byId.get(node.ref);
  if (!target) {
    // Unknown reference — surface a comment but don't break the document.
    return `<!-- missing component ref ${escapeHtml(node.ref)} -->`;
  }

  // Apply descendants overrides to a structural clone of the target tree so
  // each instance can carry its own text / fills without mutating the
  // template definition (subsequent instances would otherwise inherit
  // earlier overrides).
  const cloned = cloneWithOverrides(target, node.descendants ?? {}) as FrameNode;
  const overrideName = node.name ?? target.name ?? '';
  return renderContainer(cloned, registry, cloned.children, overrideName);
}

function cloneWithOverrides(
  node: PenNode,
  overrides: Record<string, Partial<PenNode>>,
): PenNode & { children?: PenNode[] } {
  const patch = overrides[node.id];
  const merged = patch ? ({ ...node, ...patch } as PenNode) : ({ ...node } as PenNode);
  if ('children' in merged && Array.isArray((merged as FrameNode).children)) {
    (merged as FrameNode).children = (merged as FrameNode).children!.map((c) =>
      cloneWithOverrides(c, overrides),
    );
  }
  return merged as PenNode & { children?: PenNode[] };
}

// ---------------------------------------------------------------------------
// Class / style helpers
// ---------------------------------------------------------------------------

function containerClasses(node: FrameNode | RectangleNode): string {
  const parts: string[] = ['relative'];
  parts.push(...sizeClasses(node));
  parts.push(...fillClasses(node.fill));
  parts.push(...radiusClasses(node.cornerRadius));
  parts.push(...layoutClasses(node));
  parts.push(...paddingClasses(node.padding));
  parts.push(...gapClasses(node.gap));
  return parts.filter((s) => s.length > 0).join(' ');
}

function containerStyle(node: FrameNode | RectangleNode): string {
  const styles: string[] = [];
  styles.push(...sizeStyle(node));
  styles.push(...fillStyle(node.fill));
  styles.push(...radiusStyle(node.cornerRadius));
  return styles.join('; ');
}

function ellipseStyle(node: EllipseNode): string {
  const styles: string[] = [];
  styles.push(...sizeStyle(node));
  styles.push(...fillStyle(node.fill));
  return styles.join('; ');
}

function sizeClasses(node: { width?: unknown; height?: unknown }): string[] {
  const out: string[] = [];
  if (typeof node.width === 'number') out.push(`w-[${node.width}px]`);
  if (typeof node.height === 'number') out.push(`h-[${node.height}px]`);
  return out;
}

function sizeStyle(_node: { width?: unknown; height?: unknown }): string[] {
  // Tailwind arbitrary-value classes already cover numeric widths/heights;
  // keep this helper around so symbolic sizings (fit_content etc.) can be
  // added without a wider refactor.
  return [];
}

function fillClasses(fill?: PenFill[]): string[] {
  // Tailwind's CDN doesn't ship hex utilities for arbitrary colors — we
  // emit them as inline style instead. Returning a placeholder marker
  // keeps the class list balanced but currently no class is required.
  return Array.isArray(fill) && fill.length > 0 ? [] : [];
}

function fillStyle(fill?: PenFill[]): string[] {
  if (!Array.isArray(fill) || fill.length === 0) return [];
  const solid = fill.find((f): f is SolidFill => f.type === 'solid');
  if (!solid?.color) return [];
  return [`background-color: ${escapeAttr(solid.color)}`];
}

function radiusClasses(radius?: unknown): string[] {
  if (typeof radius !== 'number' || radius <= 0) return [];
  return [`rounded-[${radius}px]`];
}

function radiusStyle(_radius?: unknown): string[] {
  return [];
}

function layoutClasses(node: FrameNode | RectangleNode): string[] {
  if (node.layout === 'horizontal') return ['flex', 'flex-row'];
  if (node.layout === 'vertical') return ['flex', 'flex-col'];
  return [];
}

function paddingClasses(padding?: unknown): string[] {
  if (padding == null) return [];
  if (typeof padding === 'number') return [`p-[${padding}px]`];
  if (Array.isArray(padding)) {
    // [v, h] | [t, r, b, l]
    if (padding.length === 2) {
      const [v, h] = padding as [number, number];
      const out: string[] = [];
      if (typeof v === 'number') out.push(`py-[${v}px]`);
      if (typeof h === 'number') out.push(`px-[${h}px]`);
      return out;
    }
    if (padding.length === 4) {
      const [t, r, b, l] = padding as [number, number, number, number];
      return [`pt-[${t}px]`, `pr-[${r}px]`, `pb-[${b}px]`, `pl-[${l}px]`];
    }
  }
  return [];
}

function gapClasses(gap?: unknown): string[] {
  if (typeof gap !== 'number') return [];
  return [`gap-[${gap}px]`];
}

function textClasses(node: TextNode): string[] {
  const parts: string[] = ['inline-block'];
  if (typeof node.fontSize === 'number') parts.push(`text-[${node.fontSize}px]`);
  if (node.fontWeight !== undefined) {
    const weight = typeof node.fontWeight === 'number' ? node.fontWeight : null;
    if (weight !== null) parts.push(`font-[${weight}]`);
  }
  parts.push(...sizeClasses(node));
  if (node.textAlign === 'center') parts.push('text-center');
  if (node.textAlign === 'right') parts.push('text-right');
  return parts;
}

function textStyle(node: TextNode): string {
  const styles: string[] = [];
  if (Array.isArray(node.fill) && node.fill.length > 0) {
    const solid = node.fill.find((f): f is SolidFill => f.type === 'solid');
    if (solid?.color) styles.push(`color: ${escapeAttr(solid.color)}`);
  }
  return styles.join('; ');
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
