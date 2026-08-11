/**
 * Phase 1 square-floor packing — shared by the effect worker and regression checks.
 * Do not retune FLOOR_TUNING here without an explicit packing task.
 *
 * Terminology:
 * - App Pixel: structural Mondrian block (formerly "tile").
 * - basePixelScale: grid unit in photo pixels (formerly "base cell size").
 * - Photo pixel: a raw photographic sample coordinate from the uploaded source.
 */

import type {
  CachedLayout,
  CachedPixel,
  EffectSettings,
  LayoutParams,
} from "@/lib/effect-types"

/** Bump when layout / composite semantics change. */
export const LAYOUT_CACHE_VERSION = 22

/**
 * Structural floor minimum in App Pixel size units (grid spans).
 * 1×1 cleanup still guarantees full coverage.
 */
const STRUCTURAL_MIN_PIXEL_SIZE = 1

/**
 * Resolution-aware base grid scale in photo pixels.
 * Targets ~100 App Pixel units across the longest edge
 * (10 photo-pixel units at ~1000px source).
 */
export function computeBasePixelScale(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) / 100))
}

/**
 * Phase 1 floor packing — Version 1 tuning knobs.
 * Spans are in App Pixel size units; absolute ranges are clamped to UI max pixel size.
 * Locked to the former neutral size-bias (50) baseline.
 */
const FLOOR_TUNING = {
  anchorCountMin: 3,
  anchorCountMax: 5,
  /** Preferred minimum center-to-center distance between large anchors (grid units). */
  anchorMinSeparation: 8,
  /** Lower fraction of [STRUCTURAL_MIN_PIXEL_SIZE, maxPixelSize] used for large anchor sizes. */
  largeSpanFrom: 0.55,
} as const

export type FloorSquare = {
  gx: number
  gy: number
  span: number
}

type SpanTier = {
  minSpan: number
  maxSpan: number
}

export type Phase1GeometryPixel = {
  x: number
  y: number
  width: number
  height: number
}

export function hash2D(ix: number, iy: number, seed: number): number {
  let n = (seed >>> 0) + Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n ^= n >>> 16
  return (n >>> 0) / 4294967296
}

function clampSubdivisionLoops(value: number): number {
  const n = Math.round(Number(value) || 1)
  return Math.max(1, Math.min(7, n))
}

function clampSubdivisionRate(value: number): number {
  const n = Math.round(Number(value) || 60)
  return Math.max(10, Math.min(100, n))
}

export function extractLayoutParams(
  settings: EffectSettings,
  sourceWidth: number,
  sourceHeight: number
): LayoutParams {
  const maxPixelSize = Math.max(
    STRUCTURAL_MIN_PIXEL_SIZE,
    Math.min(20, Number(settings.maxPixelSize) || STRUCTURAL_MIN_PIXEL_SIZE)
  )
  const layoutMode =
    settings.layoutMode === "subdivision" ? "subdivision" : "standard"
  const subdivisionMode =
    settings.subdivisionMode === "global" ? "global" : "frontier"
  return {
    layoutVersion: LAYOUT_CACHE_VERSION,
    seed: settings.seed,
    sampleInPlace: settings.sampleInPlace,
    maxPixelSize,
    basePixelScale: computeBasePixelScale(sourceWidth, sourceHeight),
    sourceWidth,
    sourceHeight,
    layoutMode,
    subdivisionLoops: clampSubdivisionLoops(settings.subdivisionLoops),
    subdivisionMode,
    subdivisionRate: clampSubdivisionRate(settings.subdivisionRate),
  }
}

export function layoutParamsEqual(a: LayoutParams, b: LayoutParams) {
  return (
    a.layoutVersion === b.layoutVersion &&
    a.seed === b.seed &&
    a.sampleInPlace === b.sampleInPlace &&
    a.maxPixelSize === b.maxPixelSize &&
    a.basePixelScale === b.basePixelScale &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight &&
    a.layoutMode === b.layoutMode &&
    a.subdivisionLoops === b.subdivisionLoops &&
    a.subdivisionMode === b.subdivisionMode &&
    a.subdivisionRate === b.subdivisionRate
  )
}

