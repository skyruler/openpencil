import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/document-store';
import { SAMPLE_TASKS_INDEX } from '@/services/design-import/sample-wireframe';
import { zoomToFitContent } from '@/canvas/skia-engine-ref';

/**
 * Dev affordance: floating button that drops a sample JSON wireframe onto
 * the canvas via the new design-import pipeline. Marked DEV so it's
 * unambiguous this isn't part of the shipped editor chrome.
 */
export default function ImportDevPanel() {
  const importDesign = useDocumentStore((s) => s.importDesign);
  const [lastInserted, setLastInserted] = useState<number | null>(null);

  const handleClick = useCallback(() => {
    const result = importDesign(SAMPLE_TASKS_INDEX);
    setLastInserted(result.inserted.length);
    if (result.warnings.length > 0) {
      // Console-only — warnings are a debug signal, not user-facing.
      console.warn('[design-import] warnings:', result.warnings);
    }
    // Re-fit so the imported wireframe is visible regardless of viewport.
    requestAnimationFrame(() => zoomToFitContent());
  }, [importDesign]);

  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Dev
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleClick}>
            Import sample wireframe
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          Drops SAMPLE_TASKS_INDEX onto the active page via importDesign().
        </TooltipContent>
      </Tooltip>
      {lastInserted !== null && (
        <span className="text-[10px] text-muted-foreground">
          inserted {lastInserted} node{lastInserted === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}
