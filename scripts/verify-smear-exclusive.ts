/**
 * Verify directional smears are mutually exclusive per Cell (chooseSmear),
 * and Recursive is an independent stacking pass (chooseRecursiveSmear).
 * Run: npm run verify:smear
 */

import type { CachedCell, EffectSettings } from "../lib/effect-types"
import {
  chooseEffect,
  chooseRecursiveSmear,
  chooseSmear,
} from "../lib/pipeline"
import { applySmearStyles } from "../lib/smear-styles"
import {
  clearSlitScanFieldCache,
  extractSlitScanParams,
  gatherVectorDisplacement,
  getSlitScanField,
  noiseSampleStep,
  slitScanAmplitude,
  slitScanFrequency,
  slitScanParamsEqual,
  type SlitScanField,
  type SlitScanParams,
} from "../lib/slit-scan"

const W = 200
const H = 200
const cell: CachedCell = {
  x: 40,
  y: 40,
  width: 80,
  height: 80,
  sx: 40,
  sy: 40,
  randomVal: 0.5,
}

function makeSettings(overrides: Partial<EffectSettings> = {}): EffectSettings {
  const off = { enabled: false, amount: 50 }
  return {
    seed: 42,
    weightDither: 0,
    weightInvert: 0,
    weightSurreal: 0,
    weightPixelate: 0,
    weightOriginal: 100,
    randomSample: false,
    smearVertical: off,
    smearHorizontal: off,
    smearDiagonal1: off,
    smearDiagonal2: off,
    smearRecursive: off,
    verticalWeight: 100,
    horizontalWeight: 100,
    diagonal1Weight: 100,
    diagonal2Weight: 100,
    recursiveWeight: 100,
    noiseScale: 19,
    noiseSpread: 50,

    subdivisionLoops: 3,
    subdivisionMode: "frontier",
    subdivisionRate: 60,
    passes: 1,
    rate: 50,
    showNoiseMap: false,
    showCellLayout: false,
    textureEnabled: false,
    textureOpacity: 1,
    halftoneAmount: 0,
    weightThermal: 0,
    weightSlitScan: 0,
    slitScanAmount: 50,
    slitScanFrequency: 50,
    slitScanMode: "noise",
    slitScanLuminanceMask: false,
    ...overrides,
  }
}

function paint(data: Uint8ClampedArray) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      data[i] = 10
      data[i + 1] = 20
      data[i + 2] = 200
      data[i + 3] = 255
    }
  }
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const i = ((cell.y + y) * W + (cell.x + x)) * 4
      data[i] = 180 + ((x * 3 + y) % 60)
      data[i + 1] = 20 + ((x * 5) % 40)
      data[i + 2] = 30 + ((y * 7) % 50)
      data[i + 3] = 255
    }
  }
}

function fingerprint(data: Uint8ClampedArray) {
  let h = 0
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const i = ((cell.y + y) * W + (cell.x + x)) * 4
      h = (h * 33 + data[i]! + data[i + 1]! * 3 + data[i + 2]! * 7) | 0
    }
  }
  return h
}

let fails = 0
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.log("FAIL", message)
    fails++
  } else {
    console.log("OK  ", message)
  }
}

function apply(data: Uint8ClampedArray, overrides: Partial<EffectSettings>) {
  applySmearStyles(data, W, H, cell, makeSettings(overrides))
}

assert(
  chooseSmear(0.5, makeSettings()) === null,
  "all styles disabled → None"
)
assert(
  chooseSmear(
    0.5,
    makeSettings({
      smearVertical: { enabled: true, amount: 60 },
      smearHorizontal: { enabled: true, amount: 60 },
      verticalWeight: 0,
      horizontalWeight: 0,
      diagonal1Weight: 0,
      diagonal2Weight: 0,
      recursiveWeight: 0,
    })
  ) === null,
  "all smear weights 0 → None"
)