/** Deterministic PRNG for Fisher-Yates / placement (Mulberry32). */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rngInt(rng: () => number, minInclusive: number, maxInclusive: number) {
  if (maxInclusive <= minInclusive) return minInclusive
  return (
    minInclusive +
    Math.floor(rng() * (maxInclusive - minInclusive + 1))
  )
}

function shuffleInPlace<T>(items: T[], rng: () => number) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
}

function deriveSpanTiers(maxPixelSize: number): {
  large: SpanTier
} {
  const spanMin = STRUCTURAL_MIN_PIXEL_SIZE
  const spanMax = Math.max(spanMin, maxPixelSize)
  const range = spanMax - spanMin
  const largeFrom = FLOOR_TUNING.largeSpanFrom

  let lo = spanMin + Math.round(range * largeFrom)
  let hi = spanMax
  if (lo < spanMin) lo = spanMin
  if (hi > spanMax) hi = spanMax
  if (lo > hi) lo = hi

  let large: SpanTier = { minSpan: lo, maxSpan: hi }
  if (large.maxSpan < 2 && spanMax >= 2) {
    large = { minSpan: Math.max(spanMin, spanMax - 1), maxSpan: spanMax }
  }

  return { large }
}

function canPlaceSquare(
  claimed: Uint8Array,
  gridWidth: number,
  gridHeight: number,
  gx: number,
  gy: number,
  span: number
): boolean {
  if (span < 1) return false
  if (gx < 0 || gy < 0) return false
  if (gx + span > gridWidth || gy + span > gridHeight) return false
  for (let dy = 0; dy < span; dy++) {
    const row = (gy + dy) * gridWidth + gx
    for (let dx = 0; dx < span; dx++) {
      if (claimed[row + dx] === 1) return false
    }
  }
  return true
}

function markSquareClaimed(
  claimed: Uint8Array,
  gridWidth: number,
  gx: number,
  gy: number,
  span: number
) {
  for (let dy = 0; dy < span; dy++) {
    const row = (gy + dy) * gridWidth + gx
    for (let dx = 0; dx < span; dx++) {
      claimed[row + dx] = 1
    }
  }
}

/** Largest span in [minSpan, maxSpan] that fits at (gx, gy), or 0 if none. */
function largestFittingSpan(
  claimed: Uint8Array,
  gridWidth: number,
  gridHeight: number,
  gx: number,
  gy: number,
  minSpan: number,
  maxSpan: number
): number {
  const fitLimit = Math.min(maxSpan, gridWidth - gx, gridHeight - gy)
  for (let span = fitLimit; span >= minSpan; span--) {
    if (canPlaceSquare(claimed, gridWidth, gridHeight, gx, gy, span)) {
      return span
    }
  }
  return 0
}

function collectCandidateOrigins(
  claimed: Uint8Array,
  gridWidth: number,
  gridHeight: number,
  minSpan: number
): Array<{ gx: number; gy: number }> {
  const candidates: Array<{ gx: number; gy: number }> = []
  const maxGx = gridWidth - minSpan
  const maxGy = gridHeight - minSpan
  if (maxGx < 0 || maxGy < 0) return candidates

  for (let gy = 0; gy <= maxGy; gy++) {
    const row = gy * gridWidth
    for (let gx = 0; gx <= maxGx; gx++) {
      if (claimed[row + gx] === 0) {
        candidates.push({ gx, gy })
      }
    }
  }
  return candidates
}

function placeSquare(
  claimed: Uint8Array,
  pixels: FloorSquare[],
  gridWidth: number,
  gx: number,
  gy: number,
  span: number
) {
  markSquareClaimed(claimed, gridWidth, gx, gy, span)
  pixels.push({ gx, gy, span })
}

