/**
 * Composite-time smear style family.
 * Does not affect Phase 1 layout or Phase 2 mask decisions.
 *
 * Two engines (selected by settings.edgeClamp):
 *
 * Edge Clamp ON — stacking-safe snapshot:
 *   Freeze the Cell, read from that snapshot, clamp out-of-bounds samples
 *   to the Cell edge. Caller forces sx/sy to the Cell origin.
 *
 * Edge Clamp OFF — legacy wet canvas:
 *   Live overlapping blit (read/write the work buffer as pixels cascade).
 *   Amount drives a source-origin shift from cell.sx/sy.
 *
 * Fixed combine order (independent sequential ifs, not exclusive):
 * 1. Vertical
 * 2. Horizontal
 * 3. Diagonal
 * 4. Recursive
 *
 * Each style also runs an independent per-cell weight coin-flip
 * (unique deterministic roll per style — not shared cell.randomVal).
 *
 * All region ops respect rectangular Cell bounds (width × height),
 * including edge-clamped non-square Cells.
 */

import type {
  CachedCell,
  EffectSettings,
} from "@/lib/effect-types"
import { hash2D } from "@/lib/phase1-floor"

/** Reused scratch for cell-local ops (snapshot / recursive / clean copy). */
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

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

/**
 * Scale a sample-origin shift relative to the Cell origin by pass decay.
 * decay=1 → unchanged; decay=0 → identity (no smear motion).
 */
function decaySampleOrigin(
  sx: number,
  sy: number,
  originX: number,
  originY: number,
  decay: number
): { sx: number; sy: number } {
  if (!(decay < 1)) return { sx, sy }
  if (!(decay > 0)) return { sx: originX, sy: originY }
  return {
    sx: originX + Math.round((sx - originX) * decay),
    sy: originY + Math.round((sy - originY) * decay),
  }
}

/** Deterministic 0–1 value for a cell + salt. */
function cellUnit(
  cell: CachedCell,
  seed: number,
  salt: number
): number {
  return hash2D(cell.x + salt * 17, cell.y + salt * 31, seed >>> 0)
}

/**
 * Unique salts for smear weight coin-flips (distinct from direction salts 101/202).
 * Each style must roll independently so probabilities do not perfectly overlap.
 */
const SMEAR_WEIGHT_SALT = {
  vertical: 1001,
  horizontal: 1002,
  diagonal: 1003,
  recursive: 1004,
} as const

/**
 * Independent coin flip: map a style-specific deterministic roll to 0–100.
 * Apply when roll <= weight. Weight 100 always passes; weight 0 almost never.
 */
function passesSmearWeight(
  cell: CachedCell,
  seed: number,
  salt: number,
  weight: number
): boolean {
  const w = clampAmount(weight)
  if (w <= 0) return false
  if (w >= 100) return true
  const roll = cellUnit(cell, seed, salt) * 100
  return roll <= w
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
      scratch[tmp] = data[src]
      scratch[tmp + 1] = data[src + 1]
      scratch[tmp + 2] = data[src + 2]
      scratch[tmp + 3] = data[src + 3]
    }
  }
}

/* ─── Safe engine (snapshot / stack) ─────────────────────────────────────── */

/**
 * Directional smear (Edge Clamp ON):
 * Samples only the frozen Cell snapshot; out-of-Cell coords edge-clamp in.
 */
function blitSmearFromSnapshot(
  data: Uint8ClampedArray,
  scratch: Uint8ClampedArray,
  fullWidth: number,
  _fullHeight: number,
  sx: number,
  sy: number,
  cell: CachedCell
) {
  const width = cell.width
  const height = cell.height
  const dx = cell.x
  const dy = cell.y
  if (sx === dx && sy === dy) return

  const maxCol = width - 1
  const maxRow = height - 1

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const srcCol = clampInt(sx + col - dx, 0, maxCol)
      const srcRow = clampInt(sy + row - dy, 0, maxRow)
      const tmp = (srcRow * width + srcCol) * 4
      const dst = ((dy + row) * fullWidth + (dx + col)) * 4
      data[dst] = scratch[tmp]
      data[dst + 1] = scratch[tmp + 1]
      data[dst + 2] = scratch[tmp + 2]
      data[dst + 3] = scratch[tmp + 3]
    }
  }
}

