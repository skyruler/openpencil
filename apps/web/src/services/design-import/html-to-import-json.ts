/**
 * Deterministic HTML + Tailwind -> DesignImportDocument converter. Walks a
 * Mira-style wireframe (sticky chrome -> app shell -> UX annotation cards) and
 * emits only the app-mock subtree. Unknown classes surface as `warnings`.
 */
import { parse, type HTMLElement, type Node as HTMLNode } from 'node-html-parser';

import type { DesignImportDocument, DesignImportNode } from './design-import-types';

export interface HtmlToImportResult {
  document: DesignImportDocument;
  warnings: string[];
  skipped: string[];
}

export function htmlToImportJson(html: string): HtmlToImportResult {
  const warnings: string[] = [];
  const skipped: string[] = [];
  const root = parse(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { tags: ['img', 'br', 'hr', 'input', 'meta', 'link'], closingSlash: true },
  });

  const docName = extractDocumentName(root);
  // Prefer <body>; fall back to <html>'s element children; finally the root.
  const body =
    root.querySelector('body') ?? root.querySelector('html') ?? root;

  // Walk top-level children and pick the first non-chrome subtree. Anything
  // after the first <h2> (the "UX Annotations" panel) is dropped. Skip <head>
  // explicitly when we're descending into <html>.
  const candidates = filterAppMockRoots(
    elementChildren(body).filter((el) => {
      const t = el.tagName?.toLowerCase();
      return t !== 'head' && t !== 'script' && t !== 'style' && t !== 'meta' && t !== 'title';
    }),
  );

  const nodes: DesignImportNode[] = [];
  for (const el of candidates) {
    const converted = convertElement(el, warnings, skipped);
    if (converted) nodes.push(converted);
  }

  if (nodes.length === 0) {
    warnings.push('no app-mock subtree found — output is empty');
  }

  return {
    document: { name: docName, nodes },
    warnings,
    skipped,
  };
}

function extractDocumentName(root: HTMLElement): string | undefined {
  const title = root.querySelector('title');
  if (title && title.text.trim()) return title.text.trim();
  const h1 = root.querySelector('h1');
  if (h1 && h1.text.trim()) return h1.text.trim();
  return undefined;
}

function filterAppMockRoots(children: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of children) {
    if (el.tagName?.toLowerCase() === 'h2') break;
    // Drop a top-level subtree that itself contains an <h2> heading — that's
    // the "UX Annotations" panel that always sits below the app mock.
    if (el.querySelector('h2')) break;
    const classes = classList(el);
    if (classes.some((c) => c === 'sticky' || c.startsWith('sticky:'))) continue;
    if (classes.includes('hidden') || classes.includes('sr-only')) continue;
    out.push(el);
  }
  return out;
}

const FRAME_TAGS = new Set([
  'div',
  'section',
  'header',
  'nav',
  'aside',
  'main',
  'article',
  'form',
  'footer',
  'ul',
  'ol',
  'li',
  'button',
  'fieldset',
]);

const TEXT_TAGS = new Set(['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a']);
const PLACEHOLDER_TAGS = new Set(['img', 'svg', 'picture', 'video']);
const INPUT_TAGS = new Set(['input', 'textarea', 'select']);

const HEADING_DEFAULT_SIZE: Record<string, number> = {
  h1: 30,
  h2: 24,
  h3: 20,
  h4: 18,
  h5: 16,
  h6: 14,
};

