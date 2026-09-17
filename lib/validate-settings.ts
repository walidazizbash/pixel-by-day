import type {
  CompositeTextureSettings,
  EffectSettings,
  SlitScanMode,
  SmearStyleSettings,
} from "@/lib/effect-types"
import type { SubdivisionMode } from "@/lib/layout-types"
import {
  DEFAULT_SPEED_RAMP,
  SPEED_RAMP_X_MAX,
  SPEED_RAMP_X_MIN,
  SPEED_RAMP_Y_MAX,
  SPEED_RAMP_Y_MIN,
  type SpeedRampPoint,
} from "@/lib/speed-ramp"
import {
  DEFAULT_DITHER_RAMP,
  DEFAULT_HALFTONE_RAMP,
  DEFAULT_INVERT_RAMP,
  DITHER_RAMP_Y_MAX,
  DITHER_RAMP_Y_MIN,
  INVERT_RAMP_Y_MAX,
  INVERT_RAMP_Y_MIN,
} from "@/lib/dither-ramp"
import {
  DEFAULT_DIRECTION_WEIGHTS,
  type DirectionWeights,
} from "@/lib/direction-weights"

function clampNum(
  value: unknown,
  lo: number,
  hi: number,
  fallback: number
): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asSubdivisionMode(value: unknown): SubdivisionMode {
  return value === "frontier" || value === "global" ? value : "frontier"
}

function asSlitScanMode(value: unknown): SlitScanMode {
  switch (value) {
    case "horizontal":
    case "vertical":
    case "noise":
      return value
    default:
      return "noise"
  }
}

function sanitizeSmear(
  value: unknown,
  fallbackEnabled = false,
  fallbackAmount = 0,
  minAmount = -100,
  maxAmount = 100
): SmearStyleSettings {
  if (!value || typeof value !== "object") {
    return { enabled: fallbackEnabled, amount: fallbackAmount }
  }
  const raw = value as Record<string, unknown>
  return {
    enabled: asBool(raw.enabled, fallbackEnabled),
    amount: clampNum(raw.amount, minAmount, maxAmount, fallbackAmount),
  }
}

/**
 * Normalize untrusted worker payload into a safe EffectSettings object.
 * Returns null when the payload is not an object at all.
 */
export function sanitizeEffectSettings(raw: unknown): EffectSettings | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>

  return {
    seed: clampNum(s.seed, 0, 99999, 0) | 0,
    weightDither: clampNum(s.weightDither, 0, 100, 0),
    ditherRamp: sanitizeDitherRamp(s.ditherRamp),
    ditherInvertRamp: sanitizeInvertRamp(s.ditherInvertRamp),
    weightInvert: clampNum(s.weightInvert, 0, 100, 0),
    weightSurreal: clampNum(s.weightSurreal, 0, 100, 0),
    weightPixelate: clampNum(s.weightPixelate, 0, 100, 0),
    weightOriginal: clampNum(s.weightOriginal, 0, 100, 25),
    randomSample: asBool(s.randomSample, false),
    smearVertical: sanitizeSmear(s.smearVertical, false, 25, -100, 100),
    smearHorizontal: sanitizeSmear(s.smearHorizontal, true, 25, -100, 100),
    smearDiagonal1: sanitizeSmear(s.smearDiagonal1, false, 25, -100, 100),
    smearDiagonal2: sanitizeSmear(s.smearDiagonal2, false, 25, -100, 100),
    smearRecursive: sanitizeSmear(s.smearRecursive, false, 25, 0, 100),
    verticalWeight: clampNum(s.verticalWeight, 0, 100, 50),
    horizontalWeight: clampNum(s.horizontalWeight, 0, 100, 50),
    diagonal1Weight: clampNum(s.diagonal1Weight, 0, 100, 50),
    diagonal2Weight: clampNum(s.diagonal2Weight, 0, 100, 50),
    recursiveWeight: clampNum(s.recursiveWeight, 0, 100, 50),
    noiseScale: clampNum(s.noiseScale, 1, 100, 19),
    noiseSpread: clampNum(s.noiseSpread, 0, 100, 50),

    subdivisionLoops: clampNum(s.subdivisionLoops, 1, 7, 4) | 0,
    subdivisionMode: asSubdivisionMode(s.subdivisionMode),
    subdivisionRate: clampNum(s.subdivisionRate, 10, 100, 60),
    passes: clampNum(s.passes, 1, 3, 1) | 0,
    rate: clampNum(s.rate, 0, 100, 50),
    showNoiseMap: asBool(s.showNoiseMap, false),
    showCellLayout: asBool(s.showCellLayout, false),
    textureEnabled: asBool(s.textureEnabled, true),
    textureOpacity: clampNum(s.textureOpacity, 0, 1, 1),
    halftoneAmount: clampNum(s.halftoneAmount, 0, 100, 0),
    halftoneRamp: sanitizeHalftoneRamp(s.halftoneRamp),
    halftoneInvertRamp: sanitizeInvertRamp(s.halftoneInvertRamp),
    weightThermal: clampNum(s.weightThermal, 0, 100, 0),
    weightSlitScan: clampNum(s.weightSlitScan, 0, 100, 0),
    slitScanAmount: clampNum(s.slitScanAmount, 0, 100, 50),
    slitScanFrequency: clampNum(s.slitScanFrequency, 0, 100, 50),
    slitScanMode: asSlitScanMode(s.slitScanMode),
    slitScanLuminanceMask: asBool(s.slitScanLuminanceMask, false),
  }
}