function anchorsTooClose(
  anchors: FloorSquare[],
  gx: number,
  gy: number,
  span: number,
  minSeparation: number
): boolean {
  const cx = gx + span * 0.5
  const cy = gy + span * 0.5
  const minDist = minSeparation
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const ax = a.gx + a.span * 0.5
    const ay = a.gy + a.span * 0.5
    const dx = cx - ax
    const dy = cy - ay
    if (dx * dx + dy * dy < minDist * minDist) return true
  }
  return false
}

function placeLargeAnchors(
  claimed: Uint8Array,
  pixels: FloorSquare[],
  gridWidth: number,
  gridHeight: number,
  tier: SpanTier,
  rng: () => number
) {
  const targetCount = rngInt(
    rng,
    FLOOR_TUNING.anchorCountMin,
    FLOOR_TUNING.anchorCountMax
  )

  const candidates = collectCandidateOrigins(
    claimed,
    gridWidth,
    gridHeight,
    tier.minSpan
  )
  shuffleInPlace(candidates, rng)

  const anchors: FloorSquare[] = []
  let separation: number = FLOOR_TUNING.anchorMinSeparation

  const tryPass = (enforceSeparation: boolean) => {
    for (let i = 0; i < candidates.length && anchors.length < targetCount; i++) {
      const { gx, gy } = candidates[i]
      if (claimed[gy * gridWidth + gx] === 1) continue
      const span = largestFittingSpan(
        claimed,
        gridWidth,
        gridHeight,
        gx,
        gy,
        tier.minSpan,
        tier.maxSpan
      )
      if (span < tier.minSpan) continue
      if (
        enforceSeparation &&
        anchorsTooClose(anchors, gx, gy, span, separation)
      ) {
        continue
      }
      placeSquare(claimed, pixels, gridWidth, gx, gy, span)
      anchors.push({ gx, gy, span })
    }
  }

  tryPass(true)
  // Relax spacing rather than failing when the grid is tight.
  while (anchors.length < targetCount && separation > 0) {
    separation = Math.max(0, separation - 2)
    tryPass(separation > 0)
  }
  if (anchors.length < targetCount) {
    tryPass(false)
  }
}

/**
 * After anchors: fill leftover space with global exact-size passes.
 *
 * Preferred band [STRUCTURAL_MIN_PIXEL_SIZE, maxPixelSize] is exhausted first
 * (largest → smallest). Sizes below the preferred floor (still ≥ 2) may appear
 * in a later pass; 1×1 cleanup remains the final fallback.
 */
function fillRemainingProgressive(
  claimed: Uint8Array,
  pixels: FloorSquare[],
  gridWidth: number,
  gridHeight: number,
  maxPixelSize: number,
  rng: () => number
) {
  if (maxPixelSize < 2) return

  const preferredMin = STRUCTURAL_MIN_PIXEL_SIZE
  const preferredMax = Math.max(preferredMin, maxPixelSize)
  const absoluteMinSpan = 2

  // Preferred composition: finish each size completely before stepping down.
  for (let span = preferredMax; span >= Math.max(absoluteMinSpan, preferredMin); span--) {
    fillExactSizePass(claimed, pixels, gridWidth, gridHeight, span, rng)
  }

  // Below-preferred fallback only after preferred sizes are exhausted.
  const fallbackTop = Math.max(absoluteMinSpan, preferredMin) - 1
  for (let span = Math.min(preferredMax, fallbackTop); span >= absoluteMinSpan; span--) {
    fillExactSizePass(claimed, pixels, gridWidth, gridHeight, span, rng)
  }
}

/** One global pass: shuffle empty origins and place as many exact `span` squares as fit. */
function fillExactSizePass(
  claimed: Uint8Array,
  pixels: FloorSquare[],
  gridWidth: number,
  gridHeight: number,
  span: number,
  rng: () => number
) {
  if (span < 2) return

  const candidates = collectCandidateOrigins(
    claimed,
    gridWidth,
    gridHeight,
    span
  )
  if (candidates.length === 0) return

  shuffleInPlace(candidates, rng)

  for (let i = 0; i < candidates.length; i++) {
    const { gx, gy } = candidates[i]
    if (claimed[gy * gridWidth + gx] === 1) continue
    if (!canPlaceSquare(claimed, gridWidth, gridHeight, gx, gy, span)) continue
    placeSquare(claimed, pixels, gridWidth, gx, gy, span)
  }
}

