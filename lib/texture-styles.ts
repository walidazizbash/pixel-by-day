/**
 * Post-smear mathematical textures: dither, halftone, pixelate.
 * Applied to already-copied (and possibly smeared) Cell pixels.
 * Does not affect Phase 1 layout, mask, or Color Master assignment.
 */

import type { TextureEffectName } from "@/lib/pipeline"

const PIXELATE_SIZE = 4
const PIXELATE_COLOR_STEPS = 4
/** 1× ramp bin — 6× multiplies this to 36px. */
const HALFTONE_DOT_SIZE = 6

/**
 * Standard 8×8 Bayer ordered-dither thresholds, mapped 0–63 → 0–255 (`n * 4`).
 * Screened per pixel so the pattern is continuous across Cell borders.
 */
const BAYER_8X8 = [
  [0, 128, 32, 160, 8, 136, 40, 168],
  [192, 64, 224, 96, 200, 72, 232, 104],
  [48, 176, 16, 144, 56, 184, 24, 152],
  [240, 112, 208, 80, 248, 120, 216, 88],
  [12, 140, 44, 172, 4, 132, 36, 164],
  [204, 76, 236, 108, 196, 68, 228, 100],
  [60, 188, 28, 156, 52, 180, 20, 148],
  [252, 124, 220, 92, 244, 116, 212, 84],
] as const

/** Light ink for 1-bit Bayer — pale mint green. */
const DITHER_LIGHT_R = 186
const DITHER_LIGHT_G = 219
const DITHER_LIGHT_B = 184

/**
 * 1-bit ordered dither: luminance vs Bayer threshold → black or mint.
 * `scale` magnifies the matrix so a Cell can run chunky 2× / 4× / 8× dots.
 */
function applyDither(
  data: Uint8ClampedArray,
  fullWidth: number,
  cellX: number,
  cellY: number,
  width: number,
  height: number,
  scale: number,
  invert: boolean
) {
  const pixelScale = scale < 1 ? 1 : scale | 0
  for (let localY = 0; localY < height; localY++) {
    const absY = cellY + localY
    const row = absY * fullWidth
    const matrixY = Math.floor(absY / pixelScale) % 8
    for (let localX = 0; localX < width; localX++) {
      const absX = cellX + localX
      const i = (row + absX) * 4
      const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
      const matrixX = Math.floor(absX / pixelScale) % 8
      const threshold = BAYER_8X8[matrixY]![matrixX]!
      const dark = lum < threshold
      const useLight = invert ? dark : !dark
      if (useLight) {
        data[i] = DITHER_LIGHT_R
        data[i + 1] = DITHER_LIGHT_G
        data[i + 2] = DITHER_LIGHT_B
      } else {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
      }
    }
  }
}

function quantizeChannel(value: number, stepFactor: number): number {
  return Math.round(Math.round(value / stepFactor) * stepFactor)
}

function applyPixelate(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  cellX: number,
  cellY: number,
  width: number,
  height: number
) {
  const blockSize = PIXELATE_SIZE
  const colorSteps = PIXELATE_COLOR_STEPS
  const stepFactor = 255 / (colorSteps - 1)
  const cellRight = cellX + width
  const cellBottom = cellY + height

  const blockStartY = cellY - (cellY % blockSize)
  for (let blockY = blockStartY; blockY < cellBottom; blockY += blockSize) {
    const writeEndY = Math.min(blockY + blockSize, cellBottom)

    const blockStartX = cellX - (cellX % blockSize)
    for (let blockX = blockStartX; blockX < cellRight; blockX += blockSize) {
      const writeEndX = Math.min(blockX + blockSize, cellRight)

      const centerX = Math.min(
        fullWidth - 1,
        Math.max(0, blockX + (blockSize >> 1))
      )
      const centerY = Math.min(
        fullHeight - 1,
        Math.max(0, blockY + (blockSize >> 1))
      )
      const centerIndex = (centerY * fullWidth + centerX) * 4

      const r = quantizeChannel(data[centerIndex]!, stepFactor)
      const g = quantizeChannel(data[centerIndex + 1]!, stepFactor)
      const b = quantizeChannel(data[centerIndex + 2]!, stepFactor)

      const writeStartY = Math.max(blockY, cellY)
      const writeStartX = Math.max(blockX, cellX)
      for (let y = writeStartY; y < writeEndY; y++) {
        const row = y * fullWidth
        for (let x = writeStartX; x < writeEndX; x++) {
          const i = (row + x) * 4
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
        }
      }
    }
  }
}

/**
 * Halftone: black dots on white, confined to this Cell's own bounds.
 * Sub-divides the Cell into a fixed-size dot grid; each dot's radius is
 * inversely proportional to that sub-cell's average source luminance
 * (darker → larger dot, up to half the sub-cell size so dots can touch).
 */
function applyHalftone(
  data: Uint8ClampedArray,
  fullWidth: number,
  cellX: number,
  cellY: number,
  width: number,
  height: number,
  scale: number,
  invert: boolean
) {
  const pixelScale = scale < 1 ? 1 : scale | 0
  const dotSize = HALFTONE_DOT_SIZE * pixelScale
  const maxRadius = dotSize / 2
  const cellRight = cellX + width
  const cellBottom = cellY + height

  for (let gy = cellY; gy < cellBottom; gy += dotSize) {
    const gh = Math.min(dotSize, cellBottom - gy)
    for (let gx = cellX; gx < cellRight; gx += dotSize) {
      const gw = Math.min(dotSize, cellRight - gx)

      let sum = 0
      let count = 0
      for (let y = 0; y < gh; y++) {
        const row = (gy + y) * fullWidth
        for (let x = 0; x < gw; x++) {
          const i = (row + gx + x) * 4
          sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
          count++
        }
      }
      if (count === 0) continue

      const lum = sum / count / 255
      const radius = (1 - lum) * maxRadius
      const radiusSq = radius * radius
      const cx = gx + gw / 2
      const cy = gy + gh / 2

      for (let y = 0; y < gh; y++) {
        const py = gy + y
        const dy = py + 0.5 - cy
        const row = py * fullWidth
        for (let x = 0; x < gw; x++) {
          const px = gx + x
          const dx = px + 0.5 - cx
          const i = (row + px) * 4
          const ink = invert ? 255 : 0
          const paper = invert ? 0 : 255
          const v = dx * dx + dy * dy <= radiusSq ? ink : paper
          data[i] = v
          data[i + 1] = v
          data[i + 2] = v
        }
      }
    }
  }
}

/** Apply one post-smear texture to a Cell. Caller must pass a texture effect. */
export function applyTexture(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  effect: TextureEffectName,
  cellX: number,
  cellY: number,
  width: number,
  height: number,
  ditherScale = 1,
  halftoneScale = 1,
  ditherInvert = false,
  halftoneInvert = false
) {
  if (effect === "dither") {
    applyDither(
      data,
      fullWidth,
      cellX,
      cellY,
      width,
      height,
      ditherScale,
      ditherInvert
    )
  } else if (effect === "pixelate") {
    applyPixelate(
      data,
      fullWidth,
      fullHeight,
      cellX,
      cellY,
      width,
      height
    )
  } else if (effect === "halftone") {
    applyHalftone(
      data,
      fullWidth,
      cellX,
      cellY,
      width,
      height,
      halftoneScale,
      halftoneInvert
    )
  }
}
