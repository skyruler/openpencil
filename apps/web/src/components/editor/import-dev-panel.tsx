import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/document-store';
import { SAMPLE_TASKS_INDEX } from '@/services/design-import/sample-wireframe';
import { htmlToImportJson } from '@/services/design-import/html-to-import-json';
import { isPenDocumentShape } from '@/services/design-import/design-import-store-action';
import {
  fetchArtifactText,
  fetchPipeline,
  RailsPipelineError,
  type RailsArtifact,
} from '@/services/rails-pipeline/rails-pipeline-client';
import type { DesignImportDocument } from '@/services/design-import/design-import-types';
import type { PenDocument } from '@/types/pen';
import { zoomToFitContent } from '@/canvas/skia-engine-ref';

/**
 * Dev affordance: floating panel that imports a Rails Comet pipeline's
 * wireframes phase onto the canvas. Prefers wireframes/*.json artifacts
 * (Mira's new JSON output); falls back to wireframes/*.html via the
 * HTML→JSON converter for legacy pipelines.
 */
type ParsedDoc =
  | { kind: 'pen'; doc: PenDocument }
  | { kind: 'import'; doc: DesignImportDocument };

export default function ImportDevPanel() {
  const importDesign = useDocumentStore((s) => s.importDesign);
  const importPenDocument = useDocumentStore((s) => s.importPenDocument);
  const [pipelineId, setPipelineId] = useState('994');
  const [status, setStatus] = useState<string>('');
  const [running, setRunning] = useState(false);

  const importSample = useCallback(() => {
    const result = importDesign(SAMPLE_TASKS_INDEX);
    setStatus(`sample → inserted ${result.inserted.length} nodes`);
    requestAnimationFrame(() => zoomToFitContent());
  }, [importDesign]);

  const importPipeline = useCallback(async () => {
    const id = Number(pipelineId);
    if (!Number.isFinite(id) || id <= 0) {
      setStatus('invalid pipeline id');
      return;
    }
    setRunning(true);
    setStatus(`fetching pipeline ${id}…`);
    try {
      const pipeline = await fetchPipeline(id);
      const wireframes = pipeline.phases.find((p) => p.type === 'wireframes');
      if (!wireframes) {
        setStatus(`pipeline ${id} has no wireframes phase`);
        return;
      }
      const parsed: ParsedDoc[] = [];
      const conversionWarnings: string[] = [];
      const targets = pickArtifacts(wireframes.artifacts);
      for (const artifact of targets) {
        setStatus(`fetching ${artifact.path}…`);
        const text = await fetchArtifactText(artifact.url);
        if (artifact.path.endsWith('.json')) {
          // Native PenDocument (Mira's new emitter) — detect by shape.
          // Legacy pipelines still emitting the simplified import shape
          // (`{ nodes: [...] }`) fall through to the importDesign path so
          // they keep working until they re-run.
          const raw = JSON.parse(text) as unknown;
          if (isPenDocumentShape(raw)) {
            parsed.push({ kind: 'pen', doc: raw });
          } else {
            parsed.push({ kind: 'import', doc: raw as DesignImportDocument });
          }
        } else {
          const result = htmlToImportJson(text);
          parsed.push({ kind: 'import', doc: result.document });
          conversionWarnings.push(...result.warnings);
        }
      }
      let inserted = 0;
      let warnings = 0;
      parsed.forEach((entry, idx) => {
        if (entry.kind === 'pen') {
          // Native PenDocument path — replaces the canvas wholesale via
          // applyExternalDocument; multi-screen offset doesn't apply.
          const r = importPenDocument(entry.doc);
          inserted += r.inserted.length;
          warnings += r.warnings.length;
        } else {
          const offsetDoc = offsetScreen(entry.doc, idx);
          const r = importDesign(offsetDoc);
          inserted += r.inserted.length;
          warnings += r.warnings.length + conversionWarnings.length;
        }
      });
      setStatus(
        `pipeline ${id} → ${parsed.length} screen(s), ${inserted} nodes${warnings ? `, ${warnings} warnings` : ''}`,
      );
      requestAnimationFrame(() => zoomToFitContent());
    } catch (err) {
      const message = err instanceof RailsPipelineError ? err.message : err instanceof Error ? err.message : String(err);
      setStatus(`failed: ${message}`);
    } finally {
      setRunning(false);
    }
  }, [importDesign, importPenDocument, pipelineId]);

  return (
    <div className="pointer-events-auto flex flex-col gap-1 rounded-md border border-border bg-card/90 px-2 py-2 shadow-sm backdrop-blur">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Dev
        </span>
        <input
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="h-7 w-16 rounded-md border border-border bg-background px-2 text-xs"
          placeholder="id"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="default" size="sm" className="h-7 text-xs" onClick={importPipeline} disabled={running}>
              {running ? '…' : 'Import pipeline'}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Fetch Rails pipeline wireframes, convert HTML→JSON if needed, drop on canvas.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={importSample}>
              Sample
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Drop SAMPLE_TASKS_INDEX (hardcoded).</TooltipContent>
        </Tooltip>
      </div>
      {status && (
        <span className="text-[10px] text-muted-foreground">{status}</span>
      )}
    </div>
  );
}

// Prefer JSON artifacts (Mira's new format); fall back to HTML.
function pickArtifacts(artifacts: RailsArtifact[]): RailsArtifact[] {
  const json = artifacts.filter((a) => a.path.endsWith('.json'));
  if (json.length > 0) return json;
  return artifacts.filter((a) => a.path.endsWith('.html'));
}

// Multi-screen layout: shift each screen by 1380px so they sit side-by-side.
function offsetScreen(doc: DesignImportDocument, idx: number): DesignImportDocument {
  if (idx === 0) return doc;
  const dx = idx * 1380;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({ ...n, x: (n.x ?? 0) + dx })),
  };
}
