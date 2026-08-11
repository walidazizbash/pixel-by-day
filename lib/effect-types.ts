import type { LayoutMode, SubdivisionMode } from "@/lib/layout-types"

export type {
  CachedLayout,
  CachedPixel,
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
  sampleInPlace: boolean
  /** Vertical overlapping-blit smear (preserves original Smear Amount look). */
  smearVertical: SmearStyleSettings
  smearHorizontal: SmearStyleSettings
  smearDiagonal: SmearStyleSettings
  smearDrift: SmearStyleSettings
  smearRecursive: SmearStyleSettings
  smearStrip: SmearStyleSettings
  /** UI 1–100 noise frequency; worker maps to internal 0.01–0.5. */
  noiseScale: number
  /** UI 0–100: how much of the grid receives effects (50 = balanced). */
  noiseSpread: number
  /** UI max structural App Pixel size (in basePixelScale grid units). Standard mode. */
  maxPixelSize: number
  /** Phase 1 layout algorithm. */
  layoutMode: LayoutMode
  /** Subdivision pass count (1–7). */
  subdivisionLoops: number
  /** Frontier = only newly split Pixels; global = all Pixels each loop. */
  subdivisionMode: SubdivisionMode
  /** UI 10–100: split intensity (10 = none, 100 = max). */
  subdivisionRate: number
  /** Debug: render Phase 2 boolean mask (white = ON, black = OFF). */
  showNoiseMap: boolean
  /** Debug: render the Phase 1 square floor as distinct colored App Pixels on black. */
  showPixelLayout: boolean
  /** Debug: when a debug view is active, composite it over the finished effects at low opacity. */
  overlayDebug: boolean
}

export type EffectWorkerInMessage =
  | { type: "setSource"; bitmap: ImageBitmap }
  | { type: "clearSource" }
  | { type: "render"; jobId: number; settings: EffectSettings }
  | { type: "EXPORT"; settings: EffectSettings }

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
