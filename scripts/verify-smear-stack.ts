/**
 * Verify smear styles chain cumulatively on the work buffer.
 * Run: npx tsx scripts/verify-smear-stack.ts
 */

import type { CachedCell, EffectSettings } from "../lib/effect-types"
import { applySmearStyles } from "../lib/smear-styles"

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
    edgeClamp: true,
    smearVertical: off,
    smearHorizontal: off,
    smearDiagonal: off,
    smearRecursive: off,
    noiseScale: 19,
    noiseSpread: 50,
    maxCellSize: 10,
    layoutMode: "standard",
    subdivisionLoops: 3,
    subdivisionMode: "frontier",
    subdivisionRate: 60,
    showNoiseMap: false,
    showCellLayout: false,
    textureEnabled: false,
    textureOpacity: 1,
    ...overrides,
  }
}

function paint(data: Uint8ClampedArray) {
  // Blue neighbors — any cascade wipe shows up as blueRatio spikes.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      data[i] = 10
      data[i + 1] = 20
      data[i + 2] = 200
      data[i + 3] = 255
    }
  }
  // Patterned Cell (not flat) so directional rearrangements change the fingerprint.
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

function cellStats(data: Uint8ClampedArray) {
  let redish = 0
  let blueish = 0
  const total = cell.width * cell.height
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const i = ((cell.y + y) * W + (cell.x + x)) * 4
      if (data[i] > 150 && data[i + 2] < 100) redish++
      if (data[i + 2] > 150 && data[i] < 80) blueish++
    }
  }
  return {
    redish,
    blueish,
    total,
    redRatio: redish / total,
    blueRatio: blueish / total,
  }
}

function fingerprint(data: Uint8ClampedArray) {
  let h = 0
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const i = ((cell.y + y) * W + (cell.x + x)) * 4
      h = (h * 33 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) | 0
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

const a = new Uint8ClampedArray(W * H * 4)
const b = new Uint8ClampedArray(W * H * 4)
paint(a)
paint(b)
applySmearStyles(
  a,
  W,
  H,
  cell,
  makeSettings({ smearVertical: { enabled: true, amount: 60 } })
)
const afterV = fingerprint(a)
applySmearStyles(
  a,
  W,
  H,
  cell,
  makeSettings({ smearHorizontal: { enabled: true, amount: 60 } })
)
const afterVH = fingerprint(a)
applySmearStyles(
  b,
  W,
  H,
  cell,
  makeSettings({ smearHorizontal: { enabled: true, amount: 60 } })
)
assert(afterV !== afterVH, "Horizontal changes buffer after Vertical")
assert(
  afterVH !== fingerprint(b),
  "V+H result differs from H-only (V contribution retained)"
)

const d = new Uint8ClampedArray(W * H * 4)
paint(d)
applySmearStyles(
  d,
  W,
  H,
  cell,
  makeSettings({
    smearVertical: { enabled: true, amount: 50 },
    smearHorizontal: { enabled: true, amount: 50 },
  })
)
const beforeDiag = fingerprint(d)
applySmearStyles(
  d,
  W,
  H,
  cell,
  makeSettings({ smearDiagonal: { enabled: true, amount: 70 } })
)
const endDiag = cellStats(d)
assert(beforeDiag !== fingerprint(d), "Diagonal mutates after V+H")
assert(
  endDiag.blueRatio < 0.85,
  `Diagonal does not fully replace Cell (blueRatio=${endDiag.blueRatio.toFixed(2)})`
)

paint(a)
paint(b)
applySmearStyles(
  a,
  W,
  H,
  cell,
  makeSettings({
    smearVertical: { enabled: true, amount: 50 },
    smearRecursive: { enabled: true, amount: 60 },
  })
)
applySmearStyles(
  b,
  W,
  H,
  cell,
  makeSettings({ smearRecursive: { enabled: true, amount: 60 } })
)
assert(
  fingerprint(a) !== fingerprint(b),
  "Recursive after Vertical differs from Recursive alone"
)

paint(d)
applySmearStyles(
  d,
  W,
  H,
  cell,
  makeSettings({
    smearVertical: { enabled: true, amount: 40 },
    smearHorizontal: { enabled: true, amount: 40 },
    smearDiagonal: { enabled: true, amount: 40 },
    smearRecursive: { enabled: true, amount: 40 },
  })
)
assert(
  cellStats(d).blueRatio < 0.95,
  "Full stack does not fully externalize Cell"
)

// V/H/Diagonal have amount floors when enabled; Recursive treats UI 0 as no-op.
paint(d)
const beforeZero = fingerprint(d)
applySmearStyles(
  d,
  W,
  H,
  cell,
  makeSettings({
    smearRecursive: { enabled: true, amount: 0 },
  })
)
assert(fingerprint(d) === beforeZero, "amount 0 leaves Cell unchanged")

if (fails) {
  console.log(`\n${fails} FAILURES`)
  process.exit(1)
}
console.log("\nALL STACK CHECKS PASSED")
