// apps/web/src/services/rails-pipeline/rails-pipeline-client.ts
//
// Client for the Rails Comet pipeline JSON API. The Rails side exposes:
//   GET /api/canvas/pipelines/:id           → pipeline JSON (this file's RailsPipeline shape)
//   GET /api/canvas/pipelines/:id/files/*p  → raw artifact bytes with Content-Type
//
// Base URL is read from VITE_RAILS_BASE_URL at build time, defaulting to
// http://localhost:3000 for local dev against the Rails app.

export interface RailsArtifact {
  path: string;
  content_type: string;
  size: number;
  url: string;
}

export interface RailsPhase {
  type: string;
  status: string;
  position: number;
  artifacts: RailsArtifact[];
}

export interface RailsPipeline {
  id: number;
  brief: string;
  name: string;
  phases: RailsPhase[];
}

const ENV_BASE =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_RAILS_BASE_URL;

export const RAILS_BASE_URL: string = ENV_BASE && ENV_BASE.length > 0 ? ENV_BASE : 'http://localhost:3000';

export class RailsPipelineError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RailsPipelineError';
    this.status = status;
  }
}

/**
 * Fetch a pipeline by id from the Rails API.
 * Throws RailsPipelineError on non-2xx responses or network failures.
 */
export async function fetchPipeline(id: number): Promise<RailsPipeline> {
  const url = `${RAILS_BASE_URL}/api/canvas/pipelines/${id}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RailsPipelineError(`Network error fetching pipeline ${id}: ${message}`);
  }
  if (!response.ok) {
    throw new RailsPipelineError(
      `Failed to fetch pipeline ${id}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return (await response.json()) as RailsPipeline;
}

/**
 * Fetch artifact text by URL. The URL is typically a relative path returned
 * by the pipeline JSON (e.g. "/api/canvas/pipelines/994/files/wireframes/tasks-index.html").
 * Absolute URLs are also supported.
 */
export async function fetchArtifactText(url: string): Promise<string> {
  const fullUrl = url.startsWith('http') ? url : `${RAILS_BASE_URL}${url}`;
  let response: Response;
  try {
    response = await fetch(fullUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RailsPipelineError(`Network error fetching artifact: ${message}`);
  }
  if (!response.ok) {
    throw new RailsPipelineError(
      `Failed to fetch artifact: ${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return await response.text();
}

/**
 * Resolve an artifact URL to its absolute form using RAILS_BASE_URL.
 * Useful for building iframe src attributes.
 */
export function resolveArtifactUrl(url: string): string {
  return url.startsWith('http') ? url : `${RAILS_BASE_URL}${url}`;
}
