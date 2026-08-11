/**
 * Composite-time smear style family.
 * Does not affect Phase 1 layout or Phase 2 mask decisions.
 *
 * Fixed combine order (when multiple are enabled):
 * 1. Vertical
 * 2. Horizontal
 * 3. Diagonal
 * 4. Drift
 * 5. Recursive
 * 6. Strip Feedback
 *
 * All region ops respect rectangular Cell bounds (width × height),
 * including edge-clamped non-square Cells.
 */

import type {
  CachedCell,
  EffectSettings,
} from "@/lib/effect-types"
import { hash2D } from "@/lib/phase1-floor"

/** Reused scratch for cell-local ops (recursive / strip / clean). */
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

/** Deterministic 0–1 value for a cell + salt. */
function cellUnit(
  cell: CachedCell,
  seed: number,
  salt: number
): number {
  return hash2D(cell.x + salt * 17, cell.y + salt * 31, seed >>> 0)
}

/** In-place overlapping blit (unsafe self-feedback when src∩dest). Vertical core. */
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

/** Amount 0 baseline: clean sample → Cell (no smear feedback). */
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

/**
 * Vertical — overlapping-blit smear.
 * Amount 0 = clean sample copy; 1–100 scales intensity (100 matches former max).
 * Core overlapping blit path is unchanged — only the slider mapping changed.
 */
function applyVerticalSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const amountClamped = clampAmount(amount)
  let sx = cell.sx
  let sy = cell.sy

  if (amountClamped === 0) {
    const clamped = clampSampleOrigin(
      sx,
      sy,
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
    return
  }

  // Former max used enhance=1 at amount 100; map full slider onto that range.
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
  sx = clamped.sx
  sy = clamped.sy

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

function applyHorizontalSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  seed: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 2 || height < 1) return

  const amountClamped = clampAmount(amount)
  let sx = cell.sx
  let sy = cell.sy

  if (amountClamped === 0) {
    const clamped = clampSampleOrigin(
      sx,
      sy,
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
    return
  }

  // Intensity 0→1 across 1–100; at 100 matches former max (old enhance at amount 100).
  const enhance = amountClamped / 100
  const rightToLeft = cellUnit(cell, seed, 101) >= 0.5

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
  sx = clamped.sx
  sy = clamped.sy

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
}

function applyDiagonalSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  seed: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 2 || height < 2) return

  const amountClamped = clampAmount(amount)
  let sx = cell.sx
  let sy = cell.sy

  if (amountClamped === 0) {
    const clamped = clampSampleOrigin(
      sx,
      sy,
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
    return
  }

  const dir = (cellUnit(cell, seed, 202) * 4) | 0 // 0..3
  // 0 down-right, 1 down-left, 2 up-right, 3 up-left
  const signX = dir === 0 || dir === 2 ? -1 : 1 // source opposite to cascade
  const signY = dir === 0 || dir === 1 ? -1 : 1

  // Intensity 0→1 across 1–100; at 100 matches former max (old enhance at amount 100).
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
  sx = clamped.sx
  sy = clamped.sy

  const passes = 1 + Math.floor(enhance * 3)
  // Diagonal feedback: scan in cascade direction.
  const xForward = signX < 0 // source left of dest → scan LTR
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
}

function applyDriftSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  seed: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const amountClamped = clampAmount(amount)
  if (amountClamped === 0) {
    copyCellBaselineClean(data, fullWidth, fullHeight, cell)
    return
  }
  if (width < 2 || height < 2) return

  // Intensity 0→1 across 1–100; at 100 matches former max.
  const smear = amountClamped / 100
  const ang = cellUnit(cell, seed, 303) * Math.PI * 2
  const dirX = Math.cos(ang)
  const dirY = Math.sin(ang)
  const passes = 1 + Math.floor(smear * 5)
  const extent = Math.max(width, height)
  const stepPx = Math.max(1, Math.floor(1 + smear * extent * 0.12))

  for (let p = 0; p < passes; p++) {
    const dist = stepPx * (p + 1)
    const sx = Math.round(cell.x - dirX * dist)
    const sy = Math.round(cell.y - dirY * dist)
    const clamped = clampSampleOrigin(
      sx,
      sy,
      width,
      height,
      fullWidth,
      fullHeight
    )
    // In-place feedback from drifting origin — reads increasingly shifted content.
    copySampleRegion(
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
}

/** Nested scale-copy tunnel inside the cell (uses scratch). */
function applyRecursiveSmear(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const amountClamped = clampAmount(amount)
  if (amountClamped === 0) {
    copyCellBaselineClean(data, fullWidth, fullHeight, cell)
    return
  }
  if (width < 4 || height < 4) return

  // Intensity 0→1 across 1–100; at 100 matches former max.
  const smear = amountClamped / 100
  const passes = 1 + Math.floor(smear * 4)
  const scratch = ensureSmearScratch(width * height * 4)

  for (let p = 0; p < passes; p++) {
    // Snapshot current cell
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

    const scale = 0.72 - p * 0.04 * smear
    const innerW = Math.max(2, Math.floor(width * scale))
    const innerH = Math.max(2, Math.floor(height * scale))
    const ox = ((width - innerW) / 2) | 0
    const oy = ((height - innerH) / 2) | 0

    // Nearest-neighbor scale scratch → centered inside cell (clipped).
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

function applyStripFeedback(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  amount: number,
  seed: number
) {
  const width = cell.width
  const height = cell.height
  if (width < 1 || height < 1) return

  const amountClamped = clampAmount(amount)
  if (amountClamped === 0) {
    copyCellBaselineClean(data, fullWidth, fullHeight, cell)
    return
  }
  if (width < 4 || height < 4) return

  // Intensity 0→1 across 1–100; at 100 matches former max.
  const smear = amountClamped / 100
  const horizontalStrip = cellUnit(cell, seed, 505) >= 0.5
  // Strip thickness: relatively narrow; amount mainly boosts repetitions.
  const thicknessAxis = horizontalStrip ? height : width
  const thickness = Math.max(
    2,
    Math.min(
      thicknessAxis >> 1,
      2 + Math.floor(thicknessAxis * (0.06 + 0.1 * smear))
    )
  )
  const repeats = 2 + Math.floor(smear * 6)

  // Choose strip origin inside the sampleable area (layout sample or cell).
  const baseSx = cell.sx
  const baseSy = cell.sy
  const maxSx = Math.max(0, fullWidth - width)
  const maxSy = Math.max(0, fullHeight - height)

  if (horizontalStrip) {
    const maxBand = Math.max(0, height - thickness)
    const bandY =
      baseSy + Math.floor(cellUnit(cell, seed, 506) * (maxBand + 1))
    const srcY = clampInt(bandY, 0, fullHeight - thickness)
    const srcX = clampInt(baseSx, 0, maxSx)

    // Capture strip into scratch
    const scratch = ensureSmearScratch(thickness * width * 4)
    for (let row = 0; row < thickness; row++) {
      const srcRow = (srcY + row) * fullWidth + srcX
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

    for (let r = 0; r < repeats; r++) {
      const destY =
        cell.y +
        Math.floor(((height - thickness) * r) / Math.max(1, repeats - 1))
      for (let row = 0; row < thickness; row++) {
        const y = destY + row
        if (y < cell.y || y >= cell.y + height) continue
        const tmpRow = row * width
        const dstRow = y * fullWidth + cell.x
        for (let col = 0; col < width; col++) {
          const tmp = (tmpRow + col) * 4
          const dst = (dstRow + col) * 4
          data[dst] = scratch[tmp]
          data[dst + 1] = scratch[tmp + 1]
          data[dst + 2] = scratch[tmp + 2]
          data[dst + 3] = scratch[tmp + 3]
        }
      }
    }
  } else {
    const maxBand = Math.max(0, width - thickness)
    const bandX =
      baseSx + Math.floor(cellUnit(cell, seed, 507) * (maxBand + 1))
    const srcX = clampInt(bandX, 0, fullWidth - thickness)
    const srcY = clampInt(baseSy, 0, maxSy)

    const scratch = ensureSmearScratch(height * thickness * 4)
    for (let row = 0; row < height; row++) {
      const srcRow = (srcY + row) * fullWidth + srcX
      const tmpRow = row * thickness
      for (let col = 0; col < thickness; col++) {
        const src = (srcRow + col) * 4
        const tmp = (tmpRow + col) * 4
        scratch[tmp] = data[src]
        scratch[tmp + 1] = data[src + 1]
        scratch[tmp + 2] = data[src + 2]
        scratch[tmp + 3] = data[src + 3]
      }
    }

    for (let r = 0; r < repeats; r++) {
      const destX =
        cell.x +
        Math.floor(((width - thickness) * r) / Math.max(1, repeats - 1))
      for (let row = 0; row < height; row++) {
        const tmpRow = row * thickness
        const dstRow = (cell.y + row) * fullWidth + destX
        for (let col = 0; col < thickness; col++) {
          const x = destX + col
          if (x < cell.x || x >= cell.x + width) continue
          const tmp = (tmpRow + col) * 4
          const dst = (dstRow + col) * 4
          data[dst] = scratch[tmp]
          data[dst + 1] = scratch[tmp + 1]
          data[dst + 2] = scratch[tmp + 2]
          data[dst + 3] = scratch[tmp + 3]
        }
      }
    }
  }
}

/**
 * Ensure displaced sample content is present when Vertical is off
 * (so later styles still have the intended source patch in the cell).
 */
function ensureBaseSample(
  data: Uint8ClampedArray,
  fullWidth: number,
  cell: CachedCell
) {
  if (cell.sx === cell.x && cell.sy === cell.y) return
  copySampleRegionClean(
    data,
    fullWidth,
    cell.sx,
    cell.sy,
    cell.x,
    cell.y,
    cell.width,
    cell.height
  )
}

/**
 * Apply all enabled smear styles to one ON cell, in the fixed documented order.
 */
export function applySmearStyles(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cell: CachedCell,
  settings: EffectSettings
) {
  const seed = settings.seed >>> 0
  const vertical = settings.smearVertical
  const anyOther =
    settings.smearHorizontal.enabled ||
    settings.smearDiagonal.enabled ||
    settings.smearDrift.enabled ||
    settings.smearRecursive.enabled ||
    settings.smearStrip.enabled

  if (vertical.enabled) {
    applyVerticalSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      vertical.amount
    )
  } else if (anyOther || cell.sx !== cell.x || cell.sy !== cell.y) {
    ensureBaseSample(data, fullWidth, cell)
  }

  if (settings.smearHorizontal.enabled) {
    applyHorizontalSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearHorizontal.amount,
      seed
    )
  }
  if (settings.smearDiagonal.enabled) {
    applyDiagonalSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearDiagonal.amount,
      seed
    )
  }
  if (settings.smearDrift.enabled) {
    applyDriftSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearDrift.amount,
      seed
    )
  }
  if (settings.smearRecursive.enabled) {
    applyRecursiveSmear(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearRecursive.amount
    )
  }
  if (settings.smearStrip.enabled) {
    applyStripFeedback(
      data,
      fullWidth,
      fullHeight,
      cell,
      settings.smearStrip.amount,
      seed
    )
  }
}
