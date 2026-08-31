/**
 * Hybrid Render Pipeline — spec lock.
 *
 * Color Masters are full-frame RGBA, eager-built once when the source image
 * changes (load / Bake). The render loop never lazily allocates them.
 *
 *   1. INITIALIZATION — Masters: original, invert, surreal, thermal, slitscan
 *   2. CELL ASSIGNMENT — UI weights → one EffectName per ON Cell
 *   3. PRE-SMEAR — copy from that Cell's Color Master, then smear
 *      Texture-assigned Cells sample the original (Normal) master.
 *   4. POST-SMEAR — dither / halftone / pixelate as textures on smeared pixels
 *
 * Invert / Surreal / Thermal smear already-colored master pixels.
 * Slit Scan is the one spatial master: it displaces rather than recolors, but
 * rides the same full-frame RGBA mechanism, so a Cell samples it identically.
 * Dither / Halftone / Pixelate deform Normal pixels, then apply texture.
 */

import type { EffectName, EffectSettings } from "@/lib/effect-types"

/**
 * Full-frame looks sampled before smear. All are RGBA buffers the size of the
 * frame; `slitscan` is spatial rather than color, but shares the mechanism.
 */
export type ColorMasterName =
  | "original"
  | "invert"
  | "surreal"
  | "thermal"
  | "slitscan"

/** Mathematical textures, applied after smear. */
export type TextureEffectName = "dither" | "halftone" | "pixelate"

function isColorMasterEffect(
  effect: EffectName
): effect is ColorMasterName {
  return (
    effect === "original" ||
    effect === "invert" ||
    effect === "surreal" ||
    effect === "thermal" ||
    effect === "slitscan"
  )
}

export function isTextureEffect(
  effect: EffectName
): effect is TextureEffectName {
  return (
    effect === "dither" || effect === "halftone" || effect === "pixelate"
  )
}

/**
 * Which Color Master a Cell copies from before smear.
 * Texture Cells always start from the original (Normal) master.
 */
export function colorMasterForEffect(effect: EffectName): ColorMasterName {
  if (isColorMasterEffect(effect)) return effect
  return "original"
}

/**
 * Coverage is absolute while the pooled weights sum to ≤ this.
 * Above it, weights compete relatively (same as the old exclusive buckets).
 */
const WEIGHT_BASE = 100

/**
 * Weighted assignment from the Cell's stable randomVal.
 * Weights can change without relayout.
 *
 * `effectiveTotal = max(100, sum)`: a lone Invert at 50 covers ~50% of ON Cells
 * (the rest fall through to `"original"`). When the pool exceeds 100, shares
 * stay relative.
 */
export function chooseEffect(
  randomVal: number,
  settings: EffectSettings
): EffectName {
  const wOriginal = settings.weightOriginal
  const wDither = settings.weightDither
  const wInvert = settings.weightInvert
  const wSurreal = settings.weightSurreal
  const wPixelate = settings.weightPixelate
  const wHalftone = settings.halftoneAmount
  const wThermal = settings.weightThermal
  const wSlitScan = settings.weightSlitScan
  const sumOfWeights =
    wOriginal +
    wDither +
    wInvert +
    wSurreal +
    wPixelate +
    wHalftone +
    wThermal +
    wSlitScan

  const effectiveTotal = Math.max(WEIGHT_BASE, sumOfWeights)
  const target = randomVal * effectiveTotal
  const afterOriginal = wOriginal
  const afterDither = afterOriginal + wDither
  const afterInvert = afterDither + wInvert
  const afterSurreal = afterInvert + wSurreal
  const afterPixelate = afterSurreal + wPixelate
  const afterHalftone = afterPixelate + wHalftone
  const afterThermal = afterHalftone + wThermal

  if (target < afterOriginal) return "original"
  if (target < afterDither) return "dither"
  if (target < afterInvert) return "invert"
  if (target < afterSurreal) return "surreal"
  if (target < afterPixelate) return "pixelate"
  if (target < afterHalftone) return "halftone"
  if (target < afterThermal) return "thermal"
  if (target < afterThermal + wSlitScan) return "slitscan"
  return "original"
}

/** Directional smear — mutually exclusive, at most one per Cell. */
type DirectionalSmearName =
  | "vertical"
  | "horizontal"
  | "diagonal1"
  | "diagonal2"

/** Recursive is a separate pass and may stack on a directional smear. */
export type SmearStyleName = DirectionalSmearName | "recursive"

/** Weight is 0 when the style is off or parked at amount 0 (no smear). */
function smearStyleWeight(
  style: { enabled: boolean; amount: number },
  weight: number
): number {
  return style.enabled && style.amount !== 0 ? weight : 0
}

/**
 * Weighted directional smear from the Cell's stable randomVal.
 * Recursive is not in this pool — see `chooseRecursiveSmear`.
 *
 * Same algorithm as `chooseEffect`: exclusive cumulative buckets,
 * `target = randomVal * max(100, sumOfWeights)`. Disabled styles
 * and amount 0 contribute 0. Empty pool or a hit in the padded space
 * up to 100 → null (no directional smear).
 */
export function chooseSmear(
  randomVal: number,
  settings: EffectSettings
): DirectionalSmearName | null {
  const wVertical = smearStyleWeight(
    settings.smearVertical,
    settings.verticalWeight
  )
  const wHorizontal = smearStyleWeight(
    settings.smearHorizontal,
    settings.horizontalWeight
  )
  const wDiagonal1 = smearStyleWeight(
    settings.smearDiagonal1,
    settings.diagonal1Weight
  )
  const wDiagonal2 = smearStyleWeight(
    settings.smearDiagonal2,
    settings.diagonal2Weight
  )
  const sumOfWeights = wVertical + wHorizontal + wDiagonal1 + wDiagonal2

  const effectiveTotal = Math.max(WEIGHT_BASE, sumOfWeights)
  const target = randomVal * effectiveTotal
  const afterVertical = wVertical
  const afterHorizontal = afterVertical + wHorizontal
  const afterDiagonal1 = afterHorizontal + wDiagonal1

  if (target < afterVertical) return "vertical"
  if (target < afterHorizontal) return "horizontal"
  if (target < afterDiagonal1) return "diagonal1"
  if (target < afterDiagonal1 + wDiagonal2) return "diagonal2"
  return null
}

/**
 * Independent Recursive coverage of ON Cells, vs a fixed base of 100.
 * 0 → none, 50 → half, 100 → all. Does not compete with directional weights.
 */
export function chooseRecursiveSmear(
  randomVal: number,
  settings: EffectSettings
): boolean {
  const w = smearStyleWeight(
    settings.smearRecursive,
    settings.recursiveWeight
  )
  if (w <= 0) return false
  return randomVal * WEIGHT_BASE < w
}

/** Second [0, 1) sample so Recursive coverage is not the same half as `chooseSmear`. */
export function recursiveSmearRoll(randomVal: number): number {
  const x = randomVal * 1.618033988749895 + 0.5
  return x - Math.floor(x)
}
