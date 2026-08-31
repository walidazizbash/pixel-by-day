/**
 * Composite-time smear style family.
 * Does not affect Phase 1 layout or Phase 2 mask decisions.
 *
 * Snapshot smear: freeze the Cell, sample only that snapshot, clamp
 * out-of-bounds reads to the Cell edge. Trails never leave the Cell.
 *
 * Directional assignment is mutually exclusive (`chooseSmear`): at most
 * one of Vertical / Horizontal / Diagonal per Cell. Recursive is a
 * second pass (`chooseRecursiveSmear`) with its own 0–100 coverage of
 * ON Cells, stacked on top of whatever directional smear already ran.
 *
 * Directional weights are absolute coverage while they sum to ≤ 100
 * (remainder unsmeared); above 100 they compete relatively.
 * Recursive weight is always absolute vs 100 (50 = half the ON Cells).
 *
 * Signed amounts (Horizontal / Vertical / Diagonal Down–Up): −100…100, 0 = rest.
 *   Horizontal: + smear right, − smear left
 *   Vertical:   + smear down,  − smear up
 *   Diagonal Down (\\): + bottom-right, − top-left
 *   Diagonal Up (/):    + top-right, − bottom-left
 * Recursive stays 0–100.
 */

import type {
  CachedCell,
  EffectSettings,
} from "@/lib/effect-types"
import {
  chooseRecursiveSmear,
  chooseSmear,
  recursiveSmearRoll,
  type SmearStyleName,
} from "@/lib/pipeline"

/** Reused scratch for cell-local ops (snapshot / recursive). */
let smearScratch: Uint8ClampedArray | null = null
let smearScratchCap = 0

function ensureSmearScratch(byteLength: number): Uint8ClampedArray {
  if (!smearScratch || smearScratchCap < byteLength) {
    smearScratch = new Uint8ClampedArray(byteLength)
    smearScratchCap = byteLength
  }
  return smearScratch
}

function clampAmount(amount: number): number {
  if (amount < 0) return 0
  if (amount > 100) return 100
  return amount
}

/** Horizontal / Vertical / Diagonal: −100…100, 0 = rest. */
function clampSignedAmount(amount: number): number {
  if (amount < -100) return -100
  if (amount > 100) return 100
  return amount
}

function signedSmear(amount: number): { mag: number; sign: number } {
  const a = clampSignedAmount(amount)
  if (a === 0) return { mag: 0, sign: 1 }
  return { mag: Math.abs(a), sign: a < 0 ? -1 : 1 }
}