function convertElement(
  el: HTMLElement,
  warnings: string[],
  skipped: string[],
): DesignImportNode | null {
  const tag = el.tagName?.toLowerCase();
  if (!tag) return null;

  const classes = classList(el);
  if (classes.includes('hidden') || classes.includes('sr-only')) {
    skipped.push(`<${tag}> skipped (hidden/sr-only)`);
    return null;
  }

  // Placeholder for images / svg icons.
  if (PLACEHOLDER_TAGS.has(tag)) {
    const node: DesignImportNode = {
      type: 'rectangle',
      name: tag === 'img' ? 'Image' : 'Icon',
      w: 20,
      h: 20,
      bg: '#d1d5db',
      radius: 4,
    };
    applyTailwindToNode(node, classes, warnings, tag);
    return node;
  }

  // Inputs become a labelled frame.
  if (INPUT_TAGS.has(tag)) {
    const placeholder = el.getAttribute('placeholder') ?? el.getAttribute('value') ?? '';
    const frame: DesignImportNode = {
      type: 'frame',
      name: `Input · ${tag}`,
      bg: '#ffffff',
      radius: 6,
      padX: 12,
      padY: 8,
      children: [],
    };
    applyTailwindToNode(frame, classes, warnings, tag);
    if (placeholder) {
      frame.children!.push({
        type: 'text',
        name: 'Placeholder',
        text: placeholder,
        fontSize: 14,
        color: '#9ca3af',
      });
    }
    return frame;
  }

  // Text-leaning tags. If the element has no element children, emit a text
  // node. If it has element children, treat it as a frame so the layout
  // survives.
  const elementChildEls = elementChildren(el);
  const directText = directTextContent(el);

  if (TEXT_TAGS.has(tag)) {
    if (elementChildEls.length === 0) {
      const trimmed = directText.trim();
      if (!trimmed) return null;
      const node: DesignImportNode = {
        type: 'text',
        name: capitalize(tag),
        text: trimmed,
      };
      const defaultSize = HEADING_DEFAULT_SIZE[tag];
      if (defaultSize !== undefined) {
        node.fontSize = defaultSize;
        if (tag === 'h1' || tag === 'h2' || tag === 'h3') node.fontWeight = 600;
      }
      applyTailwindToTextNode(node, classes, warnings, tag);
      return node;
    }
    // Fallthrough to frame-with-mixed-content handling below.
  }

  if (FRAME_TAGS.has(tag) || TEXT_TAGS.has(tag)) {
    // A leaf-ish container that only holds direct text (`<div>label</div>`,
    // `<button>Save</button>`) → emit a text node so font utilities on the
    // parent (`text-sm font-semibold text-gray-900`) survive.
    const trimmedDirect = directText.trim();
    if (trimmedDirect && elementChildEls.length === 0) {
      const textNode: DesignImportNode = {
        type: 'text',
        name: friendlyName(el, tag),
        text: trimmedDirect,
      };
      const defaultSize = HEADING_DEFAULT_SIZE[tag];
      if (defaultSize !== undefined) {
        textNode.fontSize = defaultSize;
        if (tag === 'h1' || tag === 'h2' || tag === 'h3') textNode.fontWeight = 600;
      }
      applyTailwindToTextNode(textNode, classes, warnings, tag);
      return textNode;
    }

    const node: DesignImportNode = {
      type: 'frame',
      name: friendlyName(el, tag),
      children: [],
    };
    applyTailwindToNode(node, classes, warnings, tag);

    // Mixed content (text + element siblings) → emit text as a child.
    if (trimmedDirect) {
      node.children!.push({
        type: 'text',
        name: 'Text',
        text: trimmedDirect,
      });
    }

    for (const child of elementChildEls) {
      const converted = convertElement(child, warnings, skipped);
      if (converted) node.children!.push(converted);
    }

    if (!node.children || node.children.length === 0) delete node.children;
    return node;
  }

  // Unknown tag — try as frame container; record once.
  skipped.push(`<${tag}> unhandled tag — treated as frame`);
  const node: DesignImportNode = {
    type: 'frame',
    name: tag,
    children: [],
  };
  applyTailwindToNode(node, classes, warnings, tag);
  for (const child of elementChildEls) {
    const converted = convertElement(child, warnings, skipped);
    if (converted) node.children!.push(converted);
  }
  if (!node.children || node.children.length === 0) delete node.children;
  return node;
}