const bothVH = makeSettings({
  smearVertical: { enabled: true, amount: 60 },
  smearHorizontal: { enabled: true, amount: 60 },
})
assert(chooseSmear(0, bothVH) === "vertical", "randomVal 0 picks first active style")
assert(
  chooseSmear(0.5, bothVH) === "horizontal",
  "equal V/H weights: randomVal 0.5 picks Horizontal"
)
assert(
  chooseSmear(
    0.5,
    makeSettings({
      smearHorizontal: { enabled: false, amount: 60 },
      smearVertical: { enabled: true, amount: 60 },
      horizontalWeight: 100,
      verticalWeight: 100,
    })
  ) === "vertical",
  "disabled Horizontal is excluded even at weight 100"
)
assert(
  chooseSmear(
    0,
    makeSettings({
      smearHorizontal: { enabled: true, amount: 0 },
      horizontalWeight: 100,
    })
  ) === null,
  "enabled Horizontal at amount 0 is treated as off"
)
assert(
  chooseSmear(
    0.5,
    makeSettings({
      smearHorizontal: { enabled: true, amount: 0 },
      smearVertical: { enabled: true, amount: 60 },
      horizontalWeight: 100,
      verticalWeight: 100,
    })
  ) === "vertical",
  "amount 0 Horizontal does not steal from Vertical"
)

const N = 10000
let vCount = 0
let hCount = 0
let other = 0
const even = makeSettings({
  smearVertical: { enabled: true, amount: 60 },
  smearHorizontal: { enabled: true, amount: 60 },
  verticalWeight: 50,
  horizontalWeight: 50,
})
for (let i = 0; i < N; i++) {
  const picked = chooseSmear(i / N, even)
  if (picked === "vertical") vCount++
  else if (picked === "horizontal") hCount++
  else other++
}
assert(other === 0, "no None when two styles fill the 100 base")
assert(
  Math.abs(vCount - hCount) <= N * 0.02,
  `equal weights split ~50/50 (V=${vCount} H=${hCount})`
)

const solo50 = makeSettings({
  smearHorizontal: { enabled: true, amount: 60 },
  horizontalWeight: 50,
})
assert(
  chooseSmear(0.49, solo50) === "horizontal",
  "solo weight 50: randomVal 0.49 is Horizontal"
)
assert(
  chooseSmear(0.5, solo50) === null,
  "solo weight 50: randomVal 0.5 falls through to None (base-100 padding)"
)

const solo1 = makeSettings({
  smearVertical: { enabled: true, amount: 60 },
  verticalWeight: 1,
})
assert(chooseSmear(0, solo1) === "vertical", "solo weight 1 still fires at randomVal 0")
assert(
  chooseSmear(0.5, solo1) === null,
  "solo weight 1 does not cover 100% of Cells"
)

const invertOnly = makeSettings({
  weightOriginal: 0,
  weightInvert: 50,
})
assert(
  chooseEffect(0.49, invertOnly) === "invert",
  "solo Invert 50: randomVal 0.49 is Invert"
)
assert(
  chooseEffect(0.5, invertOnly) === "original",
  "solo Invert 50: randomVal 0.5 falls through to Original (base-100 padding)"
)
assert(
  chooseEffect(
    0.5,
    makeSettings({
      weightOriginal: 0,
      weightDither: 0,
      weightInvert: 0,
      weightSurreal: 0,
      weightPixelate: 0,
      halftoneAmount: 0,
      weightThermal: 0,
      weightSlitScan: 0,
    })
  ) === "original",
  "all effect weights 0 → Original"
)

/* ── Slit Scan: pool membership + the field/gather split ─────────────────── */

const slitScanOnly = makeSettings({
  weightOriginal: 0,
  weightSlitScan: 50,
})
assert(
  chooseEffect(0.49, slitScanOnly) === "slitscan",
  "solo Slit Scan 50: randomVal 0.49 is Slit Scan"
)
assert(
  chooseEffect(0.5, slitScanOnly) === "original",
  "solo Slit Scan 50: randomVal 0.5 falls through to Original (base-100 padding)"
)

// Zero weight must not shift any other effect's bucket — this is what keeps
// saved settings and History snapshots rendering identically after the add.
assert(
  chooseEffect(0.49, makeSettings({ weightOriginal: 0, weightInvert: 50 })) ===
    "invert" &&
    chooseEffect(
      0.49,
      makeSettings({ weightOriginal: 0, weightInvert: 50, weightSlitScan: 0 })
    ) === "invert",
  "Slit Scan at 0 leaves existing effect buckets untouched"
)