function clampFloat(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

/** Linear 0–1 coverage of the Cell's trailing-edge pull, including Repeat decay. */
function smearPull(mag: number, maxPull: number, decay: number): number {
  const t = (mag / 100) * (Number.isFinite(decay) ? Math.max(0, decay) : 1)
  if (!(t > 0) || maxPull <= 0) return 0
  return maxPull * t
}

/** Copy the Cell's current work-buffer pixels into scratch (frozen prior state). */
function snapshotCell(
  data: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  scratch: Uint8ClampedArray
) {
  const width = cell.width
  const height = cell.height
  for (let row = 0; row < height; row++) {
    const srcRow = (cell.y + row) * fullWidth + cell.x
    const tmpRow = row * width
    for (let col = 0; col < width; col++) {
      const src = (srcRow + col) * 4
      const tmp = (tmpRow + col) * 4
      scratch[tmp] = data[src]!
      scratch[tmp + 1] = data[src + 1]!
      scratch[tmp + 2] = data[src + 2]!
      scratch[tmp + 3] = data[src + 3]!
    }
  }
}

/** Bilinear sample of the Cell snapshot, clamped to the Cell (trailing-edge hold). */
function sampleScratchBilinear(
  scratch: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  dest: Uint8ClampedArray,
  dst: number
) {
  const maxX = width - 1
  const maxY = height - 1
  const x = clampFloat(fx, 0, maxX)
  const y = clampFloat(fy, 0, maxY)
  const x0 = x | 0
  const y0 = y | 0
  const x1 = x0 < maxX ? x0 + 1 : maxX
  const y1 = y0 < maxY ? y0 + 1 : maxY
  const tx = x - x0
  const ty = y - y0
  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4
  const a = (1 - tx) * (1 - ty)
  const b = tx * (1 - ty)
  const c = (1 - tx) * ty
  const d = tx * ty
  dest[dst] = scratch[i00]! * a + scratch[i10]! * b + scratch[i01]! * c + scratch[i11]! * d
  dest[dst + 1] =
    scratch[i00 + 1]! * a +
    scratch[i10 + 1]! * b +
    scratch[i01 + 1]! * c +
    scratch[i11 + 1]! * d
  dest[dst + 2] =
    scratch[i00 + 2]! * a +
    scratch[i10 + 2]! * b +
    scratch[i01 + 2]! * c +
    scratch[i11 + 2]! * d
  dest[dst + 3] = 255
}

/**
 * Directional smear from a frozen Cell snapshot with subpixel pull.
 * `offsetX`/`offsetY` are opposite the visual smear (right → sample left).
 * Out-of-Cell reads clamp to the trailing edge.
 */
function blitSmearFromSnapshot(
  data: Uint8ClampedArray,
  scratch: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  offsetX: number,
  offsetY: number
) {
  const width = cell.width
  const height = cell.height
  if (offsetX === 0 && offsetY === 0) return

  for (let row = 0; row < height; row++) {
    const dstRow = (cell.y + row) * fullWidth + cell.x
    for (let col = 0; col < width; col++) {
      sampleScratchBilinear(
        scratch,
        width,
        height,
        col + offsetX,
        row + offsetY,
        data,
        (dstRow + col) * 4
      )
    }
  }
}

/**
 * 45-degree smear. Pull is equal on X and Y; when a sample would leave
 * the Cell, both axes retract together so the trail never collapses
 * onto a single axis.
 */
function blitDiagonalFromSnapshot(
  data: Uint8ClampedArray,
  scratch: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  pull: number,
  sampleSignX: number,
  sampleSignY: number
) {
  const width = cell.width
  const height = cell.height
  const maxCol = width - 1
  const maxRow = height - 1
  if (!(pull > 0)) return

  for (let row = 0; row < height; row++) {
    const dstRow = (cell.y + row) * fullWidth + cell.x
    for (let col = 0; col < width; col++) {
      const roomX = sampleSignX < 0 ? col : maxCol - col
      const roomY = sampleSignY < 0 ? row : maxRow - row
      const p = Math.min(pull, roomX, roomY)
      sampleScratchBilinear(
        scratch,
        width,
        height,
        col + sampleSignX * p,
        row + sampleSignY * p,
        data,
        (dstRow + col) * 4
      )
    }
  }
}

/* ─── Style implementations ──────────────────────────────────────────────── */

function applyVerticalSmear(
  dest: Uint8ClampedArray,
  source: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  amount: number,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const { mag, sign } = signedSmear(amount)
  if (mag === 0) return
  const smearDown = sign > 0
  const pull = smearPull(mag, height - 1, decay)
  if (!(pull > 0)) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(source, fullWidth, cell, scratch)
  blitSmearFromSnapshot(
    dest,
    scratch,
    fullWidth,
    cell,
    0,
    smearDown ? -pull : pull
  )
}

function applyHorizontalSmear(
  dest: Uint8ClampedArray,
  source: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  amount: number,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const { mag, sign } = signedSmear(amount)
  if (mag === 0) return
  const smearRight = sign > 0
  const pull = smearPull(mag, width - 1, decay)
  if (!(pull > 0)) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(source, fullWidth, cell, scratch)
  blitSmearFromSnapshot(
    dest,
    scratch,
    fullWidth,
    cell,
    smearRight ? -pull : pull,
    0
  )
}

function applyDiagonalSmear(
  dest: Uint8ClampedArray,
  source: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  amount: number,
  decay: number,
  axis: 1 | 2
) {
  const width = cell.width
  const height = cell.height
  if (width < 2 || height < 2) return

  const { mag, sign } = signedSmear(amount)
  if (mag === 0) return
  const smearX = sign
  const smearY = axis === 1 ? sign : -sign
  const sampleX = -smearX
  const sampleY = -smearY
  const pull = smearPull(mag, Math.min(width - 1, height - 1), decay)
  if (!(pull > 0)) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(source, fullWidth, cell, scratch)
  blitDiagonalFromSnapshot(dest, scratch, fullWidth, cell, pull, sampleX, sampleY)
}

/** Nested scale-copy tunnel inside the Cell (one bilinear pass, continuous inset). */
function applyRecursiveSmear(
  dest: Uint8ClampedArray,
  source: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell,
  amount: number,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 4 || height < 4) return

  const smear =
    (clampAmount(amount) / 100) *
    (Number.isFinite(decay) ? Math.max(0, decay) : 1)
  if (!(smear > 0)) return

  const insetX = smear * width * 0.14
  const insetY = smear * height * 0.14
  const innerLeft = insetX
  const innerTop = insetY
  const innerW = width - insetX * 2
  const innerH = height - insetY * 2
  if (innerW < 2 || innerH < 2) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(source, fullWidth, cell, scratch)

  const srcMaxX = width - 1
  const srcMaxY = height - 1
  for (let row = 0; row < height; row++) {
    if (row + 0.5 < innerTop || row + 0.5 > innerTop + innerH) continue
    const v = ((row + 0.5 - innerTop) / innerH) * srcMaxY
    const dstRow = (cell.y + row) * fullWidth + cell.x
    for (let col = 0; col < width; col++) {
      if (col + 0.5 < innerLeft || col + 0.5 > innerLeft + innerW) continue
      const u = ((col + 0.5 - innerLeft) / innerW) * srcMaxX
      sampleScratchBilinear(
        scratch,
        width,
        height,
        u,
        v,
        dest,
        (dstRow + col) * 4
      )
    }
  }
}

