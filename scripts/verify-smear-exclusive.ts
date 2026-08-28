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
    maxCellSize: 10,
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
    })
  ) === "original",
  "all effect weights 0 → Original"
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
