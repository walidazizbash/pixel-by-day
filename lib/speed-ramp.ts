/**
 * Live Play "speed ramp" — a Houdini Attribute-Randomize-style curve. The X axis is
 * each Cell's position along a fixed, deterministic random ordering (`cellRampPosition`);
 * the Y axis is that Cell's multiplier on the shared Live Play offset. Editing the curve
 * shapes how many Cells run at what speed, rather than a single blanket "amount".
 *
 * Shared between the worker (evaluates the curve per Cell every animated frame) and the
 * UI (draws the same curve in the editor), so both must read it from here rather than
 * each rolling their own copy.
 *
 * Deliberately not part of `EffectSettings`, for the same reason `offsetY` and
 * `livePlaySpeed` aren't: the ramp only has an effect once `offsetY` is nonzero, so it
 * must never invalidate a static render (Bake, Random, History, exports, normal editing
 * all render at `offsetY = 0`).
 */

/** One control point. `x` and `y` are both stored pre-clamped to their ranges. */
export type SpeedRampPoint = { x: number; y: number }

export const SPEED_RAMP_X_MIN = 0
export const SPEED_RAMP_X_MAX = 1
/** 0 = frozen, 1 = the shared Live Play speed unchanged, 2 = double speed. */
export const SPEED_RAMP_Y_MIN = 0
export const SPEED_RAMP_Y_MAX = 2
/** The Y value an out-of-range fallback lands on — the shared speed, unchanged. */
export const SPEED_RAMP_Y_NEUTRAL = 1

/**
 * A linear ramp from frozen (0×) to the shared, unmodified speed (1×): the two
 * endpoints at (0,0) and (1, `SPEED_RAMP_Y_NEUTRAL`) — deliberately *not*
 * `SPEED_RAMP_Y_MAX`, so raising the ceiling for manual edits doesn't also make
 * the default curve run any Cell past its normal speed. The worker's own
 * fallback for a missing/invalid ramp and the UI's starting curve (including
 * what Reset returns to) — shared on purpose, since both independently want the
 * same starting shape here, not merely coincidentally equal opinions (contrast
 * `CONTROL_DEFAULTS`, which are deliberately independent of
 * `sanitizeEffectSettings`'s fallbacks because those really do differ).
 */
export const DEFAULT_SPEED_RAMP: readonly SpeedRampPoint[] = [
  { x: SPEED_RAMP_X_MIN, y: SPEED_RAMP_Y_MIN },
  { x: SPEED_RAMP_X_MAX, y: SPEED_RAMP_Y_NEUTRAL },
]

/**
 * Deterministic per-Cell position along the ramp's X axis, in [0, 1). A sine hash of
 * the Cell's fixed position, like the layout's own Phase 1 hash — but with different
 * constants and a different output shape (remapped to [0,1) instead of [-1,1]) so a
 * Cell's ramp position does not correlate with `randomVal`, which already picks its
 * effect and smear. Without that independence, "which Cells are slow" would visibly
 * track "which Cells got Invert" instead of reading as its own random distribution.
 */
export function cellRampPosition(x: number, y: number): number {
  const s = Math.sin(x * 39.3467 + y * 11.135)
  return (s + 1) / 2
}

/**
 * The ramp's constant Y value if every point shares one, else `null`. Lets a
 * caller skip `cellRampPosition`'s trig and the per-Cell evaluation entirely
 * when the ramp has no actual variation to apply — e.g. a manually flattened
 * ramp, or the empty-array edge case.
 */
export function uniformSpeedRampValue(
  points: readonly SpeedRampPoint[]
): number | null {
  if (points.length === 0) return SPEED_RAMP_Y_NEUTRAL
  const y = points[0]!.y
  return points.every((p) => p.y === y) ? y : null
}

/**
 * Evaluate the ramp at `x` (clamped to [0,1]). `points` must already be sorted
 * ascending by `x` — every producer of a `SpeedRampPoint[]` in this codebase
 * (`sanitizeSpeedRamp`, the editor) guarantees that.
 *
 * Straight-line interpolation between adjacent points — what you see in the
 * editor is exactly the speed each Cell gets, with no easing smoothing it out.
 */
export function evaluateSpeedRamp(
  points: readonly SpeedRampPoint[],
  x: number
): number {
  if (points.length === 0) return SPEED_RAMP_Y_NEUTRAL
  if (points.length === 1) return points[0]!.y

  const clampedX = Math.min(SPEED_RAMP_X_MAX, Math.max(SPEED_RAMP_X_MIN, x))
  const first = points[0]!
  if (clampedX <= first.x) return first.y
  const last = points[points.length - 1]!
  if (clampedX >= last.x) return last.y

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (clampedX > b.x) continue
    const span = b.x - a.x
    const t = span > 0 ? (clampedX - a.x) / span : 0
    return a.y + (b.y - a.y) * t
  }
  return last.y
}
