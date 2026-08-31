/**
 * Slit Scan — incompressible 2D curl-noise displacement, baked into a master.
 *
 * The vector field is the curl of a single scalar fBm potential ψ:
 *
 *     v = (∂ψ/∂y, −∂ψ/∂x)
 *
 * which is divergence-free by construction, so the warp swirls around vortices
 * instead of piling pixels up and tearing them apart the way two independent
 * noise passes do. Nothing is created or destroyed — it flows.
 *
 * Deliberately split in three, because the parts have different costs and
 * different invalidation rules:
 *
 *   - The **field** is a normalized [-1, 1] vector per pixel. It depends only
 *     on `SlitScanFieldKey` — note that `amount` is NOT in it. The field is the
 *     expensive half (O(width x height)), so amplitude is applied at gather
 *     time instead, and dragging Amount never rebuilds it.
 *   - The **gather** resamples an RGBA buffer through the field at a given
 *     amplitude. It re-runs whenever the pixels or the amplitude change.
 *   - The **master** is what the worker caches, keyed on the full
 *     `SlitScanParams`. That key is the invalidation seam: unrelated slider
 *     drags (smear, effect weights, mask, grain) hit it and cost nothing.
 *

 * `mode` selects the physical displacement and lives in the field key, so the
 * axis-constrained variants are built once and cached like any other field:
 *
 *   - `horizontal` / `vertical` zero one component *before* normalization, so
 *     the surviving axis is what reaches magnitude 1 and Amount still maps to
 *     the same peak displacement in pixels. These are deliberately NOT
 *     divergence-free: a field confined to one axis cannot be, and the
 *     stretching that produces is the point of the mode.
 * `luminanceMask` is a gather-time modifier, not a mode: it scales whatever
 * vector the field already holds by the pixel's brightness. Like `amount`, it
 * belongs to the master key but not the field key, so toggling it re-runs only
 * the gather.
 *
 * The potential is evaluated on a coarse grid and the curl is taken from that
 * grid by central difference — so the derivatives are free rather than costing
 * four extra noise taps per node — then bilinearly expanded. See
 * `noiseSampleStep` for how the spacing is chosen.
 */

import type { EffectSettings, SlitScanMode } from "@/lib/effect-types"
import { hash2D } from "@/lib/phase1-floor"

/** Everything the master depends on. This is the worker's invalidation seam. */
export type SlitScanParams = {
  width: number
  height: number
  seed: number
  /** UI 0–100. Scales at gather time, so it is absent from the field key. */
  amount: number
  /** UI 0–100. */
  frequency: number
  /**
   * Physical displacement shape. In the field key rather than applied at gather
   * time, because the axis modes have to be normalized on the surviving
   * component for Amount to mean the same thing in every mode.
   */
  mode: SlitScanMode
  /**
   * Scale displacement by pixel brightness. Applied at gather time exactly like
   * `amount`, so it is deliberately absent from the field key below - toggling
   * it must not rebuild the field.
   */
  luminanceMask: boolean
}

/**
 * The subset the vector field itself depends on. Both gather-time knobs
 * (`amount`, `luminanceMask`) are excluded: they scale the vectors, they do not
 * shape them.
 */
type SlitScanFieldKey = Omit<SlitScanParams, "amount" | "luminanceMask">

/** Normalized displacement vectors, interleaved as [dx0, dy0, dx1, dy1, …]. */
export type SlitScanField = {
  width: number
  height: number
  vectors: Float32Array
}

/** Offsets the potential's seed off `settings.seed` so Random reshapes the flow. */
const SLIT_SCAN_SEED_BASE = 0x5117

/**
 * Peak displacement as a fraction of frame height, at amount 100.
 *
 * Recalibrated: was 0.35, which put every usable look in the slider's bottom
 * half. At 70% of that, UI 100 lands on what UI 70 used to produce and, because
 * the mapping is linear, the whole range is rescaled by the same factor -
 * new(x) is old(0.7x) at every point.
 */
const SLIT_SCAN_MAX_AMPLITUDE_RATIO = 0.245
/** Noise cells across the width at octave 0. Mapped exponentially — see below. */
const SLIT_SCAN_MIN_FREQUENCY = 1
/**
 * Recalibrated: was 24. The old 1 -> 24 sweep spent most of the slider on
 * frequencies too fine to read, so the top of the range is now the old curve's
 * UI 40 and the same exponential is re-fitted across the full 0-100. Kept as
 * the expression rather than a rounded literal so UI 100 lands on exactly what
 * UI 40 used to produce (~3.57 cells).
 */