/** Clamp a W×H source origin so it fits in the image and still overlaps the Cell. */
function clampSourceOverlappingCell(
  sx: number,
  sy: number,
  cellX: number,
  cellY: number,
  width: number,
  height: number,
  fullWidth: number,
  fullHeight: number
): { sx: number; sy: number } {
  const maxSx = Math.max(0, fullWidth - width)
  const maxSy = Math.max(0, fullHeight - height)
  return {
    sx: clampInt(
      sx,
      Math.max(0, cellX - (width - 1)),
      Math.min(maxSx, cellX + (width - 1))
    ),
    sy: clampInt(
      sy,
      Math.max(0, cellY - (height - 1)),
      Math.min(maxSy, cellY + (height - 1))
    ),
  }
}

/* ─── Feedback engine (legacy live cascade) ──────────────────────────────── */

/** In-place overlapping blit (unsafe self-feedback when src∩dest). */
function copySampleRegion(
  data: Uint8ClampedArray,
  fullWidth: number,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  width: number,
  height: number
) {
  if (sx === dx && sy === dy) return
  for (let row = 0; row < height; row++) {
    const srcRow = (sy + row) * fullWidth + sx
    const dstRow = (dy + row) * fullWidth + dx
    for (let col = 0; col < width; col++) {
      const src = (srcRow + col) * 4
      const dst = (dstRow + col) * 4
      data[dst] = data[src]
      data[dst + 1] = data[src + 1]
      data[dst + 2] = data[src + 2]
      data[dst + 3] = data[src + 3]
    }
  }
}

/** Clean same-size copy via scratch — no self-smear. */
function copySampleRegionClean(
  data: Uint8ClampedArray,
  fullWidth: number,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  width: number,
  height: number
) {
  if (sx === dx && sy === dy) return
  const temp = ensureSmearScratch(width * height * 4)
  for (let row = 0; row < height; row++) {
    const srcRow = (sy + row) * fullWidth + sx
    const tmpRow = row * width
    for (let col = 0; col < width; col++) {
      const src = (srcRow + col) * 4
      const tmp = (tmpRow + col) * 4
      temp[tmp] = data[src]
      temp[tmp + 1] = data[src + 1]
      temp[tmp + 2] = data[src + 2]
      temp[tmp + 3] = data[src + 3]
    }
  }
  for (let row = 0; row < height; row++) {
    const dstRow = (dy + row) * fullWidth + dx
    const tmpRow = row * width
    for (let col = 0; col < width; col++) {
      const dst = (dstRow + col) * 4
      const tmp = (tmpRow + col) * 4
      data[dst] = temp[tmp]
      data[dst + 1] = temp[tmp + 1]
      data[dst + 2] = temp[tmp + 2]
      data[dst + 3] = temp[tmp + 3]
    }
  }
}

function clampSampleOrigin(
  sx: number,
  sy: number,
  width: number,
  height: number,
  fullWidth: number,
  fullHeight: number
): { sx: number; sy: number } {
  const maxSx = Math.max(0, fullWidth - width)
  const maxSy = Math.max(0, fullHeight - height)
  return {
    sx: clampInt(sx, 0, maxSx),
    sy: clampInt(sy, 0, maxSy),
  }
}

/** Amount 0 baseline (feedback): clean sample → Cell. */
function copyCellBaselineClean(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return
  const clamped = clampSampleOrigin(
    cell.sx,
    cell.sy,
    width,
    height,
    fullWidth,
    fullHeight
  )
  copySampleRegionClean(
    data,
    fullWidth,
    clamped.sx,
    clamped.sy,
    cell.x,
    cell.y,
    width,
    height
  )
}

/** Horizontal in-place blit with column-major scan for sideways feedback. */
function copySampleRegionHorizontal(
  data: Uint8ClampedArray,
  fullWidth: number,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
  rightToLeft: boolean
) {
  if (sx === dx && sy === dy) return
  if (rightToLeft) {
    for (let col = width - 1; col >= 0; col--) {
      for (let row = 0; row < height; row++) {
        const src = ((sy + row) * fullWidth + (sx + col)) * 4
        const dst = ((dy + row) * fullWidth + (dx + col)) * 4
        data[dst] = data[src]
        data[dst + 1] = data[src + 1]
        data[dst + 2] = data[src + 2]
        data[dst + 3] = data[src + 3]
      }
    }
  } else {
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) {
        const src = ((sy + row) * fullWidth + (sx + col)) * 4
        const dst = ((dy + row) * fullWidth + (dx + col)) * 4
        data[dst] = data[src]
        data[dst + 1] = data[src + 1]
        data[dst + 2] = data[src + 2]
        data[dst + 3] = data[src + 3]
      }
    }
  }
}

