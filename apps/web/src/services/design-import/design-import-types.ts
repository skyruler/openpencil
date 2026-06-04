/**
 * Author-friendly JSON contract for importing a design artifact onto the
 * editor canvas. The shape is intentionally a shallow subset of PenNode —
 * shorthand keys (`bg`, `radius`, `padX`, `padY`, `flex`) get mapped into the
 * canonical PenNode fields by the mapper.
 *
 * Only the types listed in {@link DesignImportType} are accepted; anything
 * else maps onto a PenNode the canvas can render.
 */

export type DesignImportType = 'frame' | 'text' | 'rectangle' | 'ellipse' | 'image';

export type DesignImportFlex = 'row' | 'col';

export interface DesignImportNode {
  /** PenNode-compatible kind. */
  type: DesignImportType;
  /** Layer name shown in the layer panel. */
  name?: string;
  /** Absolute x within the parent (or page). */
  x?: number;
  /** Absolute y within the parent (or page). */
  y?: number;
  /** Width in CSS pixels. */
  w?: number;
  /** Height in CSS pixels. */
  h?: number;
  /** Solid background color, e.g. "#ffffff" or "#fff". */
  bg?: string;
  /**
   * Text content. On `text` nodes this is the literal string; on other types
   * the mapper wraps it in a child text node so authoring stays terse.
   */
  text?: string;
  /** Font size in px (text nodes). */
  fontSize?: number;
  /** Font weight, numeric (400) or keyword ("medium"). */
  fontWeight?: number | string;
  /** Foreground color for text. */
  color?: string;
  /** Uniform corner radius in px. */
  radius?: number;
  /** Horizontal padding (autolayout left+right). */
  padX?: number;
  /** Vertical padding (autolayout top+bottom). */
  padY?: number;
  /** Gap between autolayout children in px. */
  gap?: number;
  /** Autolayout direction. */
  flex?: DesignImportFlex;
  /** Image source URL — required for `image` nodes. */
  src?: string;
  /** Nested children. */
  children?: DesignImportNode[];
}

export interface DesignImportDocument {
  /** Optional document name (currently informational, not persisted). */
  name?: string;
  /** Top-level nodes to insert into the active page. */
  nodes: DesignImportNode[];
}

export interface DesignImportResult {
  /** Ids of the top-level nodes that were inserted into the page. */
  inserted: string[];
  /** Non-fatal warnings raised during mapping (unknown keys, dropped fields). */
  warnings: string[];
}