function fillOneByOneCleanup(
  claimed: Uint8Array,
  pixels: FloorSquare[],
  gridWidth: number,
  gridHeight: number
) {
  for (let gy = 0; gy < gridHeight; gy++) {
    const row = gy * gridWidth
    for (let gx = 0; gx < gridWidth; gx++) {
      if (claimed[row + gx] === 0) {
        placeSquare(claimed, pixels, gridWidth, gx, gy, 1)
      }
    }
  }
}

export function gridDimensions(
  width: number,
  height: number,
  basePixelScale = computeBasePixelScale(width, height)
) {
  return {
    gridWidth: Math.max(1, Math.ceil(width / basePixelScale)),
    gridHeight: Math.max(1, Math.ceil(height / basePixelScale)),
    basePixelScale,
  }
}

/** Phase 1 invariant: every grid unit is claimed exactly once before masking. */
export function verifyFloorCoverage(
  pixels: FloorSquare[],
  gridWidth: number,
  gridHeight: number
) {
  const claimed = new Uint8Array(gridWidth * gridHeight)
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]
    for (let dy = 0; dy < p.span; dy++) {
      const row = (p.gy + dy) * gridWidth + p.gx
      for (let dx = 0; dx < p.span; dx++) {
        const idx = row + dx
        if (claimed[idx] === 1) {
          throw new Error(
            `Phase 1 floor overlap at grid (${p.gx + dx}, ${p.gy + dy})`
          )
        }
        claimed[idx] = 1
      }
    }
  }
  for (let i = 0; i < claimed.length; i++) {
    if (claimed[i] === 0) {
      const gx = i % gridWidth
      const gy = (i / gridWidth) | 0
      throw new Error(`Phase 1 floor gap at grid (${gx}, ${gy})`)
    }
  }
}

/** Clamp an App Pixel rectangle so it stays inside the photo-pixel bounds. */
function clampPixelToPhotoPixels(
  x: number,
  y: number,
  widthPhotoPixels: number,
  heightPhotoPixels: number,
  imageWidth: number,
  imageHeight: number
) {
  let w = widthPhotoPixels
  let h = heightPhotoPixels
  if (x + w > imageWidth) w = imageWidth - x
  if (y + h > imageHeight) h = imageHeight - y
  return { x, y, width: w, height: h }
}

export function verifyPhotoPixelCoverage(
  layout: Array<Phase1GeometryPixel>,
  imageWidth: number,
  imageHeight: number
) {
  const covered = new Uint8Array(imageWidth * imageHeight)
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i]
    for (let y = p.y; y < p.y + p.height; y++) {
      const row = y * imageWidth
      for (let x = p.x; x < p.x + p.width; x++) {
        covered[row + x] = 1
      }
    }
  }
  for (let i = 0; i < covered.length; i++) {
    if (covered[i] === 0) {
      const x = i % imageWidth
      const y = (i / imageWidth) | 0
      throw new Error(`Phase 1 photo-pixel gap at (${x}, ${y})`)
    }
  }
}

export function layoutGeometrySignature(
  layout: Array<Phase1GeometryPixel>
): string {
  const parts = new Array(layout.length)
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i]
    parts[i] = `${p.x},${p.y},${p.width},${p.height}`
  }
  parts.sort()
  return parts.join("|")
}

export function packSquareFloor(
  gridWidth: number,
  gridHeight: number,
  maxPixelSize: number,
  seed: number
): FloorSquare[] {
  const claimed = new Uint8Array(gridWidth * gridHeight)
  const pixels: FloorSquare[] = []
  const rng = createSeededRng(seed ^ 0xa341316c)
  const tiers = deriveSpanTiers(maxPixelSize)

  placeLargeAnchors(claimed, pixels, gridWidth, gridHeight, tiers.large, rng)
  fillRemainingProgressive(
    claimed,
    pixels,
    gridWidth,
    gridHeight,
    maxPixelSize,
    rng
  )
  fillOneByOneCleanup(claimed, pixels, gridWidth, gridHeight)
  verifyFloorCoverage(pixels, gridWidth, gridHeight)

  return pixels
}