/* ─── Style implementations ──────────────────────────────────────────────── */

function applyVerticalSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  edgeClamp: boolean,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  // Floor at 2 when enabled so the toggle feels immediately responsive.
  // OFF bypasses this function entirely via applySmearStyles.
  const amountClamped = Math.max(2, clampAmount(amount))

  if (!edgeClamp) {
    let sx = cell.sx
    let sy = cell.sy

    const enhance = amountClamped / 100
    const maxUp = Math.max(0, Math.min(height - 1, cell.y))
    const targetSy = cell.y - Math.floor(maxUp * (0.35 + 0.65 * enhance))
    const targetSx = cell.x
    sx = Math.round(sx + (targetSx - sx) * enhance)
    sy = Math.round(sy + (targetSy - sy) * enhance)

    const clamped = clampSampleOrigin(
      sx,
      sy,
      width,
      height,
      fullWidth,
      fullHeight
    )
    ;({ sx, sy } = decaySampleOrigin(
      clamped.sx,
      clamped.sy,
      cell.x,
      cell.y,
      decay
    ))

    const passes = 1 + Math.floor(enhance * 3)
    for (let p = 0; p < passes; p++) {
      copySampleRegion(
        data,
        fullWidth,
        sx,
        sy,
        cell.x,
        cell.y,
        width,
        height
      )
    }
    return
  }

  const enhance = amountClamped / 100
  const maxUp = Math.max(0, Math.min(height - 1, cell.y))
  const targetSy = cell.y - Math.floor(maxUp * (0.35 + 0.65 * enhance))
  let clamped = clampSourceOverlappingCell(
    cell.x,
    Math.round(cell.y + (targetSy - cell.y) * enhance),
    cell.x,
    cell.y,
    width,
    height,
    fullWidth,
    fullHeight
  )
  clamped = decaySampleOrigin(clamped.sx, clamped.sy, cell.x, cell.y, decay)
  if (clamped.sx === cell.x && clamped.sy === cell.y) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(data, fullWidth, cell, scratch)

  const passes = 1 + Math.floor(enhance * 3)
  for (let p = 0; p < passes; p++) {
    blitSmearFromSnapshot(
      data,
      scratch,
      fullWidth,
      fullHeight,
      clamped.sx,
      clamped.sy,
      cell
    )
    if (p + 1 < passes) snapshotCell(data, fullWidth, cell, scratch)
  }
}

function applyHorizontalSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  seed: number,
  edgeClamp: boolean,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 2 || height < 1) return

  // Floor at 2 when enabled so the toggle feels immediately responsive.
  // OFF bypasses this function entirely via applySmearStyles.
  const amountClamped = Math.max(2, clampAmount(amount))
  const rightToLeft = cellUnit(cell, seed, 101) >= 0.5

  if (!edgeClamp) {
    let sx = cell.sx
    let sy = cell.sy

    const enhance = amountClamped / 100
    const maxSide = Math.max(
      0,
      Math.min(width - 1, rightToLeft ? fullWidth - cell.x - width : cell.x)
    )
    const pull = Math.floor(maxSide * (0.35 + 0.65 * enhance))
    const targetSx = rightToLeft ? cell.x + pull : cell.x - pull
    const targetSy = cell.y
    sx = Math.round(sx + (targetSx - sx) * enhance)
    sy = Math.round(sy + (targetSy - sy) * enhance)

    const clamped = clampSampleOrigin(
      sx,
      sy,
      width,
      height,
      fullWidth,
      fullHeight
    )
    ;({ sx, sy } = decaySampleOrigin(
      clamped.sx,
      clamped.sy,
      cell.x,
      cell.y,
      decay
    ))

    const passes = 1 + Math.floor(enhance * 3)
    for (let p = 0; p < passes; p++) {
      copySampleRegionHorizontal(
        data,
        fullWidth,
        sx,
        sy,
        cell.x,
        cell.y,
        width,
        height,
        rightToLeft
      )
    }
    return
  }

  const enhance = amountClamped / 100
  const maxSide = Math.max(
    0,
    Math.min(width - 1, rightToLeft ? fullWidth - cell.x - width : cell.x)
  )
  const pull = Math.floor(maxSide * (0.35 + 0.65 * enhance))
  const targetSx = rightToLeft ? cell.x + pull : cell.x - pull
  let clamped = clampSourceOverlappingCell(
    Math.round(cell.x + (targetSx - cell.x) * enhance),
    cell.y,
    cell.x,
    cell.y,
    width,
    height,
    fullWidth,
    fullHeight
  )
  clamped = decaySampleOrigin(clamped.sx, clamped.sy, cell.x, cell.y, decay)
  if (clamped.sx === cell.x && clamped.sy === cell.y) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(data, fullWidth, cell, scratch)

  const passes = 1 + Math.floor(enhance * 3)
  for (let p = 0; p < passes; p++) {
    blitSmearFromSnapshot(
      data,
      scratch,
      fullWidth,
      fullHeight,
      clamped.sx,
      clamped.sy,
      cell
    )
    if (p + 1 < passes) snapshotCell(data, fullWidth, cell, scratch)
  }
}

function applyDiagonalSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  seed: number,
  edgeClamp: boolean,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 2 || height < 2) return

  // UI 0–100 maps to effective 3–100 (slider 0 = old amount 3).
  // OFF bypasses this function entirely via applySmearStyles.
  const amountClamped = 3 + clampAmount(amount) * 0.97
  const dir = (cellUnit(cell, seed, 202) * 4) | 0
  const signX = dir === 0 || dir === 2 ? -1 : 1
  const signY = dir === 0 || dir === 1 ? -1 : 1

  if (!edgeClamp) {
    let sx = cell.sx
    let sy = cell.sy

    const enhance = amountClamped / 100
    const pullT = 0.35 + 0.65 * enhance
    const maxX =
      signX < 0
        ? Math.min(width - 1, cell.x)
        : Math.min(width - 1, Math.max(0, fullWidth - cell.x - width))
    const maxY =
      signY < 0
        ? Math.min(height - 1, cell.y)
        : Math.min(height - 1, Math.max(0, fullHeight - cell.y - height))
    const ox = Math.floor(maxX * pullT)
    const oy = Math.floor(maxY * pullT)
    const targetSx = cell.x + signX * ox
    const targetSy = cell.y + signY * oy
    sx = Math.round(sx + (targetSx - sx) * enhance)
    sy = Math.round(sy + (targetSy - sy) * enhance)

    const clamped = clampSampleOrigin(
      sx,
      sy,
      width,
      height,
      fullWidth,
      fullHeight
    )
    ;({ sx, sy } = decaySampleOrigin(
      clamped.sx,
      clamped.sy,
      cell.x,
      cell.y,
      decay
    ))

    const passes = 1 + Math.floor(enhance * 3)
    const xForward = signX < 0
    const yForward = signY < 0

    for (let p = 0; p < passes; p++) {
      if (yForward) {
        for (let row = 0; row < height; row++) {
          if (xForward) {
            for (let col = 0; col < width; col++) {
              const src = ((sy + row) * fullWidth + (sx + col)) * 4
              const dst = ((cell.y + row) * fullWidth + (cell.x + col)) * 4
              data[dst] = data[src]
              data[dst + 1] = data[src + 1]
              data[dst + 2] = data[src + 2]
              data[dst + 3] = data[src + 3]
            }
          } else {
            for (let col = width - 1; col >= 0; col--) {
              const src = ((sy + row) * fullWidth + (sx + col)) * 4
              const dst = ((cell.y + row) * fullWidth + (cell.x + col)) * 4
              data[dst] = data[src]
              data[dst + 1] = data[src + 1]
              data[dst + 2] = data[src + 2]
              data[dst + 3] = data[src + 3]
            }
          }
        }
      } else {
        for (let row = height - 1; row >= 0; row--) {
          if (xForward) {
            for (let col = 0; col < width; col++) {
              const src = ((sy + row) * fullWidth + (sx + col)) * 4
              const dst = ((cell.y + row) * fullWidth + (cell.x + col)) * 4
              data[dst] = data[src]
              data[dst + 1] = data[src + 1]
              data[dst + 2] = data[src + 2]
              data[dst + 3] = data[src + 3]
            }
          } else {
            for (let col = width - 1; col >= 0; col--) {
              const src = ((sy + row) * fullWidth + (sx + col)) * 4
              const dst = ((cell.y + row) * fullWidth + (cell.x + col)) * 4
              data[dst] = data[src]
              data[dst + 1] = data[src + 1]
              data[dst + 2] = data[src + 2]
              data[dst + 3] = data[src + 3]
            }
          }
        }
      }
    }
    return
  }

  const enhance = amountClamped / 100
  const pullT = 0.2 + 0.45 * enhance
  const ox = Math.max(1, Math.floor((width - 1) * pullT))
  const oy = Math.max(1, Math.floor((height - 1) * pullT))
  let clamped = clampSourceOverlappingCell(
    cell.x + signX * ox,
    cell.y + signY * oy,
    cell.x,
    cell.y,
    width,
    height,
    fullWidth,
    fullHeight
  )
  clamped = decaySampleOrigin(clamped.sx, clamped.sy, cell.x, cell.y, decay)
  if (clamped.sx === cell.x && clamped.sy === cell.y) return

  const scratch = ensureSmearScratch(width * height * 4)
  snapshotCell(data, fullWidth, cell, scratch)

  const passes = 1 + Math.floor(enhance * 3)
  for (let p = 0; p < passes; p++) {
    blitSmearFromSnapshot(
      data,
      scratch,
      fullWidth,
      fullHeight,
      clamped.sx,
      clamped.sy,
      cell
    )
    if (p + 1 < passes) snapshotCell(data, fullWidth, cell, scratch)
  }
}