// Above base-100 the pool competes relatively, and one Cell still gets exactly
// one effect — Slit Scan is not additive on top of Invert.
const invertVsSlitScan = makeSettings({
  weightOriginal: 0,
  weightInvert: 100,
  weightSlitScan: 100,
})
assert(
  chooseEffect(0.49, invertVsSlitScan) === "invert",
  "Invert 100 + Slit Scan 100: randomVal 0.49 is Invert"
)
assert(
  chooseEffect(0.5, invertVsSlitScan) === "slitscan",
  "Invert 100 + Slit Scan 100: randomVal 0.5 is Slit Scan (exclusive, 50/50 split)"
)

clearSlitScanFieldCache()
const baseParams = extractSlitScanParams(makeSettings(), W, H)

/** The field key is `SlitScanParams` minus `amount` — built explicitly so the
 *  excess-property check does not hide a genuine key mismatch. */
function fieldKey(p: SlitScanParams) {
  return {
    width: p.width,
    height: p.height,
    seed: p.seed,
    frequency: p.frequency,
    mode: p.mode,
  }
}

const field = getSlitScanField(fieldKey(baseParams))
assert(
  field.vectors.length === W * H * 2,
  "vector field carries an (x, y) pair for every pixel"
)

/* ── 2D: both axes driven, and the flow is incompressible ───────────────── */
let maxAbsX = 0
let maxAbsY = 0
let maxMagnitude = 0
for (let i = 0; i < W * H; i++) {
  const dx = field.vectors[i * 2]!
  const dy = field.vectors[i * 2 + 1]!
  if (Math.abs(dx) > maxAbsX) maxAbsX = Math.abs(dx)
  if (Math.abs(dy) > maxAbsY) maxAbsY = Math.abs(dy)
  const mag = Math.sqrt(dx * dx + dy * dy)
  if (mag > maxMagnitude) maxMagnitude = mag
}
assert(maxAbsX > 0.05, "field drives X displacement (no longer vertical-only)")
assert(maxAbsY > 0.05, "field drives Y displacement")
assert(
  maxAbsX <= 1.0001 && maxAbsY <= 1.0001,
  "field stays normalized to [-1, 1] (amplitude is applied at gather time)"
)
assert(
  Math.abs(maxMagnitude - 1) < 1e-3,
  "strongest vortex normalizes to magnitude 1 (anchors slitScanAmount)"
)

/**
 * Curl noise is divergence-free by construction — the defining property, and
 * what stops the warp from piling pixels up and tearing them apart. Measures
 * mean|dvx/dx + dvy/dy| against mean(|dvx/dx| + |dvy/dy|): the terms must
 * cancel. Stencil spacing matches the grid the curl was differenced on.
 */
function divergenceRatio(f: SlitScanField, s: number) {
  let sumDiv = 0
  let sumTerms = 0
  const at = (x: number, y: number, axis: 0 | 1) =>
    f.vectors[(y * f.width + x) * 2 + axis]!
  for (let y = s; y < f.height - s; y += 2) {
    for (let x = s; x < f.width - s; x += 2) {
      const dvx = at(x + s, y, 0) - at(x - s, y, 0)
      const dvy = at(x, y + s, 1) - at(x, y - s, 1)
      sumDiv += Math.abs(dvx + dvy)
      sumTerms += Math.abs(dvx) + Math.abs(dvy)
    }
  }
  return sumDiv / (sumTerms || 1)
}
/** Radial source: maximally compressible, so the metric above must flag it. */
function radialControlField(): SlitScanField {
  const vectors = new Float32Array(W * H * 2)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 2
      vectors[o] = (x - W / 2) / (W / 2)
      vectors[o + 1] = (y - H / 2) / (H / 2)
    }
  }
  return { width: W, height: H, vectors }
}
const curlStep = noiseSampleStep(W, slitScanFrequency(baseParams.frequency))
assert(
  divergenceRatio(field, curlStep) < 0.05,
  "curl field is divergence-free (incompressible: vortices, not pile-up)"
)
assert(
  divergenceRatio(radialControlField(), 4) > 0.5,
  "the divergence metric does flag a compressible control field"
)

/* ── The invalidation seam ───────────────────────────────────────────────────
 * Every member of SlitScanParams must miss the master cache; nothing else may.
 * The second half is the 60fps guarantee: dragging smear or an effect weight
 * must not rebuild the master.
 */