export function buildLayoutFromFloor(
  raw: FloorSquare[],
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number,
  basePixelScale: number
): CachedPixel[] {
  const seed = settings.seed >>> 0
  const attrSeed = (seed ^ 0x9e3779b9) >>> 0
  const sampleSeed = (seed ^ 0x85ebca6b) >>> 0
  const sampleInPlace = settings.sampleInPlace
  const pixels: CachedPixel[] = []

  for (let i = 0; i < raw.length; i++) {
    const part = raw[i]
    const size = part.span * basePixelScale
    const originX = part.gx * basePixelScale
    const originY = part.gy * basePixelScale
    const clamped = clampPixelToPhotoPixels(
      originX,
      originY,
      size,
      size,
      imageWidth,
      imageHeight
    )
    if (clamped.width < 1 || clamped.height < 1) continue

    let sx: number
    let sy: number
    if (sampleInPlace) {
      sx = clamped.x
      sy = clamped.y
    } else {
      const maxSx = imageWidth - clamped.width
      const maxSy = imageHeight - clamped.height
      sx =
        (hash2D(part.gx, part.gy, sampleSeed) * ((maxSx > 0 ? maxSx : 0) + 1)) |
        0
      sy =
        (hash2D(part.gx + 17, part.gy + 31, sampleSeed) *
          ((maxSy > 0 ? maxSy : 0) + 1)) |
        0
    }

    pixels.push({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height,
      sx,
      sy,
      randomVal: hash2D(part.gx, part.gy, attrSeed),
    })
  }

  return pixels
}

function makeSubdivisionPixel(
  x: number,
  y: number,
  width: number,
  height: number,
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number,
  attrSeed: number,
  sampleSeed: number
): CachedPixel | null {
  if (width < 1 || height < 1) return null

  let sx: number
  let sy: number
  if (settings.sampleInPlace) {
    sx = x
    sy = y
  } else {
    const maxSx = imageWidth - width
    const maxSy = imageHeight - height
    sx = (hash2D(x, y, sampleSeed) * ((maxSx > 0 ? maxSx : 0) + 1)) | 0
    sy =
      (hash2D(x + 17, y + 31, sampleSeed) * ((maxSy > 0 ? maxSy : 0) + 1)) | 0
  }

  return {
    x,
    y,
    width,
    height,
    sx,
    sy,
    randomVal: hash2D(x, y, attrSeed),
  }
}

/**
 * Split one Pixel into four quadrants.
 * Uses floor/ceil-style remainders so odd widths/heights never leave gaps.
 */
function subdividePixelIntoQuadrants(
  pixel: CachedPixel,
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number,
  attrSeed: number,
  sampleSeed: number
): CachedPixel[] {
  const leftW = Math.floor(pixel.width / 2)
  const rightW = Math.ceil(pixel.width / 2)
  const topH = Math.floor(pixel.height / 2)
  const bottomH = Math.ceil(pixel.height / 2)

  const rects = [
    { x: pixel.x, y: pixel.y, width: leftW, height: topH },
    { x: pixel.x + leftW, y: pixel.y, width: rightW, height: topH },
    { x: pixel.x, y: pixel.y + topH, width: leftW, height: bottomH },
    {
      x: pixel.x + leftW,
      y: pixel.y + topH,
      width: rightW,
      height: bottomH,
    },
  ]

  const out: CachedPixel[] = []
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const child = makeSubdivisionPixel(
      r.x,
      r.y,
      r.width,
      r.height,
      settings,
      imageWidth,
      imageHeight,
      attrSeed,
      sampleSeed
    )
    if (child) out.push(child)
  }
  return out
}

/**
 * V2 Phase 1: recursive quadrant subdivision with probabilistic splits.
 * Starts from one full-frame Pixel; each loop may split eligible Pixels into 4.
 */
