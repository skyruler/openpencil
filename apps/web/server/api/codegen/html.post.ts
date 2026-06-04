import { defineEventHandler, readBody, createError, getRequestHeader, setResponseHeader } from 'h3';
import { mapImportToPenNodes } from '../../../src/services/design-import/design-import-mapper';
import { generateHtml } from '../../../src/services/codegen/html-generator';
import type { DesignImportDocument } from '../../../src/services/design-import/design-import-types';

const SECRET_ENV = 'OPENPENCIL_CODEGEN_SECRET';
const SECRET_HEADER = 'x-codegen-secret';

/**
 * POST /api/codegen/html
 *
 * Stateless HTTP wrapper around the design-import-mapper + html-generator
 * pipeline. Rails (the Comet wireframes phase) POSTs a DesignImportDocument
 * — Mira's JSON wireframe — and the endpoint returns the equivalent
 * Tailwind HTML. No persistence here; this server has no opinion about
 * where the JSON came from or what Rails does with the HTML response.
 *
 * Body shape: `DesignImportDocument` = `{ name?: string, nodes: ImportNode[] }`.
 *
 * Optional auth — when `OPENPENCIL_CODEGEN_SECRET` is set in the
 * environment, requests must carry a matching `x-codegen-secret` header.
 * When the env is absent the endpoint serves any caller (development
 * default; production typically sets the secret).
 *
 * Responses:
 *   - 200 `text/html; charset=utf-8` — generated HTML body
 *   - 400 `{ error }` — missing/invalid `nodes` array, malformed JSON body
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

  let body: DesignImportDocument | undefined;
  try {
    body = await readBody<DesignImportDocument>(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed JSON body' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a JSON object' });
  }

  if (!Array.isArray(body.nodes)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must include a `nodes` array' });
  }

  let html: string;
  try {
    const { nodes } = mapImportToPenNodes(body);
    html = generateHtml(nodes, { title: body.name ?? 'Wireframe' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createError({ statusCode: 500, statusMessage: `Codegen failure: ${message}` });
  }

  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return html;
});