for (const [label, mutate] of [
  ["width", (p: SlitScanParams) => ({ ...p, width: p.width + 1 })],
  ["height", (p: SlitScanParams) => ({ ...p, height: p.height + 1 })],
  ["seed", (p: SlitScanParams) => ({ ...p, seed: p.seed + 1 })],
  ["amount", (p: SlitScanParams) => ({ ...p, amount: p.amount + 1 })],
  ["frequency", (p: SlitScanParams) => ({ ...p, frequency: p.frequency + 1 })],
  ["mode", (p: SlitScanParams) => ({ ...p, mode: "vertical" as const })],
  [
    "luminanceMask",
    (p: SlitScanParams) => ({ ...p, luminanceMask: !p.luminanceMask }),
  ],
] as const) {
  assert(
    !slitScanParamsEqual(baseParams, mutate(baseParams)),
    `master key: ${label} change invalidates the Slit Scan master`
  )
}

for (const [label, override] of [
  ["smear amount", { smearHorizontal: { enabled: true, amount: 80 } }],
  ["smear weight", { horizontalWeight: 90 }],
  ["effect weight", { weightInvert: 80 }],
  ["Slit Scan weight", { weightSlitScan: 80 }],
  ["noise scale", { noiseScale: 80 }],
  ["passes", { passes: 3 }],
  ["grain", { textureOpacity: 0.2 }],
] as const) {
  assert(
    slitScanParamsEqual(
      baseParams,
      extractSlitScanParams(makeSettings(override), W, H)
    ),
    `master key: ${label} change reuses the master (no rebuild on drag)`
  )
}

/* ── Field cache: strictly coarser than the master key ───────────────────── */
assert(
  getSlitScanField(fieldKey(baseParams)) === field,
  "field cache hits on an equal key (structural, not identity)"
)
assert(
  getSlitScanField(fieldKey({ ...baseParams, amount: 5 })) === field,
  "amount is NOT in the field key — dragging Amount re-runs only the gather"
)
assert(
  getSlitScanField(fieldKey({ ...baseParams, frequency: 90 })) !== field,
  "field cache misses on a frequency change"
)
assert(
  getSlitScanField(fieldKey({ ...baseParams, seed: 7 })) !== field,
  "field cache misses on a seed change"
)

/* ── Slit Scan Mode: which axes the displacement may move along ──────────────
 * The axis modes are deliberately NOT divergence-free (a field confined to one
 * axis cannot be), so the incompressibility check above stays on "noise".
 */
assert(
  getSlitScanField(fieldKey({ ...baseParams, mode: "horizontal" })) !== field,
  "field cache misses on a mode change"
)

function axisPeaks(f: SlitScanField) {
  let x = 0
  let y = 0
  for (let i = 0; i < f.width * f.height; i++) {
    const dx = Math.abs(f.vectors[i * 2]!)
    const dy = Math.abs(f.vectors[i * 2 + 1]!)
    if (dx > x) x = dx
    if (dy > y) y = dy
  }
  return { x, y }
}

const hPeaks = axisPeaks(
  getSlitScanField(fieldKey({ ...baseParams, mode: "horizontal" }))
)
assert(hPeaks.y === 0, "horizontal mode forces dy to 0 (no vertical movement)")
assert(
  Math.abs(hPeaks.x - 1) < 1e-3,
  "horizontal mode renormalizes dx to 1, so Amount still means the same pixels"
)

const vPeaks = axisPeaks(
  getSlitScanField(fieldKey({ ...baseParams, mode: "vertical" }))
)
assert(vPeaks.x === 0, "vertical mode forces dx to 0 (no horizontal movement)")
assert(
  Math.abs(vPeaks.y - 1) < 1e-3,
  "vertical mode renormalizes dy to 1, so Amount still means the same pixels"
)

/* The luminance mask is a gather-time scalar, so it must sit on the master key
 * (checked above) and stay off the field key - the same split `amount` gets. */
const noiseBaseline = getSlitScanField(fieldKey(baseParams))
assert(
  getSlitScanField(fieldKey({ ...baseParams, luminanceMask: true })) ===
    noiseBaseline,
  "luminanceMask is NOT in the field key - toggling it re-runs only the gather"
)

