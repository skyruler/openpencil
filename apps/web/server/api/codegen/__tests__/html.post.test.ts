import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import handler from '../html.post';
import type { DesignImportDocument } from '../../../../src/services/design-import/design-import-types';

const SECRET_ENV = 'OPENPENCIL_CODEGEN_SECRET';

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new Request('http://localhost/api/codegen/html', init);
}

async function callHandler(req: Request): Promise<Response> {
  // `defineEventHandler` returns an EventHandlerWithFetch whose `.fetch`
  // method runs the handler against a standard Web Request and returns a
  // standard Web Response — ideal for testing without booting Nitro.
  // h3 types `.fetch` as `TypedResponse` which is structurally compatible
  // with the global `Response` but not assignable; cast to keep test code
  // simple.
  return (await handler.fetch(req)) as unknown as Response;
}

const SAMPLE_DOC: DesignImportDocument = {
  name: 'Sample',
  nodes: [
    {
      type: 'frame',
      name: 'Screen',
      x: 0,
      y: 0,
      w: 1280,
      h: 820,
      bg: '#fafafa',
      padX: 16,
      padY: 24,
      flex: 'col',
      gap: 12,
      children: [
        {
          type: 'text',
          name: 'Heading',
          text: 'Tasks',
          fontSize: 24,
          fontWeight: 600,
          color: '#111827',
        },
        {
          type: 'rectangle',
          name: 'Card',
          w: 240,
          h: 80,
          bg: '#ffffff',
          radius: 8,
        },
      ],
    },
  ],
};

describe('POST /api/codegen/html', () => {
  beforeEach(() => {
    delete process.env[SECRET_ENV];
  });

  afterEach(() => {
    delete process.env[SECRET_ENV];
  });

  it('returns HTML body with screen content + Tailwind utility fragments for a valid document', async () => {
    const res = await callHandler(buildRequest(SAMPLE_DOC));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-type')).toMatch(/charset=utf-8/i);

    const html = await res.text();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('Tasks');
    expect(html).toMatch(/py-\[24px\]/);
    expect(html).toMatch(/px-\[16px\]/);
    expect(html).toMatch(/gap-\[12px\]/);
    expect(html).toMatch(/color:\s*#111827/i);
    expect(html).toMatch(/rounded-\[8px\]/);
    expect(html).toMatch(/background-color:\s*#ffffff/i);
  });

  it('returns 400 when the body is missing the nodes array', async () => {
    const res = await callHandler(buildRequest({ name: 'No nodes' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body is malformed JSON', async () => {
    const res = await callHandler(buildRequest('{ not valid json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body is not an object (e.g. a JSON array)', async () => {
    const res = await callHandler(buildRequest([1, 2, 3]));
    expect(res.status).toBe(400);
  });

  it('returns 401 when OPENPENCIL_CODEGEN_SECRET is set and the header is missing', async () => {
    process.env[SECRET_ENV] = 'sekret';
    const res = await callHandler(buildRequest(SAMPLE_DOC));
    expect(res.status).toBe(401);
  });

  it('returns 401 when OPENPENCIL_CODEGEN_SECRET is set and the header value is wrong', async () => {
    process.env[SECRET_ENV] = 'sekret';
    const res = await callHandler(buildRequest(SAMPLE_DOC, { 'x-codegen-secret': 'nope' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 when OPENPENCIL_CODEGEN_SECRET matches the supplied header', async () => {
    process.env[SECRET_ENV] = 'sekret';
    const res = await callHandler(buildRequest(SAMPLE_DOC, { 'x-codegen-secret': 'sekret' }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Tasks');
  });

  it('renders component instances by substituting their slot overrides', async () => {
    const doc: DesignImportDocument = {
      name: 'Components',
      nodes: [
        {
          type: 'component',
          name: 'TaskRow',
          slot: ['title'],
          w: 600,
          h: 40,
          bg: '#ffffff',
          flex: 'row',
          padX: 12,
          padY: 8,
          gap: 12,
          children: [
            {
              type: 'text',
              name: 'title',
              text: '—',
              fontSize: 14,
              color: '#111827',
            },
          ],
        },
        {
          type: 'instance',
          componentName: 'TaskRow',
          overrides: { title: { text: 'Launch post' } },
        },
        {
          type: 'instance',
          componentName: 'TaskRow',
          overrides: { title: { text: 'Design review' } },
        },
      ],
    };
    const res = await callHandler(buildRequest(doc));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Launch post');
    expect(html).toContain('Design review');
  });

  it('escapes HTML special characters in text content', async () => {
    const doc: DesignImportDocument = {
      nodes: [
        {
          type: 'text',
          name: 'Heading',
          text: '<script>alert(1)</script>',
          fontSize: 14,
          color: '#111827',
        },
      ],
    };
    const res = await callHandler(buildRequest(doc));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
