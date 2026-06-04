// apps/web/src/services/rails-pipeline/rails-pipeline-client.test.ts
//
// Tests for the Rails pipeline client. We mock global fetch with vi.spyOn —
// no MSW in this repo; the project's other service tests (git-client) also
// stub their transport directly, so we match that pattern.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchArtifactText,
  fetchPipeline,
  RAILS_BASE_URL,
  RailsPipelineError,
  resolveArtifactUrl,
  type RailsPipeline,
} from '@/services/rails-pipeline/rails-pipeline-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

const SAMPLE_PIPELINE: RailsPipeline = {
  id: 994,
  brief: 'A tiny task manager.',
  name: 'MicroProject',
  phases: [
    {
      type: 'wireframes',
      status: 'succeeded',
      position: 5,
      artifacts: [
        {
          path: 'wireframes/tasks-index.html',
          content_type: 'text/html',
          size: 43002,
          url: '/api/canvas/pipelines/994/files/wireframes/tasks-index.html',
        },
      ],
    },
  ],
};

describe('rails-pipeline-client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('fetchPipeline', () => {
    it('returns the typed pipeline on a 200 response', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(SAMPLE_PIPELINE));
      const result = await fetchPipeline(994);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(`${RAILS_BASE_URL}/api/canvas/pipelines/994`);
      expect((init.headers as Record<string, string>).Accept).toBe('application/json');
      expect(result).toEqual(SAMPLE_PIPELINE);
      expect(result.phases[0].artifacts[0].path).toBe('wireframes/tasks-index.html');
    });

    it('throws RailsPipelineError with status on a 404 response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('not found', { status: 404, statusText: 'Not Found' }),
      );
      const err = await fetchPipeline(123).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RailsPipelineError);
      expect((err as RailsPipelineError).status).toBe(404);
      expect((err as RailsPipelineError).message).toContain('404');
    });

    it('wraps a network failure in RailsPipelineError', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const err = await fetchPipeline(7).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RailsPipelineError);
      expect((err as RailsPipelineError).status).toBeUndefined();
      expect((err as RailsPipelineError).message).toContain('Network error');
      expect((err as RailsPipelineError).message).toContain('Failed to fetch');
    });
  });

  describe('fetchArtifactText', () => {
    it('returns the response body as text and prepends base URL for relative paths', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse('<html>hi</html>'));
      const text = await fetchArtifactText('/api/canvas/pipelines/994/files/wireframes/x.html');

      expect(text).toBe('<html>hi</html>');
      const [calledUrl] = fetchSpy.mock.calls[0] as [string];
      expect(calledUrl).toBe(`${RAILS_BASE_URL}/api/canvas/pipelines/994/files/wireframes/x.html`);
    });

    it('passes absolute URLs through unchanged', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse('{"a":1}', 200, 'application/json'));
      const text = await fetchArtifactText('http://example.test/raw.json');

      expect(text).toBe('{"a":1}');
      const [calledUrl] = fetchSpy.mock.calls[0] as [string];
      expect(calledUrl).toBe('http://example.test/raw.json');
    });

    it('throws RailsPipelineError on non-2xx responses', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('gone', { status: 410, statusText: 'Gone' }),
      );
      const err = await fetchArtifactText('/x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RailsPipelineError);
      expect((err as RailsPipelineError).status).toBe(410);
    });

    it('wraps a network failure in RailsPipelineError', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('socket hang up'));
      const err = await fetchArtifactText('/x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RailsPipelineError);
      expect((err as RailsPipelineError).message).toContain('socket hang up');
    });
  });

  describe('resolveArtifactUrl', () => {
    it('prepends the base URL for relative paths', () => {
      expect(resolveArtifactUrl('/api/canvas/pipelines/1/files/a.html')).toBe(
        `${RAILS_BASE_URL}/api/canvas/pipelines/1/files/a.html`,
      );
    });

    it('returns absolute URLs untouched', () => {
      expect(resolveArtifactUrl('https://elsewhere.test/foo')).toBe('https://elsewhere.test/foo');
    });
  });
});