/* ── Parameter mappings ─────────────────────────────────────────────────── */
/** Sign changes along the top row — a cheap proxy for spatial frequency. */
function reversals(f: SlitScanField, axis: 0 | 1) {
  let n = 0
  for (let x = 1; x < f.width; x++) {
    const prev = f.vectors[(x - 1) * 2 + axis]!
    const cur = f.vectors[x * 2 + axis]!
    if (prev < 0 !== cur < 0) n++
  }
  return n
}
assert(
  reversals(getSlitScanField(fieldKey({ ...baseParams, frequency: 95 })), 0) >
    reversals(getSlitScanField(fieldKey({ ...baseParams, frequency: 5 })), 0),
  "slitScanFrequency increases how often the field reverses direction"
)

assert(
  slitScanAmplitude(50, 1000) > 0 && slitScanAmplitude(0, 1000) === 0,
  "amplitude mapping is anchored at 0"
)
/* Recalibrated maxima: UI 100 now lands where the old curve's UI 70 (amount)
 * and UI 40 (frequency) did. Pinned as absolutes so a future re-tune has to be
 * deliberate rather than incidental. */
assert(
  slitScanAmplitude(100, 1000) === 245,
  "amount 100 peaks at 24.5% of height (the old amount 70)"
)
assert(
  slitScanAmplitude(50, 1000) === 122.5,
  "amplitude stays linear across the recalibrated range"
)
assert(
  Math.abs(slitScanFrequency(100) - 3.5652) < 1e-3,
  "frequency 100 tops out at ~3.57 cells (the old frequency 40)"
)
assert(
  slitScanFrequency(0) === 1,
  "frequency 0 still bottoms out at a single noise cell"
)
assert(
  slitScanFrequency(0) < slitScanFrequency(50) &&
    slitScanFrequency(50) < slitScanFrequency(100),
  "frequency mapping is monotonic across the UI range"
)

/* ── Gather: 2D lookup and edge clamping ────────────────────────────────────
 * Coordinates are encoded into the pixels (R = source x, G = source y), so the
 * assertions below pin the exact texel each output pixel was read from.
 */
function paintCoords(data: Uint8ClampedArray) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      data[i] = x
      data[i + 1] = y
      data[i + 2] = 0
      data[i + 3] = 255
    }
  }
}
function uniformField(dx: number, dy: number): SlitScanField {
  const vectors = new Float32Array(W * H * 2)
  for (let i = 0; i < W * H; i++) {
    vectors[i * 2] = dx
    vectors[i * 2 + 1] = dy
  }
  return { width: W, height: H, vectors }
}
function sampledAt(out: Uint8ClampedArray, x: number, y: number) {
  const i = (y * W + x) * 4
  return { x: out[i]!, y: out[i + 1]! }
}

const coords = new Uint8ClampedArray(W * H * 4)
paintCoords(coords)

const identity = gatherVectorDisplacement(coords, uniformField(1, 1), 0)
assert(
  fingerprint(identity) === fingerprint(coords),
  "gather at amplitude 0 is an exact copy (Slit Scan becomes a pass-through)"
)

const pushedX = sampledAt(gatherVectorDisplacement(coords, uniformField(1, 0), 10), 50, 50)
assert(
  pushedX.x === 60 && pushedX.y === 50,
  "gather applies the X offset (dx=+1, amp=10 reads 10px to the right)"
)
const pushedY = sampledAt(gatherVectorDisplacement(coords, uniformField(0, 1), 10), 50, 50)
assert(
  pushedY.x === 50 && pushedY.y === 60,
  "gather applies the Y offset (dy=+1, amp=10 reads 10px down)"
)
const pushedDiag = sampledAt(
  gatherVectorDisplacement(coords, uniformField(-1, -1), 10),
  50,
  50
)
assert(
  pushedDiag.x === 40 && pushedDiag.y === 40,
  "gather applies both axes at once, and negative vectors read up/left"
)

