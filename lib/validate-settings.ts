import type {
  CompositeTextureSettings,
  EffectSettings,
  SmearStyleSettings,
} from "@/lib/effect-types"
import type { SubdivisionMode } from "@/lib/layout-types"

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

function sanitizeSmear(
  value: unknown,
  fallbackEnabled = false,
  fallbackAmount = 50
): SmearStyleSettings {
  if (!value || typeof value !== "object") {
    return { enabled: fallbackEnabled, amount: fallbackAmount }
  }
  const raw = value as Record<string, unknown>
  return {
    enabled: asBool(raw.enabled, fallbackEnabled),
    amount: clampNum(raw.amount, 0, 100, fallbackAmount),
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
    weightInvert: clampNum(s.weightInvert, 0, 100, 0),
    weightSurreal: clampNum(s.weightSurreal, 0, 100, 0),
    weightPixelate: clampNum(s.weightPixelate, 0, 100, 0),
    weightOriginal: clampNum(s.weightOriginal, 0, 100, 25),
    randomSample: asBool(s.randomSample, false),
    edgeClamp: asBool(s.edgeClamp, false),
    smearVertical: sanitizeSmear(s.smearVertical),
    smearHorizontal: sanitizeSmear(s.smearHorizontal),
    smearDiagonal: sanitizeSmear(s.smearDiagonal),
    smearRecursive: sanitizeSmear(s.smearRecursive),
    verticalWeight: clampNum(s.verticalWeight, 0, 100, 80),
    horizontalWeight: clampNum(s.horizontalWeight, 0, 100, 80),
    diagonalWeight: clampNum(s.diagonalWeight, 0, 100, 80),
    recursiveWeight: clampNum(s.recursiveWeight, 0, 100, 80),
    noiseScale: clampNum(s.noiseScale, 1, 100, 19),
    noiseSpread: clampNum(s.noiseSpread, 0, 100, 50),
    maxCellSize: clampNum(s.maxCellSize, 1, 100, 20) | 0,
    subdivisionLoops: clampNum(s.subdivisionLoops, 1, 7, 4) | 0,
    subdivisionMode: asSubdivisionMode(s.subdivisionMode),
    subdivisionRate: clampNum(s.subdivisionRate, 10, 100, 60),
    passes: clampNum(s.passes, 1, 3, 1) | 0,
    rate: clampNum(s.rate, 0, 100, 50),
    showNoiseMap: asBool(s.showNoiseMap, false),
    showCellLayout: asBool(s.showCellLayout, false),
    textureEnabled: asBool(s.textureEnabled, true),
    textureOpacity: clampNum(s.textureOpacity, 0, 1, 1),
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