/** Classes we ignore silently — no warning, no effect. */
const SILENT_PREFIXES = (
  'hover: focus: active: disabled: group- peer- dark: sm: md: lg: xl: 2xl: ' +
  'aria- data- shadow transition duration- ease- animate- line-clamp- truncate ' +
  'min-w- min-h- max-w- max-h- overflow- whitespace- leading- tracking- ' +
  'cursor- select- pointer- opacity- z- order- flex-1 flex-shrink flex-grow ' +
  'shrink- grow- self- place- fixed absolute relative static sticky inset- ' +
  'top- right- bottom- left- ml- mr- mt- mb- mx- my- m- space- divide- ' +
  'col-span row-span col-start row-start col-end row-end grid-cols grid-rows ' +
  'grid-flow antialiased subpixel- underline uppercase lowercase capitalize ' +
  'normal-case italic not-italic no-underline list- appearance- outline- ' +
  'ring- fill- stroke- aspect- object- backdrop- blur- filter isolate isolation-'
).split(' ');

const SILENT_EXACT = new Set(
  (
    'inline block inline-block inline-flex grid inline-grid contents flow-root ' +
    'flex-wrap flex-nowrap flex-wrap-reverse flex-row-reverse flex-col-reverse ' +
    'items-start items-end items-center items-baseline items-stretch ' +
    'justify-start justify-end justify-center justify-between justify-around justify-evenly ' +
    'content-start content-end content-center font-sans font-serif font-mono ' +
    'text-left text-center text-right text-justify pointer-events-none pointer-events-auto group peer'
  ).split(' '),
);

function isSilent(klass: string): boolean {
  if (SILENT_EXACT.has(klass)) return true;
  for (const prefix of SILENT_PREFIXES) {
    if (klass.startsWith(prefix)) return true;
  }
  return false;
}

function applyTailwindToNode(
  node: DesignImportNode,
  classes: string[],
  warnings: string[],
  tag: string,
): void {
  for (const klass of classes) {
    if (!klass || isSilent(klass)) continue;
    if (applyOneClass(node, klass)) continue;
    // text-* on a frame is fine — it cascades to text descendants in real CSS.
    // We can't model inheritance, so silently swallow rather than warn.
    if (applyTextClass({ type: 'text' } as DesignImportNode, klass)) continue;
    warnings.push(`<${tag}> unknown class "${klass}"`);
  }
}

function applyTailwindToTextNode(
  node: DesignImportNode,
  classes: string[],
  warnings: string[],
  tag: string,
): void {
  for (const klass of classes) {
    if (!klass || isSilent(klass)) continue;
    if (applyTextClass(node, klass)) continue;
    // Allow non-text classes (bg-*, p-*) but they're meaningless on a text
    // node — ignore silently to avoid noise.
    if (applyOneClass({ type: 'frame' } as DesignImportNode, klass)) continue;
    warnings.push(`<${tag}> unknown class "${klass}"`);
  }
}

/**
 * Mutates `node` based on a single class. Returns true if recognised, false if
 * unknown.
 */