const farPositive = sampledAt(
  gatherVectorDisplacement(coords, uniformField(1, 1), 10000),
  50,
  50
)
assert(
  farPositive.x === W - 1 && farPositive.y === H - 1,
  "both axes clamp to the far edge instead of wrapping"
)
const farNegative = sampledAt(
  gatherVectorDisplacement(coords, uniformField(-1, -1), 10000),
  50,
  50
)
assert(
  farNegative.x === 0 && farNegative.y === 0,
  "both axes clamp to the near edge instead of wrapping"
)
let opaque = true
const clampedOut = gatherVectorDisplacement(coords, uniformField(1, 1), 10000)
for (let i = 3; i < clampedOut.length; i += 4) {
  if (clampedOut[i] !== 255) {
    opaque = false
    break
  }
}
assert(opaque, "clamped lookups stay opaque (no transparent holes at the edges)")

const warped = gatherVectorDisplacement(
  coords,
  getSlitScanField(fieldKey(baseParams)),
  slitScanAmplitude(80, H)
)
let movedHorizontally = false
for (let y = 0; y < H && !movedHorizontally; y++) {
  for (let x = 0; x < W; x++) {
    if (sampledAt(warped, x, y).x !== x) {
      movedHorizontally = true
      break
    }
  }
}
assert(
  movedHorizontally,
  "the real field moves pixels horizontally (2D warp, not a vertical stretch)"
)

/* ── Luminance gather: offset from brightness, not from the field ────────────
 * Alpha carries the source coordinate. Luminance is (R+G+B)/765, so alpha is
 * free to trace exactly which texel each output pixel was read from.
 */
function paintLumProbe(
  data: Uint8ClampedArray,
  level: (x: number) => number,
  tag: (x: number, y: number) => number
) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const v = level(x)
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = tag(x, y)
    }
  }
}
function readAlpha(out: Uint8ClampedArray, x: number, y: number) {
  return out[(y * W + x) * 4 + 3]!
}

/* The luminance mask scales the displacement by pixel brightness. A uniform
 * field isolates it: every pixel would move the same distance, so any variation
 * in where they read from is the mask alone. */
const split = new Uint8ClampedArray(W * H * 4)
paintLumProbe(split, (x) => (x < W / 2 ? 0 : 255), (x) => x)

const masked = gatherVectorDisplacement(split, uniformField(1, 0), 10, true)
assert(
  readAlpha(masked, 50, 50) === 50,
  "mask on: a black pixel takes 0% of the displacement (holds still)"
)
assert(
  readAlpha(masked, 150, 50) === 160,
  "mask on: a white pixel takes 100% of the displacement"
)

const unmasked = gatherVectorDisplacement(split, uniformField(1, 0), 10, false)
assert(
  readAlpha(unmasked, 50, 50) === 60 && readAlpha(unmasked, 150, 50) === 160,
  "mask off: brightness is ignored and every pixel takes the full vector"
)

const flat = new Uint8ClampedArray(W * H * 4)
paintLumProbe(flat, () => 128, (x) => x)
assert(
  readAlpha(gatherVectorDisplacement(flat, uniformField(1, 0), 10, true), 50, 50) ===
    55,
  "mask on: a mid-grey pixel takes about half"
)

/* The mask multiplies the vector, so it dials both axes down together. */
const rows = new Uint8ClampedArray(W * H * 4)
paintLumProbe(rows, () => 0, (_x, y) => y)
assert(
  readAlpha(gatherVectorDisplacement(rows, uniformField(0, 1), 10, true), 100, 50) ===
    50,
  "mask on: a black pixel holds still on the Y axis too"
)
assert(
  readAlpha(gatherVectorDisplacement(rows, uniformField(0, 1), 10, false), 100, 50) ===
    60,
  "mask off: the same pixel takes the full Y displacement"
)

assert(
  fingerprint(gatherVectorDisplacement(split, uniformField(1, 1), 0, true)) ===
    fingerprint(split),
  "masked gather at amplitude 0 is still an exact copy"
)

const a = new Uint8ClampedArray(W * H * 4)
const b = new Uint8ClampedArray(W * H * 4)
const c = new Uint8ClampedArray(W * H * 4)
paint(a)
paint(b)
paint(c)
apply(a, { smearVertical: { enabled: true, amount: 60 } })
apply(b, { smearHorizontal: { enabled: true, amount: 60 } })
apply(c, {
  smearVertical: { enabled: true, amount: 60 },
  smearHorizontal: { enabled: true, amount: 60 },
})
const fpV = fingerprint(a)
const fpH = fingerprint(b)
const fpBoth = fingerprint(c)
assert(fpV !== fpH, "Vertical-only differs from Horizontal-only")
assert(
  fpBoth === fpH,
  "V+H at randomVal 0.5 matches Horizontal-only (not a stacked mix)"
)
assert(fpBoth !== fpV, "V+H at randomVal 0.5 is not Vertical-only")

