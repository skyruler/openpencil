import { defineEventHandler, readBody, createError, getRequestHeader, setResponseHeader } from 'h3';
import { mapImportToPenNodes } from '../../../src/services/design-import/design-import-mapper';
import { generateHtml } from '../../../src/services/codegen/html-generator';
import type { DesignImportDocument } from '../../../src/services/design-import/design-import-types';
import type { PenDocument, PenNode } from '@zseven-w/pen-types';

const SECRET_ENV = 'OPENPENCIL_CODEGEN_SECRET';
const SECRET_HEADER = 'x-codegen-secret';

/**
 * POST /api/codegen/html
 *
 * Stateless HTTP wrapper around the html-generator. Rails (the Comet
 * wireframes phase) POSTs either a native PenDocument (Mira's current
 * emitter) or a legacy DesignImportDocument (the simplified shape kept
 * for backwards-compat callers), and the endpoint returns the equivalent
 * Tailwind HTML. No persistence here.
 *
 * Body shape — either:
 *   - PenDocument: `{ version, name?, pages?: [{ children: [...] }], children?: [...] }`
 *     — handed straight to the html-generator; no mapping.
 *   - DesignImportDocument: `{ name?, nodes: [...] }` — run through
 *     `mapImportToPenNodes` first.
 *
 * Optional auth — when `OPENPENCIL_CODEGEN_SECRET` is set in the
 * environment, requests must carry a matching `x-codegen-secret` header.
 *
 * Responses:
 *   - 200 `text/html; charset=utf-8` — generated HTML body
 *   - 400 `{ error }` — body neither a PenDocument nor a DesignImportDocument
 *   - 401 `{ error }` — missing/wrong `x-codegen-secret` when env enforces
 *   - 500 `{ error }` — html-generator throws
 */
export default defineEventHandler(async (event) => {
  const expectedSecret = process.env[SECRET_ENV];
  if (expectedSecret) {
    const supplied = getRequestHeader(event, SECRET_HEADER);
    if (supplied !== expectedSecret) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or missing codegen secret' });
    }
  }

  let body: unknown;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed JSON body' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a JSON object' });
  }

  const candidate = body as Record<string, unknown>;
  let nodes: PenNode[];
  let title: string;

  if (isPenDocumentShape(candidate)) {
    const doc = candidate as unknown as PenDocument;
    nodes = collectPenDocumentNodes(doc);
    title = doc.name ?? 'Wireframe';
  } else if (Array.isArray(candidate.nodes)) {
    // Legacy DesignImportDocument shape — still supported so any existing
    // caller that hasn't migrated keeps working.
    const importDoc = candidate as unknown as DesignImportDocument;
    const mapped = mapImportToPenNodes(importDoc);
    nodes = mapped.nodes;
    title = importDoc.name ?? 'Wireframe';
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Body must be a PenDocument (with `pages`/`children`) or a DesignImportDocument (with `nodes`)',
    });
  }

  let html: string;
  try {
    html = generateHtml(nodes, { title });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createError({ statusCode: 500, statusMessage: `Codegen failure: ${message}` });
  }

  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return html;
});

/**
 * Detect a PenDocument-shaped payload. Requires a `version` string AND either
 * a `pages` array or a `children` array — same rule the canvas uses to
 * decide whether to apply an external doc verbatim.
 */
function isPenDocumentShape(value: Record<string, unknown>): boolean {
  if (typeof value.version !== 'string') return false;
  return Array.isArray(value.pages) || Array.isArray(value.children);
}

/**
 * Flatten a PenDocument's renderable nodes into a single array for the
 * html-generator. Pages are concatenated in declared order; the top-level
 * `children` fallback (single-page docs Mira emits without a `pages` wrapper)
 * is honored alongside any `pages` so partially-shaped docs still render.
 */
function collectPenDocumentNodes(doc: PenDocument): PenNode[] {
  const nodes: PenNode[] = [];
  if (Array.isArray(doc.pages)) {
    for (const page of doc.pages) {
      if (page && Array.isArray(page.children)) {
        nodes.push(...page.children);
      }
    }
  }
  if (Array.isArray(doc.children)) {
    nodes.push(...doc.children);
  }
  return nodes;
}