const SLIT_SCAN_MAX_FREQUENCY = Math.pow(24, 0.4)
const SLIT_SCAN_OCTAVES = 3
const SLIT_SCAN_LACUNARITY = 2
const SLIT_SCAN_GAIN = 0.5
/** Coarse-grid sampling budget: samples per period of the highest octave. */
const SLIT_SCAN_MIN_SAMPLES_PER_PERIOD = 4
const SLIT_SCAN_MAX_SAMPLE_STEP = 8

/** UI 0–100 → peak displacement in pixels. Linear: 100 = 24.5% of height. */
export function slitScanAmplitude(amount: number, height: number): number {
  const t = Math.max(0, Math.min(100, amount)) / 100
  return height * SLIT_SCAN_MAX_AMPLITUDE_RATIO * t
}

/**
 * UI 0–100 → noise cells across the width.
 * Exponential so the slider feels even end to end: 0 → 1, 50 → ~1.9, 100 → ~3.6.
 */
export function slitScanFrequency(frequency: number): number {
  const t = Math.max(0, Math.min(100, frequency)) / 100
  return (
    SLIT_SCAN_MIN_FREQUENCY *
    Math.pow(SLIT_SCAN_MAX_FREQUENCY / SLIT_SCAN_MIN_FREQUENCY, t)
  )
}

export function extractSlitScanParams(
  settings: EffectSettings,
  width: number,
  height: number
): SlitScanParams {
  return {
    width,
    height,
    seed: settings.seed,
    amount: settings.slitScanAmount,
    frequency: settings.slitScanFrequency,
    mode: settings.slitScanMode,
    luminanceMask: settings.slitScanLuminanceMask,
  }
}

/** The whole invalidation seam. Add a field to `SlitScanParams` and it lands here. */
export function slitScanParamsEqual(
  a: SlitScanParams,
  b: SlitScanParams
): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.seed === b.seed &&
    a.amount === b.amount &&
    a.frequency === b.frequency &&
    a.mode === b.mode &&
    a.luminanceMask === b.luminanceMask
  )
}

function fieldKeyEqual(a: SlitScanFieldKey, b: SlitScanFieldKey): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.seed === b.seed &&
    a.frequency === b.frequency &&
    a.mode === b.mode
  )
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

/** 2D value noise in [0, 1), reusing the layout hash so results stay reproducible. */
function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const a = hash2D(x0, y0, seed)
  const b = hash2D(x0 + 1, y0, seed)
  const c = hash2D(x0, y0 + 1, seed)
  const d = hash2D(x0 + 1, y0 + 1, seed)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return top + (bottom - top) * ty
}

/**
 * The scalar potential ψ: fractal Brownian motion normalized to [-1, 1].
 * Only its *gradient* is ever used, so its absolute level does not matter.
 */
function potential2D(x: number, y: number, seed: number): number {
  let sum = 0
  let norm = 0
  let amp = 1
  let fx = x
  let fy = y
  for (let o = 0; o < SLIT_SCAN_OCTAVES; o++) {
    sum += (valueNoise2D(fx, fy, seed + o) * 2 - 1) * amp
    norm += amp
    amp *= SLIT_SCAN_GAIN
    fx *= SLIT_SCAN_LACUNARITY
    fy *= SLIT_SCAN_LACUNARITY
  }
  return sum / norm
}

/**
 * Pixels between coarse-grid noise samples.
 * Derived from the highest octave's wavelength so the expanded field always
 * carries at least `SLIT_SCAN_MIN_SAMPLES_PER_PERIOD` samples per period — a
 * fixed step would alias at high Frequency and waste work at low.
 */
export function noiseSampleStep(width: number, baseFrequency: number): number {
  const highest =
    baseFrequency * Math.pow(SLIT_SCAN_LACUNARITY, SLIT_SCAN_OCTAVES - 1)
  if (highest <= 0) return SLIT_SCAN_MAX_SAMPLE_STEP
  const wavelengthPx = width / highest
  const step = Math.floor(wavelengthPx / SLIT_SCAN_MIN_SAMPLES_PER_PERIOD)
  return Math.max(1, Math.min(SLIT_SCAN_MAX_SAMPLE_STEP, step))
}