assert(
  chooseSmear(
    0,
    makeSettings({
      smearRecursive: { enabled: true, amount: 60 },
      recursiveWeight: 100,
    })
  ) === null,
  "chooseSmear never assigns Recursive (separate pass)"
)
assert(
  chooseRecursiveSmear(
    0.49,
    makeSettings({
      smearRecursive: { enabled: true, amount: 60 },
      recursiveWeight: 50,
    })
  ),
  "recursive weight 50: randomVal 0.49 is on"
)
assert(
  !chooseRecursiveSmear(
    0.5,
    makeSettings({
      smearRecursive: { enabled: true, amount: 60 },
      recursiveWeight: 50,
    })
  ),
  "recursive weight 50: randomVal 0.5 is off (absolute vs 100)"
)
assert(
  chooseRecursiveSmear(
    0.99,
    makeSettings({
      smearRecursive: { enabled: true, amount: 60 },
      recursiveWeight: 100,
    })
  ),
  "recursive weight 100 covers all ON Cells"
)
assert(
  !chooseRecursiveSmear(
    0,
    makeSettings({
      smearRecursive: { enabled: true, amount: 0 },
      recursiveWeight: 100,
    })
  ),
  "recursive amount 0 is treated as off even at weight 100"
)

{
  const rec50 = makeSettings({
    smearRecursive: { enabled: true, amount: 60 },
    smearHorizontal: { enabled: true, amount: 60 },
    recursiveWeight: 50,
    horizontalWeight: 100,
  })
  let recCount = 0
  let hCountSolo = 0
  for (let i = 0; i < N; i++) {
    if (chooseRecursiveSmear(i / N, rec50)) recCount++
    if (chooseSmear(i / N, rec50) === "horizontal") hCountSolo++
  }
  assert(
    Math.abs(recCount - N / 2) <= N * 0.02,
    `recursive 50 covers ~50% even when Horizontal fills 100 (rec=${recCount})`
  )
  assert(
    hCountSolo === N,
    "Horizontal weight 100 still covers every Cell while Recursive is also on"
  )
}

paint(a)
paint(b)
paint(c)
apply(a, { smearHorizontal: { enabled: true, amount: 60 } })
apply(b, { smearRecursive: { enabled: true, amount: 60 } })
apply(c, {
  smearHorizontal: { enabled: true, amount: 60 },
  smearRecursive: { enabled: true, amount: 60 },
})
const fpHOnly = fingerprint(a)
const fpROnly = fingerprint(b)
const fpHR = fingerprint(c)
assert(fpHOnly !== fpROnly, "Horizontal-only differs from Recursive-only")
assert(
  fpHR !== fpHOnly,
  "Horizontal + Recursive is not Horizontal-only (Recursive stacks)"
)
assert(
  fpHR !== fpROnly,
  "Horizontal + Recursive is not Recursive-only (directional still runs)"
)

paint(a)
const beforeNone = fingerprint(a)
apply(a, {})
assert(fingerprint(a) === beforeNone, "None leaves Cell unchanged")

paint(a)
const beforeZero = fingerprint(a)
apply(a, { smearRecursive: { enabled: true, amount: 0 } })
assert(fingerprint(a) === beforeZero, "recursive amount 0 leaves Cell unchanged")

paint(a)
const beforeHZero = fingerprint(a)
apply(a, { smearHorizontal: { enabled: true, amount: 0 } })
assert(fingerprint(a) === beforeHZero, "horizontal amount 0 leaves Cell unchanged")

function smearAt(amount: number) {
  const buf = new Uint8ClampedArray(W * H * 4)
  paint(buf)
  apply(buf, { smearHorizontal: { enabled: true, amount } })
  return fingerprint(buf)
}

assert(smearAt(1) !== smearAt(0), "horizontal amount 1 is not a no-op")
assert(
  smearAt(1) !== smearAt(2),
  "horizontal amount 1 and 2 differ (subpixel pull, not a 1px step)"
)
assert(
  smearAt(2) !== smearAt(3),
  "horizontal amount 2 and 3 differ (subpixel pull, not a 1px step)"
)

