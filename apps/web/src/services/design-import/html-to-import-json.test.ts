import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { htmlToImportJson } from './html-to-import-json';
import type { DesignImportNode } from './design-import-types';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function findFirst(
  node: DesignImportNode,
  predicate: (n: DesignImportNode) => boolean,
): DesignImportNode | null {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

function findAll(
  node: DesignImportNode,
  predicate: (n: DesignImportNode) => boolean,
): DesignImportNode[] {
  const out: DesignImportNode[] = [];
  const visit = (n: DesignImportNode) => {
    if (predicate(n)) out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(node);
  return out;
}

describe('htmlToImportJson — minimal cases', () => {
  it('maps a single div with bg + padding into a frame', () => {
    const { document, warnings } = htmlToImportJson(
      '<div class="bg-gray-100 p-4"></div>',
    );
    expect(warnings).toEqual([]);
    expect(document.nodes).toHaveLength(1);
    const frame = document.nodes[0];
    expect(frame.type).toBe('frame');
    expect(frame.bg).toBe('#f3f4f6');
    expect(frame.padX).toBe(16);
    expect(frame.padY).toBe(16);
  });

  it('preserves nested frame hierarchy', () => {
    const { document } = htmlToImportJson(
      '<div class="bg-white p-2"><div class="bg-gray-200 p-4"></div></div>',
    );
    const root = document.nodes[0];
    expect(root.type).toBe('frame');
    expect(root.bg).toBe('#ffffff');
    expect(root.children).toHaveLength(1);
    expect(root.children![0].bg).toBe('#e5e7eb');
    expect(root.children![0].padX).toBe(16);
  });

  it('maps <p> and <h1> to text nodes with correct default sizes', () => {
    const { document } = htmlToImportJson(
      '<div><h1>Title</h1><p>Some body copy</p></div>',
    );
    const root = document.nodes[0];
    const h1 = root.children!.find((c) => c.text === 'Title');
    const p = root.children!.find((c) => c.text === 'Some body copy');
    expect(h1?.type).toBe('text');
    expect(h1?.fontSize).toBe(30);
    expect(h1?.fontWeight).toBe(600);
    expect(p?.type).toBe('text');
    expect(p?.fontSize).toBeUndefined(); // <p> has no default size
  });

  it('maps text-sm and font-semibold class on a text node', () => {
    const { document } = htmlToImportJson(
      '<div><span class="text-sm font-semibold text-gray-900">Hi</span></div>',
    );
    const span = findFirst(document.nodes[0], (n) => n.text === 'Hi');
    expect(span?.fontSize).toBe(14);
    expect(span?.fontWeight).toBe(600);
    expect(span?.color).toBe('#111827');
  });

  it('maps flex flex-col gap-4 to flex:"col", gap:16', () => {
    const { document } = htmlToImportJson(
      '<div class="flex flex-col gap-4"><span>a</span><span>b</span></div>',
    );
    const root = document.nodes[0];
    expect(root.flex).toBe('col');
    expect(root.gap).toBe(16);
    expect(root.children).toHaveLength(2);
  });

  it('maps decimal gap (gap-1.5) to 6 px', () => {
    const { document } = htmlToImportJson('<div class="flex gap-1.5"></div>');
    expect(document.nodes[0].gap).toBe(6);
  });

  it('maps rounded-2xl to radius 16', () => {
    const { document } = htmlToImportJson('<div class="rounded-2xl"></div>');
    expect(document.nodes[0].radius).toBe(16);
  });

  it('maps rounded-full to 9999', () => {
    const { document } = htmlToImportJson('<div class="rounded-full"></div>');
    expect(document.nodes[0].radius).toBe(9999);
  });

  it('treats <img> as a 20x20 grey rectangle placeholder', () => {
    const { document } = htmlToImportJson(
      '<div><img src="x.png" alt="x"/></div>',
    );
    const img = document.nodes[0].children![0];
    expect(img.type).toBe('rectangle');
    expect(img.w).toBe(20);
    expect(img.h).toBe(20);
    expect(img.bg).toBe('#d1d5db');
  });

  it('treats <svg> as a 20x20 placeholder', () => {
    const { document } = htmlToImportJson(
      '<div><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></div>',
    );
    const svg = document.nodes[0].children![0];
    expect(svg.type).toBe('rectangle');
    expect(svg.bg).toBe('#d1d5db');
  });

  it('maps <input placeholder=...> to frame + text child', () => {
    const { document } = htmlToImportJson(
      '<div><input type="text" placeholder="Search…"/></div>',
    );
    const wrap = document.nodes[0].children![0];
    expect(wrap.type).toBe('frame');
    expect(wrap.children?.[0].text).toBe('Search…');
    expect(wrap.children?.[0].type).toBe('text');
  });

  it('uses arbitrary text size [11px] -> 11', () => {
    const { document } = htmlToImportJson(
      '<div><span class="text-[11px]">x</span></div>',
    );
    const span = findFirst(document.nodes[0], (n) => n.text === 'x');
    expect(span?.fontSize).toBe(11);
  });
});

describe('htmlToImportJson — chrome / filter behaviour', () => {
  it('skips sticky top bars + annotation cards, keeps only the app mock', () => {
    const html = `
      <body>
        <div class="bg-gray-800 sticky top-0">
          <span>Wireframe bar</span>
        </div>
        <div class="bg-gray-50 sticky top-[44px]">
          <span>Annotations legend</span>
        </div>
        <div class="bg-gray-100 p-4">
          <main class="bg-white">
            <h1>App mock</h1>
          </main>
        </div>
        <div>
          <h2>UX Annotations</h2>
          <p>Should not appear</p>
        </div>
      </body>`;

    const { document } = htmlToImportJson(html);
    expect(document.nodes).toHaveLength(1);
    // First (only) root should contain the "App mock" title.
    const found = findFirst(document.nodes[0], (n) => n.text === 'App mock');
    expect(found).not.toBeNull();
    // The wireframe bar text must NOT be in the tree.
    const wf = findFirst(document.nodes[0], (n) => n.text === 'Wireframe bar');
    expect(wf).toBeNull();
    const ux = findFirst(document.nodes[0], (n) => n.text === 'Should not appear');
    expect(ux).toBeNull();
  });

  it('drops elements with the hidden class', () => {
    const { document } = htmlToImportJson(
      '<div><span>visible</span><span class="hidden">invisible</span></div>',
    );
    const root = document.nodes[0];
    expect(root.children).toHaveLength(1);
    expect(root.children![0].text).toBe('visible');
  });

  it('drops elements with the sr-only class', () => {
    const { document, skipped } = htmlToImportJson(
      '<div><span class="sr-only">screen reader</span><span>seen</span></div>',
    );
    expect(document.nodes[0].children).toHaveLength(1);
    expect(skipped.some((s) => /sr-only/.test(s))).toBe(true);
  });

  it('surfaces unknown classes in warnings but still emits the node', () => {
    const { document, warnings } = htmlToImportJson(
      '<div class="bg-white totally-bogus-class"></div>',
    );
    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0].bg).toBe('#ffffff');
    expect(warnings.some((w) => /totally-bogus-class/.test(w))).toBe(true);
  });

  it('does not warn for silently-skipped utilities (shadow, transition, hover:*, sm:*)', () => {
    const { warnings } = htmlToImportJson(
      '<div class="shadow-sm transition-colors hover:bg-gray-100 sm:px-4 dark:bg-black"></div>',
    );
    expect(warnings).toEqual([]);
  });

  it('falls back to empty doc when no body content', () => {
    const { document, warnings } = htmlToImportJson('<html></html>');
    expect(document.nodes).toEqual([]);
    expect(warnings).toContain('no app-mock subtree found — output is empty');
  });
});

