/**
 * Texture ramps — X is each Cell's stable `randomVal`. Scale Y ∈ [0, 1] maps
 * to a discrete pixel size; invert Y ∈ [0, 1] is original below the dashed
 * midline and inverted color at/above it. Editing a curve shapes how many
 * Cells get which size or polarity, rather than a single slider.
 *
 * Lives on `EffectSettings` (not `LayoutParams`) so dragging it re-renders
 * Phase 2 textures without busting the Phase 1 layout cache.
 */

import {
  evaluateSpeedRamp,
  type SpeedRampPoint,
} from "@/lib/speed-ramp"

export const DITHER_RAMP_X_MIN = 0
export const DITHER_RAMP_X_MAX = 1
export const DITHER_RAMP_Y_MIN = 0
export const DITHER_RAMP_Y_MAX = 1
/**
 * Mid-plot Y — the 4× bin starts here (`cellDitherScale(0.5) === 4`). Same
 * role as `SPEED_RAMP_Y_NEUTRAL`: the dashed guide and the default right
 * endpoint sit here so the ceiling (8×) is available to edit, not the start.
 */
export const DITHER_RAMP_Y_NEUTRAL = 0.5

/** Linear 1× → 4×: low `randomVal` Cells stay 1×, high `randomVal` Cells go 4×. */
export const DEFAULT_DITHER_RAMP: readonly SpeedRampPoint[] = [
  { x: DITHER_RAMP_X_MIN, y: DITHER_RAMP_Y_MIN },
  { x: DITHER_RAMP_X_MAX, y: DITHER_RAMP_Y_NEUTRAL },
]

/**
 * Same curve as dither (1× → 3× on the dashed midline). Halftone's own
 * bins cap at 6× / 36px rather than dither's 8×.
 */
export const DEFAULT_HALFTONE_RAMP: readonly SpeedRampPoint[] = [
  { x: DITHER_RAMP_X_MIN, y: DITHER_RAMP_Y_MIN },
  { x: DITHER_RAMP_X_MAX, y: DITHER_RAMP_Y_NEUTRAL },
]

/** Discrete Bayer scale from a ramp Y in [0, 1]. */
export function cellDitherScale(y: number): number {
  if (y < 0.25) return 1
  if (y < 0.5) return 2
  if (y < 0.75) return 4
  return 8
}

/** Evaluate the curve at this Cell's `randomVal`, then snap to 1 / 2 / 4 / 8. */
export function cellDitherScaleFromRamp(
  points: readonly SpeedRampPoint[],
  randomVal: number
): number {
  return cellDitherScale(evaluateSpeedRamp(points, randomVal))
}

/** Discrete halftone scale from a ramp Y in [0, 1]: 1× / 2× / 3× / 6×. */
export function cellHalftoneScale(y: number): number {
  if (y < 0.25) return 1
  if (y < 0.5) return 2
  if (y < 0.75) return 3
  return 6
}

/** Evaluate the curve at this Cell's `randomVal`, then snap to 1 / 2 / 3 / 6. */
export function cellHalftoneScaleFromRamp(
  points: readonly SpeedRampPoint[],
  randomVal: number
): number {
  return cellHalftoneScale(evaluateSpeedRamp(points, randomVal))
}

export const INVERT_RAMP_Y_MIN = 0
export const INVERT_RAMP_Y_MAX = 1
/**
 * Invert threshold — same Y as the dashed midline. Below = original ink;
 * at/above = swapped ink/paper. Shared by dither and halftone.
 */
export const INVERT_RAMP_Y_NEUTRAL = 0.5

/** Flat original — invert is opt-in. Shared by dither and halftone. */
export const DEFAULT_INVERT_RAMP: readonly SpeedRampPoint[] = [
  { x: DITHER_RAMP_X_MIN, y: INVERT_RAMP_Y_MIN },
  { x: DITHER_RAMP_X_MAX, y: INVERT_RAMP_Y_MIN },
]

/** True when this Cell's ramp Y sits on or above the dashed invert line. */
export function cellInvertedFromRamp(
  points: readonly SpeedRampPoint[],
  randomVal: number
): boolean {
  return evaluateSpeedRamp(points, randomVal) >= INVERT_RAMP_Y_NEUTRAL
}
