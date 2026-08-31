/**
 * Control defaults and the slider read helper, shared by the page (which builds
 * EffectSettings from them) and by the panels (which reset back to them).
 *
 * Deliberately separate from `sanitizeEffectSettings`: those fallbacks are the
 * worker's own and must stay independent of what the UI happens to default to.
 */

import type { SlitScanMode } from "@/lib/effect-types"

/** Reads a Slider value, which arrives as a number or a single-element array. */
export function sliderValue(value: number | readonly number[], fallback = 0) {
  const raw = Array.isArray(value) ? value[0] : value
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** Default Amount values for Smear reset buttons (UI slider only). */
export const SMEAR_AMOUNT_DEFAULTS = {
  vertical: 25,
  horizontal: 25,
  diagonal1: 25,
  diagonal2: 25,
  recursive: 25,
} as const

/** Default Weight values for Smear (base-100 coverage; 50 = half of ON Cells when alone). */
export const SMEAR_WEIGHT_DEFAULTS = {
  vertical: 50,
  horizontal: 50,
  diagonal1: 50,
  diagonal2: 50,
  recursive: 50,
} as const

/**
 * Default Slit Scan displacement. Not in CONTROL_DEFAULTS because it is not a
 * slider, same as `subdivisionMode`.
 */
export const SLIT_SCAN_MODE_DEFAULT: SlitScanMode = "noise"

/**
 * Slit Scan Mode toggle, in display order. Labels are abbreviated because the
 * three share one full-width row in a ~224px panel; the full name is the
 * accessible name and the tooltip.
 */
export const SLIT_SCAN_MODES: readonly {
  id: SlitScanMode
  label: string
  title: string
}[] = [
  { id: "horizontal", label: "Horiz", title: "Horizontal" },
  { id: "vertical", label: "Vert", title: "Vertical" },
  { id: "noise", label: "Noise", title: "Noise" },
]

/** Default values for all other control sliders. */
export const CONTROL_DEFAULTS = {
  subdivisionLoops: 4,
  subdivisionRate: 60,
  noiseScale: 19,
  noiseSpread: 50,
  weightPixelate: 0,
  weightInvert: 30,
  weightSurreal: 20,
  weightDither: 0,
  weightOriginal: 25,
  textureOpacity: 1,
  passes: 1,
  rate: 50,
  halftoneAmount: 0,
  weightThermal: 0,
  weightSlitScan: 0,
  slitScanAmount: 50,
  slitScanFrequency: 50,
} as const

/** Default global seed (matches initial page state). */
export const DEFAULT_SEED = 20599