describe('htmlToImportJson — fixture integration', () => {
  const html = readFileSync(join(FIXTURE_DIR, 'tasks-index-sample.html'), 'utf-8');
  const result = htmlToImportJson(html);

  it('parses without crashing and emits one top-level root', () => {
    expect(result.document.nodes.length).toBeGreaterThan(0);
  });

  it('picks up the document title', () => {
    expect(result.document.name).toBe('Tasks Index — Sample');
  });

  it('keeps the app mock and drops the chrome bars', () => {
    // "MicroProject — Wireframes" (wireframe bar) must be absent.
    const chrome = findFirst(result.document.nodes[0], (n) =>
      typeof n.text === 'string' && n.text.includes('Wireframes'),
    );
    expect(chrome).toBeNull();

    // "Tasks" h1 header from the app shell must be present.
    const header = findFirst(
      result.document.nodes[0],
      (n) => n.text === 'Tasks' && n.fontSize === 20,
    );
    expect(header).not.toBeNull();
  });

  it('drops the UX Annotations panel entirely', () => {
    const annotation = findFirst(result.document.nodes[0], (n) =>
      typeof n.text === 'string' && n.text.includes('Time-grouped task list'),
    );
    expect(annotation).toBeNull();
  });

  it('finds the sidebar + main split (at least two large frames)', () => {
    const frames = findAll(result.document.nodes[0], (n) => n.type === 'frame');
    expect(frames.length).toBeGreaterThan(15);

    // The sidebar <aside> should be a frame somewhere.
    const sidebar = findFirst(result.document.nodes[0], (n) =>
      typeof n.name === 'string' && n.name.toLowerCase().includes('aside'),
    );
    expect(sidebar).not.toBeNull();

    // The <main> should be a frame.
    const main = findFirst(result.document.nodes[0], (n) =>
      typeof n.name === 'string' && n.name.toLowerCase() === 'main',
    );
    expect(main).not.toBeNull();
  });

  it('preserves task titles as text nodes', () => {
    const finalize = findFirst(result.document.nodes[0], (n) =>
      typeof n.text === 'string' && n.text.includes('Finalize Q4 budget report'),
    );
    expect(finalize?.type).toBe('text');
    expect(finalize?.fontSize).toBe(14);
  });
});
