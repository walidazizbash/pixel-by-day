import type { SubdivisionMode } from "@/lib/layout-types"
import type { SpeedRampPoint } from "@/lib/speed-ramp"

export type {
  CachedCell,
  CachedLayout,
  LayoutParams,
  SubdivisionMode,
} from "@/lib/layout-types"
export type { SpeedRampPoint } from "@/lib/speed-ramp"

/**
 * Cell assignment names. Color vs texture routing lives in `lib/pipeline.ts`.
 * Color Masters (pre-smear): original, invert, surreal, thermal, slitscan.
 * `slitscan` is spatial rather than color, but shares the master mechanism.
 * Textures (post-smear): dither, halftone, pixelate.
 */
export type EffectName =
  | "dither"
  | "invert"
  | "surreal"
  | "pixelate"
  | "halftone"
  | "thermal"
  | "slitscan"
  | "original"

/**
 * Physical shape of the Slit Scan displacement.
 *
 *   horizontal  curl field with dy forced to 0 - pixels stretch left/right
 *   vertical    curl field with dx forced to 0 - pixels stretch up/down
 *   noise       the full 2D curl field (original behavior)
 *
 * Part of `SlitScanParams`, so it sits on the master's invalidation seam.
 * Brightness is no longer a mode of its own - see `slitScanLuminanceMask`,
 * which scales any of these by pixel luminance.
 */
export type SlitScanMode = "horizontal" | "vertical" | "noise"

/** One smear style: independent enable + signed amount (H/V/D −100…100, recursive 0–100). */
export type SmearStyleSettings = {
  enabled: boolean
  amount: number
}

/** Settings posted to the effect worker on every render job. */
export type EffectSettings = {
  seed: number
  /** UI 0–100 weight for dither assignment (base-100 coverage; remainder is original). */
  weightDither: number
  /** UI 0–100 weight for invert assignment (base-100 coverage; remainder is original). */
  weightInvert: number
  /** UI 0–100 weight for surreal assignment (base-100 coverage; remainder is original). */
  weightSurreal: number
  /** UI 0–100 weight for pixelate assignment (base-100 coverage; remainder is original). */
  weightPixelate: number
  /** UI 0–100 weight for original assignment (base-100 coverage). */
  weightOriginal: number
  /** When true, each Cell samples a random source region; when false, samples its own geometry. */
  randomSample: boolean
  /** Vertical overlapping-blit smear (preserves original Smear Amount look). */
  smearVertical: SmearStyleSettings
  smearHorizontal: SmearStyleSettings
  smearDiagonal1: SmearStyleSettings
  smearDiagonal2: SmearStyleSettings
  smearRecursive: SmearStyleSettings
  /**
   * 0–100 smear coverage among enabled directional styles (`chooseSmear`).
   * Sum ≤ 100: each weight is an absolute share of ON Cells; the remainder
   * is unsmeared. Sum > 100: weights compete relatively.
   */
  verticalWeight: number
  horizontalWeight: number
  diagonal1Weight: number
  diagonal2Weight: number
  /**
   * 0–100 Recursive coverage of ON Cells, independent of directional weights.
   * 0 = none, 50 = half, 100 = all. Stacks on top of any directional smear.
   */
  recursiveWeight: number
  /** UI 1–100 noise frequency; worker maps to internal 0.01–0.5. */
  noiseScale: number
  /** UI 0–100: how much of the grid receives effects (50 = balanced). */
  noiseSpread: number

  /** Subdivision pass count (1–7). */
  subdivisionLoops: number
  /** Frontier = only newly split Cells; global = all Cells each loop. */
  subdivisionMode: SubdivisionMode
  /** UI 10–100: split intensity (10 = none, 100 = max). */
  subdivisionRate: number
  /**
   * Recursive Phase 1+2 solver passes (1–3).
   * Each pass feeds its output back as the next pass's source.
   * Phase 3 texture is applied once after all passes complete.
   */
  passes: number
  /**
   * Per-pass smear intensity decay (0–100).
   * Effective multiplier on pass i is (rate/100)^i — pass 0 is always full strength.
   */
  rate: number
  /** Debug: render Phase 2 boolean mask (white = ON, black = OFF). */
  showNoiseMap: boolean
  /** Debug: render the Phase 1 square floor as distinct colored Cells on black. */
  showCellLayout: boolean
  /** Phase 3: apply 35mm grain over the finished frame. */
  textureEnabled: boolean
  /** Phase 3: grain blend strength (0–1). */
  textureOpacity: number
  /** UI 0–100 weight for halftone assignment (base-100 coverage; remainder is original). */
  halftoneAmount: number
  /** UI 0–100 weight for thermal assignment (base-100 coverage; remainder is original). */
  weightThermal: number
  /** UI 0–100 weight for slit-scan assignment (base-100 coverage; remainder is original). */
  weightSlitScan: number

  /** UI 0–100 slit-scan displacement strength; worker maps to 0–24.5% of frame height. */
  slitScanAmount: number
  /** UI 0–100 slit-scan noise frequency; worker maps exponentially to 1–3.6 cells. */
  slitScanFrequency: number
  /** Which physical displacement the Slit Scan master applies. */
  slitScanMode: SlitScanMode
  /**
   * Scale the Slit Scan displacement by each pixel's brightness: white moves
   * the full vector, black holds still, mid-tones land in between. A modifier
   * on whichever `slitScanMode` is active, not a mode of its own.
   */
  slitScanLuminanceMask: boolean
}

/** Settings subset consumed by the Phase 3 composite worker. */
export type CompositeTextureSettings = {
  textureEnabled: boolean
  /** 0–1 blend strength. */
  textureOpacity: number
}

export type EffectWorkerInMessage =
  | { type: "setSource"; bitmap: ImageBitmap }
  | { type: "clearSource" }
  | {
      type: "render"
      jobId: number
      settings: EffectSettings
      /**
       * Live Play travel for this frame, in pixels of downward motion inside
       * each Cell. Absent / 0 is the static frame.
       * Deliberately not part of `EffectSettings`: it changes every frame and
       * must never touch `LayoutParams` or `SlitScanParams`.
       */
      offsetY?: number
      /**
       * Per-Cell multiplier curve on `offsetY` — see `lib/speed-ramp.ts`. Each
       * Cell's fixed position along the ramp's X axis picks its Y multiplier,
       * evaluated by `evaluateSpeedRamp` in the effect worker. Absent / invalid
       * falls back to `DEFAULT_SPEED_RAMP` via `sanitizeSpeedRamp` (a linear
       * 0×→1× curve, not a flat 1×). Sibling of
       * `offsetY`, not `EffectSettings`, for the same reason: it only has an
       * effect once `offsetY` is nonzero, so it must never invalidate a static
       * render.
       */
      speedRamp?: SpeedRampPoint[]
    }

export type EffectWorkerOutMessage =
  | {
      type: "result"
      jobId: number
      width: number
      height: number
      bitmap: ImageBitmap
    }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string }

export type CompositeWorkerInMessage =
  | {
      type: "composite"
      jobId: number
      /** Phase 2 finished frame (transferred). */
      source: ImageBitmap
      settings: CompositeTextureSettings
    }

export type CompositeWorkerOutMessage =
  | {
      type: "result"
      jobId: number
      width: number
      height: number
      bitmap: ImageBitmap
    }
  | { type: "cancelled"; jobId: number }
  | { type: "error"; jobId: number; message: string }