function assertSignedDiffers(
  style:
    | "smearVertical"
    | "smearHorizontal"
    | "smearDiagonal1"
    | "smearDiagonal2",
  label: string
) {
  const pos = new Uint8ClampedArray(W * H * 4)
  const neg = new Uint8ClampedArray(W * H * 4)
  paint(pos)
  paint(neg)
  apply(pos, { [style]: { enabled: true, amount: 60 } })
  apply(neg, { [style]: { enabled: true, amount: -60 } })
  assert(fingerprint(pos) !== fingerprint(neg), `${label} +60 differs from −60`)
}

assertSignedDiffers("smearVertical", "vertical")
assertSignedDiffers("smearHorizontal", "horizontal")
assertSignedDiffers("smearDiagonal1", "diagonal1")
assertSignedDiffers("smearDiagonal2", "diagonal2")

paint(a)
paint(b)
apply(a, { smearDiagonal1: { enabled: true, amount: 60 } })
apply(b, { smearDiagonal2: { enabled: true, amount: 60 } })
assert(
  fingerprint(a) !== fingerprint(b),
  "diagonal1 (\\) differs from diagonal2 (/)"
)

assert(
  chooseSmear(
    0,
    makeSettings({ smearDiagonal1: { enabled: true, amount: 60 } })
  ) === "diagonal1",
  "chooseSmear can pick diagonal1"
)
assert(
  chooseSmear(
    0,
    makeSettings({ smearDiagonal2: { enabled: true, amount: 60 } })
  ) === "diagonal2",
  "chooseSmear can pick diagonal2"
)

function pixelAt(
  data: Uint8ClampedArray,
  x: number,
  y: number
): [number, number, number] {
  const i = (y * W + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!]
}

function sameRgb(
  a: [number, number, number],
  b: [number, number, number]
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

paint(a)
const tlBefore = pixelAt(a, cell.x, cell.y)
const interiorBefore = pixelAt(a, cell.x + 20, cell.y + 20)
apply(a, { smearDiagonal1: { enabled: true, amount: 80 } })
assert(
  sameRgb(pixelAt(a, cell.x, cell.y), tlBefore),
  "diagonal1 + clamps top-left leading corner"
)
assert(
  !sameRgb(pixelAt(a, cell.x + 20, cell.y + 20), interiorBefore),
  "diagonal1 + smears interior along \\"
)

function applyOn(
  data: Uint8ClampedArray,
  testCell: CachedCell,
  overrides: Partial<EffectSettings>
) {
  applySmearStyles(data, W, H, testCell, makeSettings(overrides))
}

function fingerprintCell(data: Uint8ClampedArray, testCell: CachedCell) {
  let h = 0
  for (let y = 0; y < testCell.height; y++) {
    for (let x = 0; x < testCell.width; x++) {
      const i = ((testCell.y + y) * W + (testCell.x + x)) * 4
      h = (h * 33 + data[i]! + data[i + 1]! * 3 + data[i + 2]! * 7) | 0
    }
  }
  return h
}

const leftEdge: CachedCell = {
  x: 0,
  y: 40,
  width: 80,
  height: 80,
  sx: 0,
  sy: 40,
  randomVal: 0.5,
}
paint(a)
const leftBefore = fingerprintCell(a, leftEdge)
applyOn(a, leftEdge, { smearHorizontal: { enabled: true, amount: 60 } })
assert(
  fingerprintCell(a, leftEdge) !== leftBefore,
  "horizontal + smears a Cell on the left canvas edge (not a no-op)"
)

const topEdge: CachedCell = {
  x: 40,
  y: 0,
  width: 80,
  height: 80,
  sx: 40,
  sy: 0,
  randomVal: 0.5,
}
paint(b)
const topBefore = fingerprintCell(b, topEdge)
applyOn(b, topEdge, { smearVertical: { enabled: true, amount: 60 } })
assert(
  fingerprintCell(b, topEdge) !== topBefore,
  "vertical + smears a Cell on the top canvas edge (not a no-op)"
)

if (fails) {
  console.log(`\n${fails} FAILURES`)
  process.exit(1)
}
console.log("\nALL SMEAR CHECKS PASSED")