function applyOneClass(node: DesignImportNode, klass: string): boolean {
  // Layout direction --------------------------------------------------------
  if (klass === 'flex') {
    if (!node.flex) node.flex = 'row';
    return true;
  }
  if (klass === 'flex-row') {
    node.flex = 'row';
    return true;
  }
  if (klass === 'flex-col') {
    node.flex = 'col';
    return true;
  }

  // Gap --------------------------------------------------------------------
  const gap = matchScale(klass, /^gap(?:-[xy])?-(.+)$/);
  if (gap !== null) {
    node.gap = gap;
    return true;
  }

  // Padding ----------------------------------------------------------------
  const pAll = matchScale(klass, /^p-(.+)$/);
  if (pAll !== null) {
    node.padX = pAll;
    node.padY = pAll;
    return true;
  }
  const px = matchScale(klass, /^px-(.+)$/);
  if (px !== null) {
    node.padX = px;
    return true;
  }
  const py = matchScale(klass, /^py-(.+)$/);
  if (py !== null) {
    node.padY = py;
    return true;
  }
  // pt/pr/pb/pl — fold into pad{X,Y}; we don't have per-side in import shape.
  const pt = matchScale(klass, /^pt-(.+)$/);
  if (pt !== null) {
    node.padY = Math.max(node.padY ?? 0, pt);
    return true;
  }
  const pb = matchScale(klass, /^pb-(.+)$/);
  if (pb !== null) {
    node.padY = Math.max(node.padY ?? 0, pb);
    return true;
  }
  const pl = matchScale(klass, /^pl-(.+)$/);
  if (pl !== null) {
    node.padX = Math.max(node.padX ?? 0, pl);
    return true;
  }
  const pr = matchScale(klass, /^pr-(.+)$/);
  if (pr !== null) {
    node.padX = Math.max(node.padX ?? 0, pr);
    return true;
  }

  // Width / height ---------------------------------------------------------
  if (
    klass === 'w-full' ||
    klass === 'h-full' ||
    klass === 'w-screen' ||
    klass === 'h-screen' ||
    klass === 'w-auto' ||
    klass === 'h-auto' ||
    klass === 'w-fit' ||
    klass === 'h-fit'
  ) {
    return true; // ignored — autolayout handles intrinsic sizing
  }
  if (/^w-\d+\/\d+$/.test(klass) || /^h-\d+\/\d+$/.test(klass)) return true;
  const w = matchSize(klass, /^w-(.+)$/);
  if (w !== null) {
    node.w = w;
    return true;
  }
  const h = matchSize(klass, /^h-(.+)$/);
  if (h !== null) {
    node.h = h;
    return true;
  }

  // Radius -----------------------------------------------------------------
  if (RADIUS_MAP[klass] !== undefined) {
    node.radius = RADIUS_MAP[klass];
    return true;
  }
  const arbRadius = klass.match(/^rounded(?:-[a-z]+)?-\[([^\]]+)\]$/);
  if (arbRadius) {
    const v = parsePxValue(arbRadius[1]);
    if (v !== null) {
      node.radius = v;
      return true;
    }
  }
  // rounded-t, rounded-l-md etc — accept silently (treat as full radius).
  if (/^rounded(-[trbl]|-[xy])?(-[a-z0-9]+)?$/.test(klass)) {
    // Already handled by RADIUS_MAP for the common variants. Otherwise ignore.
    return true;
  }

  // Background -------------------------------------------------------------
  const bg = matchColor(klass, /^bg-(.+)$/);
  if (bg) {
    node.bg = bg;
    return true;
  }

  // Border (treat directional same as full for prototype) ------------------
  if (
    klass === 'border' ||
    /^border-(t|r|b|l|x|y)$/.test(klass) ||
    /^border-\d+$/.test(klass) ||
    /^border-[trblxy]-\d+$/.test(klass)
  ) {
    // We don't have a `stroke` field in the import shape, but the mapper
    // synthesises a border from `bg` only when explicitly set. Borders are
    // visual hints; ignore silently to avoid noise — the spec says "emit full
    // stroke" but DesignImportNode has no stroke property today. Surface it
    // as a no-op rather than a warning.
    return true;
  }
  const borderColor = matchColor(klass, /^border-(.+)$/);
  if (borderColor) {
    return true; // colour parsed and ignored
  }

  return false;
}

function applyTextClass(node: DesignImportNode, klass: string): boolean {
  if (TEXT_SIZE_MAP[klass] !== undefined) {
    node.fontSize = TEXT_SIZE_MAP[klass];
    return true;
  }
  const arbSize = klass.match(/^text-\[([^\]]+)\]$/);
  if (arbSize) {
    const v = parsePxValue(arbSize[1]);
    if (v !== null) {
      node.fontSize = v;
      return true;
    }
  }
  if (FONT_WEIGHT_MAP[klass] !== undefined) {
    node.fontWeight = FONT_WEIGHT_MAP[klass];
    return true;
  }
  const color = matchColor(klass, /^text-(.+)$/);
  if (color) {
    node.color = color;
    return true;
  }
  return false;
}

const RADIUS_MAP: Record<string, number> = {
  'rounded-none': 0,
  'rounded-sm': 2,
  rounded: 4,
  'rounded-md': 6,
  'rounded-lg': 8,
  'rounded-xl': 12,
  'rounded-2xl': 16,
  'rounded-3xl': 24,
  'rounded-full': 9999,
};

const TEXT_SIZE_MAP: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
  'text-4xl': 36,
  'text-5xl': 48,
  'text-6xl': 60,
};

