export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'lighten'
  | 'difference'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

// --- Fill Types ---

export interface SolidFill {
  type: 'solid';
  color: string; // #RRGGBB or #RRGGBBAA
  explain?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface GradientStop {
  offset: number; // 0 to 1
  color: string;
}

export interface LinearGradientFill {
  type: 'linear_gradient';
  angle?: number;
  stops: GradientStop[];
  explain?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface RadialGradientFill {
  type: 'radial_gradient';
  cx?: number;
  cy?: number;
  radius?: number;
  stops: GradientStop[];
  explain?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface ImageOriginalSize {
  width: number;
  height: number;
}

export interface ImageTransform {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface ImageFill {
  type: 'image';
  url: string;
  mode?: 'fill' | 'fit' | 'crop' | 'tile' | 'stretch';
  originalSize?: ImageOriginalSize;
  transform?: ImageTransform;
  explain?: string;
  opacity?: number;
  exposure?: number; // -100 to 100
  contrast?: number; // -100 to 100
  saturation?: number; // -100 to 100
  temperature?: number; // -100 to 100
  tint?: number; // -100 to 100
  highlights?: number; // -100 to 100
  shadows?: number; // -100 to 100
}

export type PenFill = SolidFill | LinearGradientFill | RadialGradientFill | ImageFill;

// --- Stroke ---

/**
 * Sides a stroke applies to on a rectangular shape (frame, rectangle, group).
 *
 * - Omit (or pass `undefined`/all four) for the standard "stroke on every
 *   side" behavior.
 * - Pass a subset (e.g. `['right']` or `['top', 'bottom']`) to draw the
 *   stroke only on those edges. This is the round-trip representation of
 *   Tailwind's `border-r` / `border-t border-b` and Figma's per-side
 *   stroke weights.
 *
 * Ignored by non-rectangular nodes (ellipse, path, line, polygon) — those
 * always stroke the entire shape outline.
 */
export type PenStrokeSide = 'top' | 'right' | 'bottom' | 'left';

export interface PenStroke {
  thickness: number | [number, number, number, number];
  align?: 'inside' | 'center' | 'outside';
  join?: 'miter' | 'bevel' | 'round';
  cap?: 'none' | 'round' | 'square';
  dashPattern?: number[];
  dashOffset?: number;
  fill?: PenFill[];
  /**
   * Optional subset of sides the stroke applies to on rectangular nodes.
   * Omit or pass all four sides for a full border. Invalid entries are
   * dropped by `normalizeStrokeFillSchema`.
   */
  sides?: PenStrokeSide[];
}

// --- Effects ---

export interface BlurEffect {
  type: 'blur' | 'background_blur';
  radius: number;
}

export interface ShadowEffect {
  type: 'shadow';
  inner?: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

export type PenEffect = BlurEffect | ShadowEffect;

// --- Text ---

export interface StyledTextSegment {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fill?: string;
  underline?: boolean;
  strikethrough?: boolean;
  href?: string;
}
