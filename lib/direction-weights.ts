/**
 * Live Play per-Cell scroll direction — which axis and polarity a Cell's
 * shared scroll offset travels along (`up` / `down` / `left` / `right`).
 *
 * Deliberately not part of `EffectSettings`, for the same reason `speedRamp`
 * isn't (see `lib/speed-ramp.ts`): direction only has an effect once `offsetY`
 * is nonzero, so it must never invalidate a static render (Bake, Random,
 * History, exports, normal editing all render at `offsetY = 0`).
 */

export type Direction = "up" | "down" | "left" | "right"

export type DirectionWeights = {
  up: number
  down: number
  left: number
  right: number
}

/** All-Down: exactly the behavior Live Play had before per-Cell direction existed. */
export const DEFAULT_DIRECTION_WEIGHTS: DirectionWeights = {
  up: 0,
  down: 100,
  left: 0,
  right: 0,
}

const DIRECTION_WEIGHT_BASE = 100

/**
 * Weighted direction assignment from a Cell's stable `randomVal` — the same
 * cumulative-bucket algorithm as `chooseEffect` / `chooseSmear` in
 * `lib/pipeline.ts`: `target = randomVal * max(100, sum of weights)`, first
 * matching bucket wins. Weights that sum to ≤ 100 are each an absolute share
 * of Cells; above 100 they compete relatively.
 *
 * Unlike Effects (whose padded remainder falls to "original") or Smears
 * (whose padded remainder falls to no smear at all), every ON Cell has to
 * travel somewhere once Live Play is running, so the pad falls to "down" —
 * the same catch-all role `weightOriginal` plays for `chooseEffect`, and the
 * direction the pre-multi-direction worker always used.
 */
export function chooseDirection(
  randomVal: number,
  weights: DirectionWeights
): Direction {
  const wUp = Math.max(0, weights.up)
  const wDown = Math.max(0, weights.down)
  const wLeft = Math.max(0, weights.left)
  const wRight = Math.max(0, weights.right)
  const sum = wUp + wDown + wLeft + wRight

  const effectiveTotal = Math.max(DIRECTION_WEIGHT_BASE, sum)
  const target = randomVal * effectiveTotal
  const afterUp = wUp
  const afterDown = afterUp + wDown
  const afterLeft = afterDown + wLeft

  if (target < afterUp) return "up"
  if (target < afterDown) return "down"
  if (target < afterLeft) return "left"
  if (target < afterLeft + wRight) return "right"
  return "down"
}