function generateSubdivisionLayout(
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number
): CachedPixel[] {
  const seed = settings.seed >>> 0
  const attrSeed = (seed ^ 0x9e3779b9) >>> 0
  const sampleSeed = (seed ^ 0x85ebca6b) >>> 0
  const rng = createSeededRng(seed ^ 0xc2b2ae35)
  const loops = clampSubdivisionLoops(settings.subdivisionLoops)
  const mode =
    settings.subdivisionMode === "global" ? "global" : "frontier"
  const rate = clampSubdivisionRate(settings.subdivisionRate)
  // Map UI 10→0 and 100→1 so the left end is "no splits", not mid-slider.
  const threshold = (rate - 10) / 90

  const root = makeSubdivisionPixel(
    0,
    0,
    imageWidth,
    imageHeight,
    settings,
    imageWidth,
    imageHeight,
    attrSeed,
    sampleSeed
  )
  if (!root) return []

  // Minimum rate: keep the single full-frame Pixel (slider all the way left).
  if (threshold <= 0) return [root]

  let pixels: CachedPixel[] = [root]
  let frontier: CachedPixel[] = [root]

  for (let loop = 0; loop < loops; loop++) {
    const targetPool = mode === "frontier" ? frontier : pixels
    const nextFrontier: CachedPixel[] = []
    const targetSet = new Set(targetPool)
    const nextPixels: CachedPixel[] = []

    // Preserve Pixels that are not in this loop's target pool (frontier mode).
    for (let i = 0; i < pixels.length; i++) {
      const pixel = pixels[i]
      if (!targetSet.has(pixel)) nextPixels.push(pixel)
    }

    for (let i = 0; i < targetPool.length; i++) {
      const pixel = targetPool[i]
      // Frontier: always open the root on loop 0 so mid-slider cannot collapse
      // to a single Pixel when the first RNG roll fails.
      let shouldSubdivide =
        mode === "frontier" && loop === 0 ? true : rng() < threshold
      // 1×N / N×1 / 1×1 cannot be physically subdivided without gaps/zeros.
      if (pixel.width <= 1 || pixel.height <= 1) shouldSubdivide = false

      if (shouldSubdivide) {
        const quads = subdividePixelIntoQuadrants(
          pixel,
          settings,
          imageWidth,
          imageHeight,
          attrSeed,
          sampleSeed
        )
        for (let q = 0; q < quads.length; q++) {
          nextPixels.push(quads[q])
          if (mode === "frontier") nextFrontier.push(quads[q])
        }
      } else {
        nextPixels.push(pixel)
      }
    }

    pixels = nextPixels
    if (mode === "frontier") frontier = nextFrontier
  }

  return pixels
}

/** Build the complete Phase 1 layout (geometry + stable attrs). */
export function generateLayout(
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number
): CachedLayout {
  const seed = settings.seed >>> 0
  const { gridWidth, gridHeight, basePixelScale } = gridDimensions(
    imageWidth,
    imageHeight
  )

  if (settings.layoutMode === "subdivision") {
    const pixels = generateSubdivisionLayout(
      settings,
      imageWidth,
      imageHeight
    )
    verifyPhotoPixelCoverage(pixels, imageWidth, imageHeight)
    return { basePixelScale, pixels }
  }

  const maxPixelSize = Math.max(
    STRUCTURAL_MIN_PIXEL_SIZE,
    Math.min(20, Number(settings.maxPixelSize) || STRUCTURAL_MIN_PIXEL_SIZE)
  )

  const floor = packSquareFloor(gridWidth, gridHeight, maxPixelSize, seed)
  const pixels = buildLayoutFromFloor(
    floor,
    settings,
    imageWidth,
    imageHeight,
    basePixelScale
  )
  verifyPhotoPixelCoverage(pixels, imageWidth, imageHeight)
  return { basePixelScale, pixels }
}

export function geometryOnly(
  layout: Array<Phase1GeometryPixel>
): Phase1GeometryPixel[] {
  return layout.map((p) => ({
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
  }))
}