const FONT_WEIGHT_MAP: Record<string, number> = {
  'font-thin': 100,
  'font-extralight': 200,
  'font-light': 300,
  'font-normal': 400,
  'font-medium': 500,
  'font-semibold': 600,
  'font-bold': 700,
  'font-extrabold': 800,
  'font-black': 900,
};

/** Tailwind v3 default palette (50/100/.../900 + optional 950).
 *
 * Encoded as one CSV string per family to keep this file under the 700 line
 * cap. `buildPalette` expands them once at module load. Missing shades return
 * `null` from `matchColor`. */
const PALETTE_RAW: Record<string, string> = {
  slate:
    '50:#f8fafc,100:#f1f5f9,200:#e2e8f0,300:#cbd5e1,400:#94a3b8,500:#64748b,600:#475569,700:#334155,800:#1e293b,900:#0f172a,950:#020617',
  gray: '50:#f9fafb,100:#f3f4f6,200:#e5e7eb,300:#d1d5db,400:#9ca3af,500:#6b7280,600:#4b5563,700:#374151,800:#1f2937,900:#111827,950:#030712',
  zinc: '50:#fafafa,100:#f4f4f5,200:#e4e4e7,300:#d4d4d8,400:#a1a1aa,500:#71717a,600:#52525b,700:#3f3f46,800:#27272a,900:#18181b,950:#09090b',
  neutral:
    '50:#fafafa,100:#f5f5f5,200:#e5e5e5,300:#d4d4d4,400:#a3a3a3,500:#737373,600:#525252,700:#404040,800:#262626,900:#171717',
  stone:
    '50:#fafaf9,100:#f5f5f4,200:#e7e5e4,300:#d6d3d1,400:#a8a29e,500:#78716c,600:#57534e,700:#44403c,800:#292524,900:#1c1917',
  red: '50:#fef2f2,100:#fee2e2,200:#fecaca,300:#fca5a5,400:#f87171,500:#ef4444,600:#dc2626,700:#b91c1c,800:#991b1b,900:#7f1d1d',
  orange:
    '50:#fff7ed,100:#ffedd5,200:#fed7aa,300:#fdba74,400:#fb923c,500:#f97316,600:#ea580c,700:#c2410c,800:#9a3412,900:#7c2d12',
  amber:
    '50:#fffbeb,100:#fef3c7,200:#fde68a,300:#fcd34d,400:#fbbf24,500:#f59e0b,600:#d97706,700:#b45309,800:#92400e,900:#78350f',
  yellow:
    '50:#fefce8,100:#fef9c3,200:#fef08a,300:#fde047,400:#facc15,500:#eab308,600:#ca8a04,700:#a16207,800:#854d0e,900:#713f12',
  green:
    '50:#f0fdf4,100:#dcfce7,200:#bbf7d0,300:#86efac,400:#4ade80,500:#22c55e,600:#16a34a,700:#15803d,800:#166534,900:#14532d',
  emerald: '50:#ecfdf5,100:#d1fae5,500:#10b981,600:#059669,700:#047857',
  teal: '50:#f0fdfa,100:#ccfbf1,500:#14b8a6,600:#0d9488',
  cyan: '50:#ecfeff,100:#cffafe,500:#06b6d4,600:#0891b2',
  sky: '50:#f0f9ff,100:#e0f2fe,500:#0ea5e9,600:#0284c7',
  blue: '50:#eff6ff,100:#dbeafe,200:#bfdbfe,300:#93c5fd,400:#60a5fa,500:#3b82f6,600:#2563eb,700:#1d4ed8,800:#1e40af,900:#1e3a8a',
  indigo:
    '50:#eef2ff,100:#e0e7ff,200:#c7d2fe,300:#a5b4fc,400:#818cf8,500:#6366f1,600:#4f46e5,700:#4338ca,800:#3730a3,900:#312e81',
  violet: '50:#f5f3ff,100:#ede9fe,500:#8b5cf6,600:#7c3aed',
  purple:
    '50:#faf5ff,100:#f3e8ff,200:#e9d5ff,300:#d8b4fe,400:#c084fc,500:#a855f7,600:#9333ea,700:#7e22ce,800:#6b21a8,900:#581c87',
  fuchsia: '500:#d946ef,600:#c026d3',
  pink: '50:#fdf2f8,100:#fce7f3,200:#fbcfe8,300:#f9a8d4,400:#f472b6,500:#ec4899,600:#db2777',
  rose: '50:#fff1f2,100:#ffe4e6,500:#f43f5e,600:#e11d48',
};

