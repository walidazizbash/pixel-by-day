import type { LayoutMode, SubdivisionMode } from "@/lib/layout-types"

export type {
  CachedCell,
  CachedLayout,
  LayoutMode,
  LayoutParams,
  SubdivisionMode,
} from "@/lib/layout-types"

export type EffectName =
  | "dither"
  | "invert"
  | "surreal"
  | "pixelate"
  | "original"

/** One smear style: independent enable + 0–100 strength (composite-time only). */
export type SmearStyleSettings = {
  enabled: boolean
  amount: number
}

/** Settings posted to the effect worker on every render job. */
export type EffectSettings = {
  seed: number
  /** UI 0–100 relative weight for dither assignment. */
  weightDither: number
  /** UI 0–100 relative weight for invert assignment. */
  weightInvert: number
  /** UI 0–100 relative weight for surreal assignment. */
  weightSurreal: number
  /** UI 0–100 relative weight for pixelate assignment. */
  weightPixelate: number
  /** UI 0–100 relative weight for original assignment. */
  weightOriginal: number
  /** When true, each Cell samples a random source region; when false, samples its own geometry. */
  randomSample: boolean
  /**
   * When true: stacking-safe snapshot smear (freeze Cell, identity sx/sy,
   * out-of-bounds samples clamp to the Cell edge).
   * When false: legacy wet-canvas cascade (live-buffer feedback + amount-driven
   * source shift).
   */
  edgeClamp: boolean
  /** Vertical overlapping-blit smear (preserves original Smear Amount look). */
  smearVertical: SmearStyleSettings
  smearHorizontal: SmearStyleSettings
  smearDiagonal: SmearStyleSettings
  smearRecursive: SmearStyleSettings
  /**
   * Independent per-cell probability (0–100) that each smear style runs.
   * Coin-flipped separately per style — does not share cell.randomVal.
   */
  verticalWeight: number
  horizontalWeight: number
  diagonalWeight: number
  recursiveWeight: number
  /** UI 1–100 noise frequency; worker maps to internal 0.01–0.5. */
  noiseScale: number
  /** UI 0–100: how much of the grid receives effects (50 = balanced). */
  noiseSpread: number
  /** UI max structural Cell size (in baseCellSize grid units). Standard mode. */
  maxCellSize: number
  /** Phase 1 layout algorithm. */
  layoutMode: LayoutMode
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
  | { type: "render"; jobId: number; settings: EffectSettings }
  | {
      type: "EXPORT"
      settings: EffectSettings
      /** Optional full-resolution source for export; preview may use a capped bitmap. */
      bitmap?: ImageBitmap
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
  | { type: "EXPORT_COMPLETE"; blob: Blob }
  | { type: "EXPORT_ERROR"; message: string }

export type CompositeWorkerInMessage =
  | {
      type: "composite"
      jobId: number
      /** Phase 2 finished frame (transferred). */
      source: ImageBitmap
      settings: CompositeTextureSettings
    }
  | {
      type: "EXPORT"
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
  | { type: "EXPORT_COMPLETE"; blob: Blob }
  | { type: "EXPORT_ERROR"; message: string }
