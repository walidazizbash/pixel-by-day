/**
 * Phase 1 layout types — geometry cache key and layout-mode settings.
 * Mask / effect settings must never live here.
 */

export type SubdivisionMode = "frontier" | "global"

/**
 * Params that control Phase 1 geometry only.
 * Noise/mask settings intentionally excluded — they must not invalidate the floor cache.
 */
export type LayoutParams = {
  layoutVersion: number
  seed: number
  randomSample: boolean
  /** Resolution-aware grid unit in pixels. */
  baseCellSize: number
  sourceWidth: number
  sourceHeight: number
  /** Subdivision pass count (1–7). */
  subdivisionLoops: number
  /** Which Cell pool is eligible each loop. */
  subdivisionMode: SubdivisionMode
  /** UI 10–100: split intensity (10 = none, 100 = max). */
  subdivisionRate: number
}

/**
 * Cached Phase 1 Cell — geometry + stable attrs; mask/effects applied at composite time.
 * Coordinates (`x`, `y`, `width`, `height`, `sx`, `sy`) are in pixels.
 */
export type CachedCell = {
  x: number
  y: number
  width: number
  height: number
  sx: number
  sy: number
  randomVal: number
}

/**
 * Full Phase 1 floor result.
 * `baseCellSize` is resolution-dependent and required by Phase 2 noise sampling.
 */
export type CachedLayout = {
  baseCellSize: number
  cells: CachedCell[]
}