/** Nested scale-copy tunnel inside the Cell (uses scratch of current pixels). */
function applyRecursiveSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  edgeClamp: boolean,
  decay: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const amountClamped = clampAmount(amount)
  const smear = (amountClamped / 100) * decay
  if (smear <= 0) {
    if (!edgeClamp) {
      copyCellBaselineClean(data, fullWidth, fullHeight, cell)
    }
    return
  }
  if (width < 4 || height < 4) return

  const passes = 1 + Math.floor(smear * 4)
  const scratch = ensureSmearScratch(width * height * 4)

  for (let p = 0; p < passes; p++) {
    snapshotCell(data, fullWidth, cell, scratch)

    const scale = 0.72 - p * 0.04 * smear
    const innerW = Math.max(2, Math.floor(width * scale))
    const innerH = Math.max(2, Math.floor(height * scale))
    const ox = ((width - innerW) / 2) | 0
    const oy = ((height - innerH) / 2) | 0

    for (let row = 0; row < innerH; row++) {
      const srcY = Math.min(height - 1, ((row * height) / innerH) | 0)
      const dstY = cell.y + oy + row
      for (let col = 0; col < innerW; col++) {
        const srcX = Math.min(width - 1, ((col * width) / innerW) | 0)
        const src = (srcY * width + srcX) * 4
        const dst = (dstY * fullWidth + (cell.x + ox + col)) * 4
        data[dst] = scratch[src]
        data[dst + 1] = scratch[src + 1]
        data[dst + 2] = scratch[src + 2]
        data[dst + 3] = scratch[src + 3]
      }
    }
  }
}

/**
 * Apply all enabled smear styles to one ON Cell, cumulatively.
 * Caller must already have seeded the Cell's pixels in `data`.
 * Independent sequential ifs — never if/else if between styles.
 * Each style also needs its own weight coin-flip to pass.
 * `decay` scales smear shift intensity only (not weight probabilities).
 */
export function applySmearStyles(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  settings: EffectSettings,
  decay = 1
) {
  const seed = settings.seed >>> 0
  const edgeClamp = settings.edgeClamp
  const smearDecay = Number.isFinite(decay) ? Math.max(0, decay) : 1

  if (
    settings.smearVertical.enabled &&
    passesSmearWeight(
      cell,
      seed,
      SMEAR_WEIGHT_SALT.vertical,
      settings.verticalWeight
    )
  ) {
    applyVerticalSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearVertical.amount,
      edgeClamp,
      smearDecay
    )
  }
  if (
    settings.smearHorizontal.enabled &&
    passesSmearWeight(
      cell,
      seed,
      SMEAR_WEIGHT_SALT.horizontal,
      settings.horizontalWeight
    )
  ) {
    applyHorizontalSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearHorizontal.amount,
      seed,
      edgeClamp,
      smearDecay
    )
  }
  if (
    settings.smearDiagonal.enabled &&
    passesSmearWeight(
      cell,
      seed,
      SMEAR_WEIGHT_SALT.diagonal,
      settings.diagonalWeight
    )
  ) {
    applyDiagonalSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearDiagonal.amount,
      seed,
      edgeClamp,
      smearDecay
    )
  }
  if (
    settings.smearRecursive.enabled &&
    passesSmearWeight(
      cell,
      seed,
      SMEAR_WEIGHT_SALT.recursive,
      settings.recursiveWeight
    )
  ) {
    applyRecursiveSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearRecursive.amount,
      edgeClamp,
      smearDecay
    )
  }
}