/**
 * Apply exactly one smear style to an already-seeded ON Cell.
 * `decay` scales smear shift intensity only (not assignment).
 */
function applySmearStyle(
  data: Uint8ClampedArray,
  fullWidth: number,
  _fullHeight: number,
  cell: CachedCell,
  settings: EffectSettings,
  style: SmearStyleName,
  decay = 1,
  source: Uint8ClampedArray = data
) {
  const smearDecay = Number.isFinite(decay) ? Math.max(0, decay) : 1

  if (style === "vertical") {
    applyVerticalSmear(
      data,
      source,
      fullWidth,
      cell,
      settings.smearVertical.amount,
      smearDecay
    )
    return
  }
  if (style === "horizontal") {
    applyHorizontalSmear(
      data,
      source,
      fullWidth,
      cell,
      settings.smearHorizontal.amount,
      smearDecay
    )
    return
  }
  if (style === "diagonal1") {
    applyDiagonalSmear(
      data,
      source,
      fullWidth,
      cell,
      settings.smearDiagonal1.amount,
      smearDecay,
      1
    )
    return
  }
  if (style === "diagonal2") {
    applyDiagonalSmear(
      data,
      source,
      fullWidth,
      cell,
      settings.smearDiagonal2.amount,
      smearDecay,
      2
    )
    return
  }
  applyRecursiveSmear(
    data,
    source,
    fullWidth,
    cell,
    settings.smearRecursive.amount,
    smearDecay
  )
}

/**
 * Apply directional smear (at most one), then Recursive on top when assigned.
 * Caller must already have seeded the Cell from its Color Master in `data`.
 */
export function applySmearStyles(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  settings: EffectSettings,
  decay = 1,
  source: Uint8ClampedArray = data
) {
  const style = chooseSmear(cell.randomVal, settings)
  if (style) {
    applySmearStyle(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings,
      style,
      decay,
      source
    )
  }
  if (
    chooseRecursiveSmear(recursiveSmearRoll(cell.randomVal), settings)
  ) {
    applySmearStyle(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings,
      "recursive",
      decay,
      data
    )
  }
}