/**
 * Normalize an untrusted `speedRamp` payload (sibling of `offsetY` on the render
 * message, never part of `EffectSettings` — see `lib/speed-ramp.ts`). Anything
 * that isn't at least two finite, in-range points falls back to
 * `DEFAULT_SPEED_RAMP` (a linear 0×→1× curve), same as a missing/invalid
 * `offsetY` falls back to 0.
 */
function sanitizeRampPoints(
  raw: unknown,
  yMin: number,
  yMax: number,
  fallback: readonly SpeedRampPoint[]
): SpeedRampPoint[] {
  if (!Array.isArray(raw)) return [...fallback]

  const points: SpeedRampPoint[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const p = entry as Record<string, unknown>
    const x = typeof p.x === "number" ? p.x : Number(p.x)
    const y = typeof p.y === "number" ? p.y : Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push({
      x: clampNum(x, SPEED_RAMP_X_MIN, SPEED_RAMP_X_MAX, SPEED_RAMP_X_MIN),
      y: clampNum(y, yMin, yMax, yMin),
    })
  }
  if (points.length < 2) return [...fallback]

  points.sort((a, b) => a.x - b.x)
  return points
}

export function sanitizeSpeedRamp(raw: unknown): SpeedRampPoint[] {
  return sanitizeRampPoints(
    raw,
    SPEED_RAMP_Y_MIN,
    SPEED_RAMP_Y_MAX,
    DEFAULT_SPEED_RAMP
  )
}

/**
 * Normalize an untrusted `ditherRamp` on `EffectSettings`. Y is [0, 1]
 * (Bayer scale bins), not the Live Play 0–2× range.
 */
export function sanitizeDitherRamp(raw: unknown): SpeedRampPoint[] {
  return sanitizeRampPoints(
    raw,
    DITHER_RAMP_Y_MIN,
    DITHER_RAMP_Y_MAX,
    DEFAULT_DITHER_RAMP
  )
}

export function sanitizeHalftoneRamp(raw: unknown): SpeedRampPoint[] {
  return sanitizeRampPoints(
    raw,
    DITHER_RAMP_Y_MIN,
    DITHER_RAMP_Y_MAX,
    DEFAULT_HALFTONE_RAMP
  )
}

export function sanitizeInvertRamp(raw: unknown): SpeedRampPoint[] {
  return sanitizeRampPoints(
    raw,
    INVERT_RAMP_Y_MIN,
    INVERT_RAMP_Y_MAX,
    DEFAULT_INVERT_RAMP
  )
}

/**
 * Normalize an untrusted `directionWeights` payload (sibling of `offsetY` /
 * `speedRamp` on the render message, never part of `EffectSettings` — see
 * `lib/direction-weights.ts`). Each axis clamps independently and falls back
 * to `DEFAULT_DIRECTION_WEIGHTS`'s own value, same as a missing/invalid
 * `offsetY` falls back to 0.
 */
export function sanitizeDirectionWeights(raw: unknown): DirectionWeights {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DIRECTION_WEIGHTS }
  const s = raw as Record<string, unknown>
  return {
    up: clampNum(s.up, 0, 100, DEFAULT_DIRECTION_WEIGHTS.up),
    down: clampNum(s.down, 0, 100, DEFAULT_DIRECTION_WEIGHTS.down),
    left: clampNum(s.left, 0, 100, DEFAULT_DIRECTION_WEIGHTS.left),
    right: clampNum(s.right, 0, 100, DEFAULT_DIRECTION_WEIGHTS.right),
  }
}

/**
 * Normalize Phase 3 texture settings. Returns null when payload is invalid.
 */
export function sanitizeCompositeTextureSettings(
  raw: unknown
): CompositeTextureSettings | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>
  return {
    textureEnabled: asBool(s.textureEnabled, false),
    textureOpacity: clampNum(s.textureOpacity, 0, 1, 1),
  }
}
