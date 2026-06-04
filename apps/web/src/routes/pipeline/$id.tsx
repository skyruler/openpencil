// apps/web/src/routes/pipeline/$id.tsx
//
// Viewer for a Rails Comet pipeline. Reads `:id` from the URL, fetches the
// pipeline JSON via the rails-pipeline client, and renders a phase sidebar
// + an artifact preview pane. HTML artifacts render in a sandboxed iframe;
// everything else falls back to a <pre> text view.
//
// Uses the simple useEffect-fetch pattern (not TanStack loaders) because
// the existing routes in this app (editor, index) don't use loaders either
// and we want to match the established style.

import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  fetchArtifactText,
  fetchPipeline,
  resolveArtifactUrl,
  type RailsArtifact,
  type RailsPhase,
  type RailsPipeline,
} from '@/services/rails-pipeline/rails-pipeline-client';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/pipeline/$id')({
  component: PipelinePage,
  ssr: false,
  head: () => ({
    meta: [{ title: 'Pipeline · OpenPencil' }],
  }),
});

function PipelinePage() {
  const { id } = Route.useParams();
  const numericId = Number(id);

  const [pipeline, setPipeline] = useState<RailsPipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(numericId)) {
      setError(`Invalid pipeline id: ${id}`);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPipeline(numericId)
      .then((p) => {
        if (cancelled) return;
        setPipeline(p);
        // Pick the first artifact of the first phase that has one, so the
        // viewer is never blank on initial load.
        const firstWithArtifact = p.phases.find((ph) => ph.artifacts.length > 0);
        setSelectedPath(firstWithArtifact?.artifacts[0]?.path ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [numericId, id]);

  const selectedArtifact = useMemo<RailsArtifact | null>(() => {
    if (!pipeline || !selectedPath) return null;
    for (const phase of pipeline.phases) {
      const hit = phase.artifacts.find((a) => a.path === selectedPath);
      if (hit) return hit;
    }
    return null;
  }, [pipeline, selectedPath]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Loading pipeline {id}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-md text-center">
          <p className="text-destructive font-medium mb-2">Failed to load pipeline</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        No pipeline data.
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="px-6 py-4 border-b border-border">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">{pipeline.name}</h1>
          <span className="text-xs text-muted-foreground">#{pipeline.id}</span>
        </div>
        {pipeline.brief && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{pipeline.brief}</p>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r border-border overflow-y-auto bg-card">
          <PhaseList
            phases={pipeline.phases}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">
          <ArtifactViewer artifact={selectedArtifact} />
        </main>
      </div>
    </div>
  );
}

interface PhaseListProps {
  phases: RailsPhase[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function PhaseList({ phases, selectedPath, onSelect }: PhaseListProps) {
  if (phases.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No phases yet.</p>;
  }
  // Sort by position so the sidebar follows pipeline order regardless of API ordering.
  const sorted = [...phases].sort((a, b) => a.position - b.position);
  return (
    <ul className="p-2 space-y-1">
      {sorted.map((phase) => (
        <li key={`${phase.type}-${phase.position}`}>
          <div className="px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{phase.type}</span>
              <PhaseStatusBadge status={phase.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {phase.artifacts.length} artifact{phase.artifacts.length === 1 ? '' : 's'}
            </p>
          </div>
          {phase.artifacts.length > 0 && (
            <ul className="ml-2 mb-1 space-y-0.5">
              {phase.artifacts.map((artifact) => (
                <li key={artifact.path}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelect(artifact.path)}
                    className={cn(
                      'w-full justify-start font-mono text-xs h-auto py-1.5 px-2',
                      selectedPath === artifact.path && 'bg-accent text-accent-foreground',
                    )}
                    title={artifact.path}
                  >
                    <span className="truncate">{artifact.path}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Separator className="my-1" />
        </li>
      ))}
    </ul>
  );
}

function PhaseStatusBadge({ status }: { status: string }) {
  // Tone-map statuses onto design-token classes only — no raw color names.
  const tone =
    status === 'succeeded'
      ? 'bg-primary/15 text-primary'
      : status === 'failed'
        ? 'bg-destructive/15 text-destructive'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        tone,
      )}
    >
      {status}
    </span>
  );
}

function ArtifactViewer({ artifact }: { artifact: RailsArtifact | null }) {
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const isHtml = artifact?.content_type?.includes('html') ?? false;
  const isTextual =
    !!artifact &&
    !isHtml &&
    (artifact.content_type.startsWith('text/') ||
      artifact.content_type.includes('json') ||
      artifact.content_type.includes('xml') ||
      artifact.content_type.includes('javascript') ||
      artifact.content_type.includes('svg'));

  useEffect(() => {
    if (!artifact || !isTextual) {
      setText(null);
      setTextError(null);
      return;
    }
    let cancelled = false;
    setTextLoading(true);
    setTextError(null);
    fetchArtifactText(artifact.url)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setTextError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, isTextual]);

  if (!artifact) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select an artifact to preview.
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 py-2 border-b border-border bg-card flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs truncate" title={artifact.path}>
            {artifact.path}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {artifact.content_type} · {formatBytes(artifact.size)}
          </p>
        </div>
        <a
          href={resolveArtifactUrl(artifact.url)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline shrink-0"
        >
          Open raw
        </a>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-background">
        {isHtml ? (
          <iframe
            key={artifact.url}
            src={resolveArtifactUrl(artifact.url)}
            title={artifact.path}
            className="w-full h-full border-0 bg-card"
            sandbox="allow-same-origin"
          />
        ) : isTextual ? (
          textLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : textError ? (
            <p className="p-4 text-sm text-destructive">Failed to load: {textError}</p>
          ) : (
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words text-foreground">
              {text ?? ''}
            </pre>
          )
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Preview not available for {artifact.content_type}. Use “Open raw” to download.
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