/**
 * Bilinear expansion of a coarse (gw x gh) vector grid to one vector per pixel.
 * Shared by every mode, so they all inherit the same smoothing: whatever the
 * grid holds, the frame gets a continuous field interpolated out of it.
 * Interpolation is a convex blend, so a grid inside [-1, 1] stays inside it.
 */
function expandGridBilinear(
  gridX: Float32Array,
  gridY: Float32Array,
  gw: number,
  step: number,
  width: number,
  height: number,
  vectors: Float32Array
) {
  const invStep = 1 / step
  for (let y = 0; y < height; y++) {
    const gyf = y * invStep
    const j0 = gyf | 0
    const ty = gyf - j0
    const r0 = j0 * gw
    const r1 = (j0 + 1) * gw
    for (let x = 0; x < width; x++) {
      const gxf = x * invStep
      const i0 = gxf | 0
      const tx = gxf - i0
      const i1 = i0 + 1

      const x00 = gridX[r0 + i0]!
      const x10 = gridX[r0 + i1]!
      const x01 = gridX[r1 + i0]!
      const x11 = gridX[r1 + i1]!
      const xTop = x00 + (x10 - x00) * tx
      const xBot = x01 + (x11 - x01) * tx

      const y00 = gridY[r0 + i0]!
      const y10 = gridY[r0 + i1]!
      const y01 = gridY[r1 + i0]!
      const y11 = gridY[r1 + i1]!
      const yTop = y00 + (y10 - y00) * tx
      const yBot = y01 + (y11 - y01) * tx

      const o = (y * width + x) * 2
      vectors[o] = xTop + (xBot - xTop) * ty
      vectors[o + 1] = yTop + (yBot - yTop) * ty
    }
  }
}

/**
 * Normalized displacement vectors, one per pixel, expanded from a coarse grid.
 * Content-independent: a function of the field key alone.
 */
export function buildSlitScanField(key: SlitScanFieldKey): SlitScanField {
  const w = Math.max(0, key.width)
  const h = Math.max(0, key.height)
  const vectors = new Float32Array(w * h * 2)
  if (w <= 0 || h <= 0) return { width: w, height: h, vectors }

  const baseFrequency = slitScanFrequency(key.frequency)
  const seed = (SLIT_SCAN_SEED_BASE + key.seed) | 0
  const step = noiseSampleStep(w, baseFrequency)

  // Inner grid covers the last pixel plus one node for interpolation; the
  // padded grid adds a one-node ring so the curl below is a true central
  // difference everywhere, with no one-sided seam at the frame edges.
  const gw = Math.floor((w - 1) / step) + 2
  const gh = Math.floor((h - 1) / step) + 2
  const gridX = new Float32Array(gw * gh)
  const gridY = new Float32Array(gw * gh)
  const pw = gw + 2
  const ph = gh + 2

  // Both axes divide by width so noise cells stay square on non-square frames.
  const scale = baseFrequency / w
  const potential = new Float32Array(pw * ph)
  for (let pj = 0; pj < ph; pj++) {
    const ny = (pj - 1) * step * scale
    const row = pj * pw
    for (let pi = 0; pi < pw; pi++) {
      potential[row + pi] = potential2D((pi - 1) * step * scale, ny, seed)
    }
  }

  // Curl: v = (dψ/dy, −dψ/dx), by central difference on the grid.
  // The shared 1/(2·step) factor is dropped — it cancels in the normalization.
  let maxMagnitude = 0
  for (let j = 0; j < gh; j++) {
    const pRow = (j + 1) * pw
    const pUp = j * pw
    const pDown = (j + 2) * pw
    const out = j * gw
    for (let i = 0; i < gw; i++) {
      const pi = i + 1
      const dPsiDx = potential[pRow + pi + 1]! - potential[pRow + pi - 1]!
      const dPsiDy = potential[pDown + pi]! - potential[pUp + pi]!
      // Axis constraint before the magnitude below, so normalization rescales
      // whichever component survives: "horizontal" at Amount 100 reaches the
      // same peak pixel offset "noise" does, just along one axis.
      const vx = key.mode === "vertical" ? 0 : dPsiDy
      const vy = key.mode === "horizontal" ? 0 : -dPsiDx
      gridX[out + i] = vx
      gridY[out + i] = vy
      const mag = Math.sqrt(vx * vx + vy * vy)
      if (mag > maxMagnitude) maxMagnitude = mag
    }
  }

  // Normalize so the strongest vortex reaches magnitude 1. Keeps
  // `slitScanAmount` mapping to displacement in pixels the same way it did
  // before, independent of Frequency, and holds the [-1, 1] field invariant
  // through the bilinear expansion below (interpolation is a convex blend).
  if (maxMagnitude > 0) {
    const inv = 1 / maxMagnitude
    for (let i = 0; i < gridX.length; i++) {
      gridX[i]! *= inv
      gridY[i]! *= inv
    }
  }
  expandGridBilinear(gridX, gridY, gw, step, w, h, vectors)
  return { width: w, height: h, vectors }
}