function buildPalette(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {
    white: { DEFAULT: '#ffffff' },
    black: { DEFAULT: '#000000' },
    transparent: { DEFAULT: 'transparent' },
    current: { DEFAULT: 'currentColor' },
  };
  for (const [family, csv] of Object.entries(PALETTE_RAW)) {
    const shades: Record<string, string> = {};
    for (const pair of csv.split(',')) {
      const [shade, hex] = pair.split(':');
      shades[shade] = hex;
    }
    out[family] = shades;
  }
  return out;
}

const COLOR_PALETTE = buildPalette();

/** Tailwind spacing scale: gap-N / p-N / w-N / h-N -> px. */
function tailwindScale(raw: string): number | null {
  if (raw === 'px') return 1;
  if (raw === '0') return 0;
  if (raw === '0.5') return 2;
  if (raw === '1') return 4;
  if (raw === '1.5') return 6;
  if (raw === '2') return 8;
  if (raw === '2.5') return 10;
  if (raw === '3') return 12;
  if (raw === '3.5') return 14;
  // Integer N -> N * 4.
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (n >= 0 && n <= 200) return n * 4;
  }
  // Decimals .5 step.
  if (/^\d+\.5$/.test(raw)) {
    const n = Number.parseFloat(raw);
    return Math.round(n * 4);
  }
  return null;
}

function matchScale(klass: string, re: RegExp): number | null {
  const m = klass.match(re);
  if (!m) return null;
  const v = m[1];
  const arb = v.match(/^\[(.+)\]$/);
  if (arb) return parsePxValue(arb[1]);
  return tailwindScale(v);
}

function matchSize(klass: string, re: RegExp): number | null {
  return matchScale(klass, re);
}

function parsePxValue(raw: string): number | null {
  const t = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number.parseFloat(t);
  const px = t.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number.parseFloat(px[1]);
  const rem = t.match(/^(\d+(?:\.\d+)?)rem$/);
  if (rem) return Number.parseFloat(rem[1]) * 16;
  return null;
}

function matchColor(klass: string, re: RegExp): string | null {
  const m = klass.match(re);
  if (!m) return null;
  const tail = m[1];
  // Arbitrary value: bg-[#abc] / bg-[rgb(...)]
  const arb = tail.match(/^\[(.+)\]$/);
  if (arb) return arb[1];
  // family-shade or family alone (white/black/transparent).
  const parts = tail.split('-');
  if (parts.length === 1) {
    const fam = COLOR_PALETTE[parts[0]];
    if (fam?.DEFAULT) return fam.DEFAULT;
    return null;
  }
  const family = parts.slice(0, -1).join('-');
  const shade = parts[parts.length - 1];
  const palette = COLOR_PALETTE[family];
  if (palette && palette[shade]) return palette[shade];
  return null;
}

function classList(el: HTMLElement): string[] {
  const raw = el.getAttribute('class');
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean);
}

function elementChildren(el: HTMLElement | HTMLNode): HTMLElement[] {
  const children = (el as HTMLElement).childNodes ?? [];
  const out: HTMLElement[] = [];
  for (const c of children) {
    // node-html-parser: nodeType 1 = element, 3 = text, 8 = comment
    if ((c as HTMLElement).nodeType === 1) out.push(c as HTMLElement);
  }
  return out;
}

/** Concatenate only direct text-node children (skip element subtrees). */
function directTextContent(el: HTMLElement): string {
  let out = '';
  for (const c of el.childNodes ?? []) {
    if ((c as HTMLElement).nodeType === 3) out += (c as HTMLNode).rawText ?? '';
  }
  return out;
}

function friendlyName(el: HTMLElement, tag: string): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const role = el.getAttribute('role');
  if (role) return `${capitalize(tag)} · ${role}`;
  return capitalize(tag);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
