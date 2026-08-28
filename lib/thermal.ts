/**
 * Thermal Color Master — full-frame false-color heat (5th/95th, smoothstep,
 * 75/25 sharp+diffuse). Canvas downscale-blur is injected by the worker.
 */

const THERMAL_LUMA_MIX = 0.95
const THERMAL_SAT_MIX = 0.05
/** 5th/95th percentile auto-level. */
const THERMAL_P_LOW = 0.05
const THERMAL_P_HIGH = 0.95
/**
 * If p95−p05 is below this, expand the window around the midpoint so a flat
 * photo is not stretched from tiny luminance noise.
 */
const THERMAL_MIN_PERCENTILE_RANGE = 0.12
const THERMAL_SHARP_MIX = 0.75
const THERMAL_DIFFUSE_MIX = 0.25
/** Downscale factor for the cheap diffusion pass (25–50% of full size). */
export const THERMAL_DIFFUSE_SCALE = 0.33

const THERMAL_LUT_STOPS: ReadonlyArray<{ t: number; hex: string }> = [
  { t: 0.0, hex: "#141F4A" },
  { t: 0.14, hex: "#226FB7" },
  { t: 0.28, hex: "#3DD3E0" },
  { t: 0.43, hex: "#62C9E8" },
  { t: 0.56, hex: "#776FE7" },
  { t: 0.69, hex: "#B85BDD" },
  { t: 0.79, hex: "#E85BC7" },
  { t: 0.88, hex: "#FF7A8F" },
  { t: 0.96, hex: "#FFB74D" },
  { t: 1.0, hex: "#FFF6C5" },
]

type LutStop = { t: number; r: number; g: number; b: number }

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** 256 RGB triplets (r,g,b,r,g,b,…) cached for the worker lifetime. */
function buildThermalLut(
  stops: ReadonlyArray<{ t: number; hex: string }> = THERMAL_LUT_STOPS
): Uint8ClampedArray {
  const parsed: LutStop[] = stops.map(({ t, hex }) => ({ t, ...hexToRgb(hex) }))
  const lut = new Uint8ClampedArray(256 * 3)
  const last = parsed[parsed.length - 1]!
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let a = parsed[0]!
    let b = last
    for (let s = 0; s < parsed.length - 1; s++) {
      if (t >= parsed[s]!.t && t <= parsed[s + 1]!.t) {
        a = parsed[s]!
        b = parsed[s + 1]!
        break
      }
    }
    const span = b.t - a.t
    const u = span <= 0 ? 0 : (t - a.t) / span
    const o = i * 3
    lut[o] = a.r + (b.r - a.r) * u
    lut[o + 1] = a.g + (b.g - a.g) * u
    lut[o + 2] = a.b + (b.b - a.b) * u
  }
  return lut
}

const THERMAL_LUT = buildThermalLut()

function computeHeatField(
  sourceRgba: Uint8ClampedArray,
  pixelCount: number
): Float32Array {
  const heat = new Float32Array(pixelCount)
  const inv255 = 1 / 255
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    const r = sourceRgba[p]! * inv255
    const g = sourceRgba[p + 1]! * inv255
    const b = sourceRgba[p + 2]! * inv255
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const maxC = r > g ? (r > b ? r : b) : g > b ? g : b
    const minC = r < g ? (r < b ? r : b) : g < b ? g : b
    const sat = maxC <= 0 ? 0 : (maxC - minC) / maxC
    const h = luma * THERMAL_LUMA_MIX + sat * THERMAL_SAT_MIX
    heat[i] = h < 0 ? 0 : h > 1 ? 1 : h
  }
  return heat
}

function percentileFromHistogram(
  counts: Uint32Array,
  total: number,
  p: number
): number {
  if (total <= 0) return p
  const target = p * total
  let acc = 0
  for (let i = 0; i < 256; i++) {
    acc += counts[i]!
    if (acc >= target) return i / 255
  }
  return 1
}

/** 5th/95th percentile remap + minimum-range safeguard + smoothstep. */
function autoLevelAndShape(heat: Float32Array): Float32Array {
  const counts = new Uint32Array(256)
  for (let i = 0; i < heat.length; i++) {
    const bin = (heat[i]! * 255) | 0
    counts[bin < 0 ? 0 : bin > 255 ? 255 : bin]!++
  }
  let lo = percentileFromHistogram(counts, heat.length, THERMAL_P_LOW)
  let hi = percentileFromHistogram(counts, heat.length, THERMAL_P_HIGH)
  if (hi - lo < THERMAL_MIN_PERCENTILE_RANGE) {
    const mid = (lo + hi) * 0.5
    const half = THERMAL_MIN_PERCENTILE_RANGE * 0.5
    lo = mid - half
    hi = mid + half
    if (lo < 0) {
      hi -= lo
      lo = 0
    }
    if (hi > 1) {
      lo -= hi - 1
      hi = 1
      if (lo < 0) lo = 0
    }
  }
  const span = hi - lo || 1
  const shaped = new Float32Array(heat.length)
  for (let i = 0; i < heat.length; i++) {
    let v = (heat[i]! - lo) / span
    if (v < 0) v = 0
    else if (v > 1) v = 1
    shaped[i] = v * v * (3 - 2 * v)
  }
  return shaped
}

function applyThermalLut(
  heat: Float32Array,
  outRgba: Uint8ClampedArray
) {
  for (let i = 0, p = 0; i < heat.length; i++, p += 4) {
    let idx = (heat[i]! * 255) | 0
    if (idx < 0) idx = 0
    else if (idx > 255) idx = 255
    const o = idx * 3
    outRgba[p] = THERMAL_LUT[o]!
    outRgba[p + 1] = THERMAL_LUT[o + 1]!
    outRgba[p + 2] = THERMAL_LUT[o + 2]!
    outRgba[p + 3] = 255
  }
}

export type HeatBlurFn = (
  sharp: Float32Array,
  width: number,
  height: number
) => Float32Array

/**
 * Full-frame Thermal Master (RGBA). `blurHeat` is the cheap downscale/upscale
 * diffusion pass supplied by the effect worker.
 */
export function buildThermalMaster(
  sourceRgba: Uint8ClampedArray,
  width: number,
  height: number,
  blurHeat: HeatBlurFn
): Uint8ClampedArray {
  const pixelCount = width * height
  const sharp = autoLevelAndShape(computeHeatField(sourceRgba, pixelCount))
  const blurred = blurHeat(sharp, width, height)
  const mixed = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    mixed[i] =
      sharp[i]! * THERMAL_SHARP_MIX + blurred[i]! * THERMAL_DIFFUSE_MIX
  }
  const master = new Uint8ClampedArray(pixelCount * 4)
  applyThermalLut(mixed, master)
  return master
}
