/**
 * Phase 1 square-floor packing — shared by the effect worker and regression checks.
 * Do not retune FLOOR_TUNING here without an explicit packing task.
 *
 * Terminology:
 * - Cell: structural Mondrian block of the layout grid.
 * - baseCellSize: grid unit measured in pixels.
 * - Pixel: a raw sample coordinate from the uploaded source image.
 */

import type {
  CachedCell,
  CachedLayout,
  EffectSettings,
  LayoutParams,
} from "@/lib/effect-types"

/** Bump when layout / composite semantics change. */
const LAYOUT_CACHE_VERSION = 22

/**
 * Structural floor minimum in Cell size units (grid spans).
 * 1×1 cleanup still guarantees full coverage.
 */
const STRUCTURAL_MIN_CELL_SIZE = 1

/**
 * Resolution-aware base grid scale in pixels.
 * Targets ~100 Cell units across the longest edge
 * (10 pixel units at ~1000px source).
 */
export function computeBaseCellSize(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) / 100))
}

/**
 * Phase 1 floor packing — Version 1 tuning knobs.
 * Spans are in Cell size units; absolute ranges are clamped to UI max cell size.
 * Locked to the former neutral size-bias (50) baseline.
 */
const FLOOR_TUNING = {
  anchorCountMin: 3,
  anchorCountMax: 5,
  /** Preferred minimum center-to-center distance between large anchors (grid units). */
  anchorMinSeparation: 8,
  /** Lower fraction of [STRUCTURAL_MIN_CELL_SIZE, maxCellSize] used for large anchor sizes. */
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

export type Phase1GeometryCell = {
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
  const maxCellSize = Math.max(
    STRUCTURAL_MIN_CELL_SIZE,
    Math.min(20, Number(settings.maxCellSize) || STRUCTURAL_MIN_CELL_SIZE)
  )
  const layoutMode =
    settings.layoutMode === "subdivision" ? "subdivision" : "standard"
  const subdivisionMode =
    settings.subdivisionMode === "global" ? "global" : "frontier"
  return {
    layoutVersion: LAYOUT_CACHE_VERSION,
    seed: settings.seed,
    randomSample: settings.randomSample,
    maxCellSize,
    baseCellSize: computeBaseCellSize(sourceWidth, sourceHeight),
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
    a.randomSample === b.randomSample &&
    a.maxCellSize === b.maxCellSize &&
    a.baseCellSize === b.baseCellSize &&
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

function deriveSpanTiers(maxCellSize: number): {
  large: SpanTier
} {
  const spanMin = STRUCTURAL_MIN_CELL_SIZE
  const spanMax = Math.max(spanMin, maxCellSize)
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
  cells: FloorSquare[],
  gridWidth: number,
  gx: number,
  gy: number,
  span: number
) {
  markSquareClaimed(claimed, gridWidth, gx, gy, span)
  cells.push({ gx, gy, span })
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
  cells: FloorSquare[],
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
      placeSquare(claimed, cells, gridWidth, gx, gy, span)
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
 * Preferred band [STRUCTURAL_MIN_CELL_SIZE, maxCellSize] is exhausted first
 * (largest → smallest). Sizes below the preferred floor (still ≥ 2) may appear
 * in a later pass; 1×1 cleanup remains the final fallback.
 */
function fillRemainingProgressive(
  claimed: Uint8Array,
  cells: FloorSquare[],
  gridWidth: number,
  gridHeight: number,
  maxCellSize: number,
  rng: () => number
) {
  if (maxCellSize < 2) return

  const preferredMin = STRUCTURAL_MIN_CELL_SIZE
  const preferredMax = Math.max(preferredMin, maxCellSize)
  const absoluteMinSpan = 2

  // Preferred composition: finish each size completely before stepping down.
  for (let span = preferredMax; span >= Math.max(absoluteMinSpan, preferredMin); span--) {
    fillExactSizePass(claimed, cells, gridWidth, gridHeight, span, rng)
  }

  // Below-preferred fallback only after preferred sizes are exhausted.
  const fallbackTop = Math.max(absoluteMinSpan, preferredMin) - 1
  for (let span = Math.min(preferredMax, fallbackTop); span >= absoluteMinSpan; span--) {
    fillExactSizePass(claimed, cells, gridWidth, gridHeight, span, rng)
  }
}

/** One global pass: shuffle empty origins and place as many exact `span` squares as fit. */
function fillExactSizePass(
  claimed: Uint8Array,
  cells: FloorSquare[],
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
    placeSquare(claimed, cells, gridWidth, gx, gy, span)
  }
}

function fillOneByOneCleanup(
  claimed: Uint8Array,
  cells: FloorSquare[],
  gridWidth: number,
  gridHeight: number
) {
  for (let gy = 0; gy < gridHeight; gy++) {
    const row = gy * gridWidth
    for (let gx = 0; gx < gridWidth; gx++) {
      if (claimed[row + gx] === 0) {
        placeSquare(claimed, cells, gridWidth, gx, gy, 1)
      }
    }
  }
}

export function gridDimensions(
  width: number,
  height: number,
  baseCellSize = computeBaseCellSize(width, height)
) {
  return {
    gridWidth: Math.max(1, Math.ceil(width / baseCellSize)),
    gridHeight: Math.max(1, Math.ceil(height / baseCellSize)),
    baseCellSize,
  }
}

/** Phase 1 invariant: every grid unit is claimed exactly once before masking. */
export function verifyFloorCoverage(
  cells: FloorSquare[],
  gridWidth: number,
  gridHeight: number
) {
  const claimed = new Uint8Array(gridWidth * gridHeight)
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i]
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

/** Clamp a Cell rectangle so it stays inside the pixel bounds. */
function clampCellToPixels(
  x: number,
  y: number,
  widthPixels: number,
  heightPixels: number,
  imageWidth: number,
  imageHeight: number
) {
  let w = widthPixels
  let h = heightPixels
  if (x + w > imageWidth) w = imageWidth - x
  if (y + h > imageHeight) h = imageHeight - y
  return { x, y, width: w, height: h }
}

export function verifyPixelCoverage(
  layout: Array<Phase1GeometryCell>,
  imageWidth: number,
  imageHeight: number
) {
  // Full-frame coverage scan is O(W×H); keep it in non-production builds only.
  if (process.env.NODE_ENV === "production") return

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
      throw new Error(`Phase 1 pixel gap at (${x}, ${y})`)
    }
  }
}

export function layoutGeometrySignature(
  layout: Array<Phase1GeometryCell>
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
  maxCellSize: number,
  seed: number
): FloorSquare[] {
  const claimed = new Uint8Array(gridWidth * gridHeight)
  const cells: FloorSquare[] = []
  const rng = createSeededRng(seed ^ 0xa341316c)
  const tiers = deriveSpanTiers(maxCellSize)

  placeLargeAnchors(claimed, cells, gridWidth, gridHeight, tiers.large, rng)
  fillRemainingProgressive(
    claimed,
    cells,
    gridWidth,
    gridHeight,
    maxCellSize,
    rng
  )
  fillOneByOneCleanup(claimed, cells, gridWidth, gridHeight)
  verifyFloorCoverage(cells, gridWidth, gridHeight)

  return cells
}

function buildLayoutFromFloor(
  raw: FloorSquare[],
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number,
  baseCellSize: number
): CachedCell[] {
  const seed = settings.seed >>> 0
  const attrSeed = (seed ^ 0x9e3779b9) >>> 0
  const sampleSeed = (seed ^ 0x85ebca6b) >>> 0
  const randomSample = settings.randomSample
  const cells: CachedCell[] = []

  for (let i = 0; i < raw.length; i++) {
    const part = raw[i]
    const size = part.span * baseCellSize
    const originX = part.gx * baseCellSize
    const originY = part.gy * baseCellSize
    const clamped = clampCellToPixels(
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
    if (randomSample) {
      const maxSx = imageWidth - clamped.width
      const maxSy = imageHeight - clamped.height
      sx =
        (hash2D(part.gx, part.gy, sampleSeed) * ((maxSx > 0 ? maxSx : 0) + 1)) |
        0
      sy =
        (hash2D(part.gx + 17, part.gy + 31, sampleSeed) *
          ((maxSy > 0 ? maxSy : 0) + 1)) |
        0
    } else {
      sx = clamped.x
      sy = clamped.y
    }

    cells.push({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height,
      sx,
      sy,
      randomVal: hash2D(part.gx, part.gy, attrSeed),
    })
  }

  return cells
}

function makeSubdivisionCell(
  x: number,
  y: number,
  width: number,
  height: number,
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number,
  attrSeed: number,
  sampleSeed: number
): CachedCell | null {
  if (width < 1 || height < 1) return null

  let sx: number
  let sy: number
  if (settings.randomSample) {
    const maxSx = imageWidth - width
    const maxSy = imageHeight - height
    sx = (hash2D(x, y, sampleSeed) * ((maxSx > 0 ? maxSx : 0) + 1)) | 0
    sy =
      (hash2D(x + 17, y + 31, sampleSeed) * ((maxSy > 0 ? maxSy : 0) + 1)) | 0
  } else {
    sx = x
    sy = y
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
 * Split one Cell into four quadrants.
 * Uses floor/ceil-style remainders so odd widths/heights never leave gaps.
 */
function subdivideCellIntoQuadrants(
  cell: CachedCell,
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number,
  attrSeed: number,
  sampleSeed: number
): CachedCell[] {
  const leftW = Math.floor(cell.width / 2)
  const rightW = Math.ceil(cell.width / 2)
  const topH = Math.floor(cell.height / 2)
  const bottomH = Math.ceil(cell.height / 2)

  const rects = [
    { x: cell.x, y: cell.y, width: leftW, height: topH },
    { x: cell.x + leftW, y: cell.y, width: rightW, height: topH },
    { x: cell.x, y: cell.y + topH, width: leftW, height: bottomH },
    {
      x: cell.x + leftW,
      y: cell.y + topH,
      width: rightW,
      height: bottomH,
    },
  ]

  const out: CachedCell[] = []
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const child = makeSubdivisionCell(
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
 * Starts from one full-frame Cell; each loop may split eligible Cells into 4.
 */
function generateSubdivisionLayout(
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number
): CachedCell[] {
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

  const root = makeSubdivisionCell(
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

  // Minimum rate: keep the single full-frame Cell (slider all the way left).
  if (threshold <= 0) return [root]

  let cells: CachedCell[] = [root]
  let frontier: CachedCell[] = [root]

  for (let loop = 0; loop < loops; loop++) {
    const targetPool = mode === "frontier" ? frontier : cells
    const nextFrontier: CachedCell[] = []
    const targetSet = new Set(targetPool)
    const nextCells: CachedCell[] = []

    // Preserve Cells that are not in this loop's target pool (frontier mode).
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      if (!targetSet.has(cell)) nextCells.push(cell)
    }

    for (let i = 0; i < targetPool.length; i++) {
      const cell = targetPool[i]
      // Frontier: always open the root on loop 0 so mid-slider cannot collapse
      // to a single Cell when the first RNG roll fails.
      let shouldSubdivide =
        mode === "frontier" && loop === 0 ? true : rng() < threshold
      // 1×N / N×1 / 1×1 cannot be physically subdivided without gaps/zeros.
      if (cell.width <= 1 || cell.height <= 1) shouldSubdivide = false

      if (shouldSubdivide) {
        const quads = subdivideCellIntoQuadrants(
          cell,
          settings,
          imageWidth,
          imageHeight,
          attrSeed,
          sampleSeed
        )
        for (let q = 0; q < quads.length; q++) {
          nextCells.push(quads[q])
          if (mode === "frontier") nextFrontier.push(quads[q])
        }
      } else {
        nextCells.push(cell)
      }
    }

    cells = nextCells
    if (mode === "frontier") frontier = nextFrontier
  }

  return cells
}

/** Build the complete Phase 1 layout (geometry + stable attrs). */
export function generateLayout(
  settings: EffectSettings,
  imageWidth: number,
  imageHeight: number
): CachedLayout {
  const seed = settings.seed >>> 0
  const { gridWidth, gridHeight, baseCellSize } = gridDimensions(
    imageWidth,
    imageHeight
  )

  if (settings.layoutMode === "subdivision") {
    const cells = generateSubdivisionLayout(
      settings,
      imageWidth,
      imageHeight
    )
    verifyPixelCoverage(cells, imageWidth, imageHeight)
    return { baseCellSize, cells }
  }

  const maxCellSize = Math.max(
    STRUCTURAL_MIN_CELL_SIZE,
    Math.min(20, Number(settings.maxCellSize) || STRUCTURAL_MIN_CELL_SIZE)
  )

  const floor = packSquareFloor(gridWidth, gridHeight, maxCellSize, seed)
  const cells = buildLayoutFromFloor(
    floor,
    settings,
    imageWidth,
    imageHeight,
    baseCellSize
  )
  verifyPixelCoverage(cells, imageWidth, imageHeight)
  return { baseCellSize, cells }
}

export function geometryOnly(
  layout: Array<Phase1GeometryCell>
): Phase1GeometryCell[] {
  return layout.map((p) => ({
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
  }))
}