let cachedField: SlitScanField | null = null
let cachedFieldKey: SlitScanFieldKey | null = null

/**
 * Cached vector field. Keyed without `amount`, so dragging Amount re-runs only
 * the gather. Single entry: pass 0 dominates, and a Repeat pass's `seed + i`
 * miss costs one field build against the gather it is about to feed.
 */
export function getSlitScanField(key: SlitScanFieldKey): SlitScanField {
  if (cachedField && cachedFieldKey && fieldKeyEqual(cachedFieldKey, key)) {
    return cachedField
  }
  cachedField = buildSlitScanField(key)
  cachedFieldKey = {
    width: key.width,
    height: key.height,
    seed: key.seed,
    frequency: key.frequency,
    mode: key.mode,
  }
  return cachedField
}

/** Drop the cached field. Used by teardown and the verify scripts. */
export function clearSlitScanFieldCache() {
  cachedField = null
  cachedFieldKey = null
}

/**
 * Resample `sourceRgba` through the vector field, scaled by `amplitude`.
 * Both axes clamp at the frame edges rather than wrapping, so a vector pointing
 * out of bounds streaks the edge pixel instead of showing a seam or a

 * transparent hole.
 *
 * Mode-agnostic: whatever shaped the displacement was decided on the coarse
 * grid in `buildSlitScanField`. This is where the two scalars land - the
 * amplitude, and optionally the luminance mask.
 *
 * `luminanceMask` scales the vector by the brightness of the pixel being
 * written: white takes the whole displacement, black holds still, mid-tones
 * land in between. It multiplies both axes, so it dials the effect down rather
 * than redirecting it.
 */
export function gatherVectorDisplacement(
  sourceRgba: Uint8ClampedArray,
  field: SlitScanField,
  amplitude: number,
  luminanceMask = false
): Uint8ClampedArray {
  const { width, height, vectors } = field
  const out = new Uint8ClampedArray(sourceRgba.length)
  const maxX = width - 1
  const maxY = height - 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const v = (row + x) * 2
      let scale = amplitude
      if (luminanceMask) {
        const p = (row + x) * 4
        scale *=
          (sourceRgba[p]! + sourceRgba[p + 1]! + sourceRgba[p + 2]!) / (255 * 3)
      }
      // `+ 0.5 | 0` rounds. A negative result only happens where the clamp
      // below takes over anyway, so truncation toward zero is harmless.
      let sx = (x + vectors[v]! * scale + 0.5) | 0
      let sy = (y + vectors[v + 1]! * scale + 0.5) | 0
      if (sx < 0) sx = 0
      else if (sx > maxX) sx = maxX
      if (sy < 0) sy = 0
      else if (sy > maxY) sy = maxY
      const s = (sy * width + sx) * 4
      const d = (row + x) * 4
      out[d] = sourceRgba[s]!
      out[d + 1] = sourceRgba[s + 1]!
      out[d + 2] = sourceRgba[s + 2]!
      out[d + 3] = sourceRgba[s + 3]!
    }
  }
  return out
}

/** Full-frame Slit Scan Master (RGBA): cached vector field + gather. */
export function buildSlitScanMaster(
  sourceRgba: Uint8ClampedArray,
  params: SlitScanParams
): Uint8ClampedArray {
  const field = getSlitScanField({
    width: params.width,
    height: params.height,
    seed: params.seed,
    frequency: params.frequency,
    mode: params.mode,
  })
  return gatherVectorDisplacement(
    sourceRgba,
    field,
    slitScanAmplitude(params.amount, params.height),
    params.luminanceMask
  )
}
