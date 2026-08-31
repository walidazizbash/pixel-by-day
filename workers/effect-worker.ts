/// <reference lib="webworker" />

/**
 * Hybrid Pipeline.
 *
 *   setSource → eager persistent Color Masters (pass 0)
 *   render    → resolve the Slit Scan master (rebuilt only when SlitScanParams
 *               changed — see resolveSlitScanMaster), then
 *               for i in 0..passes-1:
 *                 layout (cached pass 0; later passes re-layout with seed+i)
 *                 mask → assign → sample Color Master → smear (decay (rate/100)^i)
 *                 post-smear textures (dither / halftone / pixelate)
 *               Passes i>0 use throwaway masters built from the previous frame.
 */

import type {
  CachedLayout,
  CachedCell,
  EffectName,
  EffectSettings,
  EffectWorkerInMessage,
  EffectWorkerOutMessage,
  LayoutParams,
  LivePlayMode,
} from "@/lib/effect-types"
import {
  extractLayoutParams,
  generateLayout,
  hash2D,
  layoutParamsEqual,
} from "@/lib/phase1-floor"
import {
  applyDirectionalSmearPass,
  applyRecursiveSmearPass,
  applySmearStyles,
  type SmearEdge,
} from "@/lib/smear-styles"
import { applyTexture } from "@/lib/texture-styles"
import { sanitizeEffectSettings } from "@/lib/validate-settings"
import {
  buildBaseColorMasters,
  masterForName,
  withSlitScanMaster,
  type BaseColorMasters,
  type ColorMasters,
} from "@/lib/color-masters"
import {
  chooseEffect,
  colorMasterForEffect,
  isTextureEffect,
} from "@/lib/pipeline"
import { THERMAL_DIFFUSE_SCALE } from "@/lib/thermal"
import {
  buildSlitScanMaster,
  clearSlitScanFieldCache,
  extractSlitScanParams,
  slitScanParamsEqual,
  type SlitScanParams,
} from "@/lib/slit-scan"

let cachedSource: ImageBitmap | null = null
let baseMasters: BaseColorMasters | null = null
/**
 * Slit Scan invalidation seam. The master is the one that depends on
 * `EffectSettings`, so it is resolved per render against this key instead of
 * being rebuilt with the rest on `setSource`. A drag that touches nothing in
 * `SlitScanParams` — smear, effect weights, mask, grain — hits the cache and
 * costs nothing, which is what keeps those sliders at frame rate.
 */
let slitScanMaster: Uint8ClampedArray | null = null
let slitScanKey: SlitScanParams | null = null
let cachedLayout: CachedLayout | null = null
let cachedLayoutParams: LayoutParams | null = null
/**
 * Live Play Fixed-mode Cell cache — the scroll-invariant half of Phase 2.
 *
 * Fixed mode scrolls a Cell's contents cyclically, and under `wrap` a
 * directional smear commutes with that rotation. So the expensive part — the
 * Color Master window plus its bilinear smear — depends on the settings alone,
 * not on the offset, and can be computed once and merely rotated per frame.
 *
 * Only that half lives here. Recursive smear and the textures are re-run per
 * frame on top of the rotated block, because neither commutes with a scroll:
 * Recursive is a zoom, and the textures index on absolute canvas coordinates so
 * their pattern must stay pinned to the screen while pixels flow through it.
 *
 * `key` is a full serialization of the settings that produced the entries, so a
 * new field on `EffectSettings` is covered automatically — a hand-written
 * comparison would be one more place to forget, and forgetting means stale
 * pixels on screen.
 */
type FixedCellCache = {
  key: string
  cells: Array<Uint8ClampedArray | null>
}
let fixedCellCache: FixedCellCache | null = null
let activeJobId = 0

let workCanvas: OffscreenCanvas | null = null
let workCtx: OffscreenCanvasRenderingContext2D | null = null
let workWidth = 0
let workHeight = 0
let workImageData: ImageData | null = null

function post(msg: EffectWorkerOutMessage, transfer?: Transferable[]) {
  ;(self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? [])
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = x | 0
  const y0 = y | 0
  const fx = x - x0
  const fy = y - y0
  const u = fade(fx)
  const v = fade(fy)

  const a = hash2D(x0, y0, seed)
  const b = hash2D(x0 + 1, y0, seed)
  const c = hash2D(x0, y0 + 1, seed)
  const d = hash2D(x0 + 1, y0 + 1, seed)

  const n = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  return n * 2 - 1
}

function isStale(jobId: number) {
  return jobId !== activeJobId
}

function throwIfStale(jobId?: number) {
  if (jobId !== undefined && isStale(jobId)) {
    throw new Error("__cancelled__")
  }
}

function clearLayoutCache() {
  cachedLayout = null
  cachedLayoutParams = null
}

function clearFixedCellCache() {
  fixedCellCache = null
}

/**
 * Identity of everything the cached half depends on. Settings cover the layout,
 * the mask, the effect assignment, the smear rolls and the Slit Scan master,
 * since all of those derive from them; the source pixels do not, which is why
 * `setSource` / `clearSource` drop the cache outright.
 */
function fixedCellCacheKey(
  settings: EffectSettings,
  width: number,
  height: number
): string {
  return `${width}x${height}|${JSON.stringify(settings)}`
}

function resolveFixedCellCache(
  settings: EffectSettings,
  width: number,
  height: number,
  cellCount: number
): FixedCellCache {
  const key = fixedCellCacheKey(settings, width, height)
  if (
    fixedCellCache &&
    fixedCellCache.key === key &&
    fixedCellCache.cells.length === cellCount
  ) {
    return fixedCellCache
  }
  fixedCellCache = { key, cells: new Array(cellCount).fill(null) }
  return fixedCellCache
}

/**
 * Hand back the Slit Scan working set: the gathered master and the curl field
 * behind it. Roughly 11.5 MB at a 1200x800 preview, and both rebuild from
 * scratch on the first frame that needs them again.
 */
function releaseSlitScanCaches() {
  slitScanMaster = null
  slitScanKey = null
  clearSlitScanFieldCache()
}

function clearColorMasters() {
  baseMasters = null
  releaseSlitScanCaches()
}

/**
 * Pass-0 Slit Scan master, rebuilt only when `SlitScanParams` actually moved.
 * Gathers from `base.original`, which is a copy of the source pixels, so no
 * separate source buffer has to be retained for this.
 */
function resolveSlitScanMaster(
  base: BaseColorMasters,
  params: SlitScanParams
): Uint8ClampedArray {
  if (slitScanMaster && slitScanKey && slitScanParamsEqual(slitScanKey, params)) {
    return slitScanMaster
  }
  slitScanMaster = buildSlitScanMaster(base.original, params)
  slitScanKey = params
  return slitScanMaster
}

function acquireWorkImageData(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): ImageData {
  if (
    !workImageData ||
    workImageData.width !== width ||
    workImageData.height !== height
  ) {
    workImageData = ctx.createImageData(width, height)
  }
  return workImageData
}

function ensureWorkSurface(width: number, height: number) {
  if (!workCanvas || workWidth !== width || workHeight !== height) {
    workCanvas = new OffscreenCanvas(width, height)
    workCtx = workCanvas.getContext("2d", { willReadFrequently: true })
    workWidth = width
    workHeight = height
  }
  if (!workCtx) throw new Error("Failed to get OffscreenCanvas context")
  return workCtx
}

/**
 * Cheap diffusion: downscale the heat field, bilinear-smooth, scale back up.
 * Used when building a Thermal Color Master (pass 0 eager, later-pass throwaway).
 */
function blurHeatField(
  sharp: Float32Array,
  width: number,
  height: number
): Float32Array {
  const sw = Math.max(1, Math.round(width * THERMAL_DIFFUSE_SCALE))
  const sh = Math.max(1, Math.round(height * THERMAL_DIFFUSE_SCALE))
  const src = new OffscreenCanvas(width, height)
  const srcCtx = src.getContext("2d")
  if (!srcCtx) return sharp

  const img = srcCtx.createImageData(width, height)
  const px = img.data
  for (let i = 0, p = 0; i < sharp.length; i++, p += 4) {
    const g = Math.round(sharp[i]! * 255)
    px[p] = g
    px[p + 1] = g
    px[p + 2] = g
    px[p + 3] = 255
  }
  srcCtx.putImageData(img, 0, 0)

  const small = new OffscreenCanvas(sw, sh)
  const smallCtx = small.getContext("2d")
  if (!smallCtx) return sharp
  smallCtx.imageSmoothingEnabled = true
  smallCtx.imageSmoothingQuality = "low"
  smallCtx.drawImage(src, 0, 0, sw, sh)

  const up = new OffscreenCanvas(width, height)
  const upCtx = up.getContext("2d")
  if (!upCtx) return sharp
  upCtx.imageSmoothingEnabled = true
  upCtx.imageSmoothingQuality = "high"
  upCtx.drawImage(small, 0, 0, width, height)
  const out = upCtx.getImageData(0, 0, width, height).data
  const blurred = new Float32Array(width * height)
  const inv255 = 1 / 255
  for (let i = 0, p = 0; i < blurred.length; i++, p += 4) {
    blurred[i] = out[p]! * inv255
  }
  return blurred
}

function readSourceRgba(
  bitmap: ImageBitmap,
  width: number,
  height: number
): Uint8ClampedArray {
  const ctx = ensureWorkSurface(width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  return new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data)
}

function rebuildColorMasters(bitmap: ImageBitmap) {
  const width = bitmap.width
  const height = bitmap.height
  const sourceRgba = readSourceRgba(bitmap, width, height)
  baseMasters = buildBaseColorMasters(sourceRgba, width, height, blurHeatField)
  // New pixels: the cached Slit Scan master describes the old ones.
  slitScanMaster = null
  slitScanKey = null
}

/** Fixed Phase 2 mask contrast — keeps organic ON/OFF regions sharp. */
const MASK_NOISE_CONTRAST = 1.5

/**
 * Sample the Phase 2 mask for one structural Cell.
 * Uses the Cell's placement (`cell.x` / `cell.y`) so the mask stays blocky
 * at grid resolution — not continuous per-pixel sampling.
 * Returns a boolean to avoid per-cell object allocation.
 */
function sampleCellMask(
  cell: CachedCell,
  settings: EffectSettings,
  baseCellSize: number
): boolean {
  const scale = Math.max(1, baseCellSize)
  const gx = (cell.x + cell.width * 0.5) / scale
  const gy = (cell.y + cell.height * 0.5) / scale

  const uiScale = Math.max(1, Math.min(100, Number(settings.noiseScale) || 1))
  const internalScale = 0.01 + ((uiScale - 1) / 99) * 0.49
  const v = valueNoise2D(
    gx * internalScale,
    gy * internalScale,
    settings.seed >>> 0
  )
  const bound = MASK_NOISE_CONTRAST + 0.01
  const threshold = bound * (1.0 - settings.noiseSpread / 50)

  return v * MASK_NOISE_CONTRAST > threshold
}

function drawCellNoiseMapDebug(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number
) {
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  const cells = layout.cells
  const baseCellSize = layout.baseCellSize
  ctx.fillStyle = "#ffffff"

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!
    const w = cell.width
    const h = cell.height
    if (w < 1 || h < 1) continue
    if (!sampleCellMask(cell, settings, baseCellSize)) continue
    ctx.fillRect(cell.x, cell.y, w, h)
  }
}

function drawCellLayoutDebug(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedCell[],
  width: number,
  height: number
) {
  // Phase 1 floor only — no source image, no Phase 2 mask.
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  ctx.lineWidth = 1
  for (let i = 0; i < layout.length; i++) {
    const cell = layout[i]!
    const w = cell.width
    const h = cell.height
    if (w < 1 || h < 1) continue
    ctx.fillStyle = `hsl(${Math.floor(cell.randomVal * 360)}, 70%, 50%)`
    ctx.fillRect(cell.x, cell.y, w, h)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
    ctx.strokeRect(cell.x, cell.y, w, h)
  }
}

const sampleOriginScratch = { sampleX: 0, sampleY: 0 }

function resolveCellSampleOrigin(
  cell: CachedCell,
  settings: EffectSettings,
  fullWidth: number,
  fullHeight: number
): { sampleX: number; sampleY: number } {
  if (!settings.randomSample) {
    sampleOriginScratch.sampleX = cell.x
    sampleOriginScratch.sampleY = cell.y
    return sampleOriginScratch
  }

  const maxSx = Math.max(0, fullWidth - cell.width)
  const maxSy = Math.max(0, fullHeight - cell.height)
  let sampleX = cell.sx | 0
  let sampleY = cell.sy | 0
  if (sampleX < 0) sampleX = 0
  else if (sampleX > maxSx) sampleX = maxSx
  if (sampleY < 0) sampleY = 0
  else if (sampleY > maxSy) sampleY = maxSy
  sampleOriginScratch.sampleX = sampleX
  sampleOriginScratch.sampleY = sampleY
  return sampleOriginScratch
}

function copyContinuousCellSample(
  source: Uint8ClampedArray,
  dest: Uint8ClampedArray,
  fullWidth: number,
  sampleX: number,
  sampleY: number,
  destX: number,
  destY: number,
  cellWidth: number,
  cellHeight: number
) {
  if (cellWidth < 1 || cellHeight < 1) return
  if (sampleX === destX && sampleY === destY && source === dest) return

  for (let row = 0; row < cellHeight; row++) {
    const srcRow = (sampleY + row) * fullWidth + sampleX
    const dstRow = (destY + row) * fullWidth + destX
    for (let col = 0; col < cellWidth; col++) {
      const s = (srcRow + col) * 4
      const d = (dstRow + col) * 4
      dest[d] = source[s]!
      dest[d + 1] = source[s + 1]!
      dest[d + 2] = source[s + 2]!
      dest[d + 3] = source[s + 3]!
    }
  }
}

/**
 * Live Play travel for this frame, folded into one Cell's height.
 * `Math.floor` first so the scroll lands on whole pixel rows — a fractional
 * offset would resample the photo and soften it a little more every frame.
 * Each Cell wraps on its own height, so a small Cell cycles fast and a tall one
 * cycles slowly off the one shared offset.
 */
function wrapOffset(offsetY: number, period: number): number {
  if (!Number.isFinite(offsetY) || period < 1) return 0
  const wrapped = Math.floor(offsetY) % period
  return wrapped < 0 ? wrapped + period : wrapped
}

/**
 * One Cell's worth of Phase 2 work: copy the Color Master window → smear →
 * texture. The Cell rectangle never moves in either Live Play mode; `scroll`
 * rotates its *contents* downward and wraps them inside it, so the sample window
 * is read as two bands — the bottom `scroll` rows come around to the top, and
 * the rest follow beneath them. A `scroll` of 0 is the plain static copy.
 *
 * `smearEdge` is the only other thing the two modes disagree about, and it is
 * what separates them on screen — see `LivePlayMode`.
 */
function paintCell(
  dest: Uint8ClampedArray,
  master: Uint8ClampedArray,
  cell: CachedCell,
  scroll: number,
  effect: EffectName,
  settings: EffectSettings,
  width: number,
  height: number,
  decay: number,
  smearEdge: SmearEdge
) {
  if (cell.width < 1 || cell.height < 1) return

  const { sampleX, sampleY } = resolveCellSampleOrigin(
    cell,
    settings,
    width,
    height
  )

  if (scroll > 0) {
    copyContinuousCellSample(
      master,
      dest,
      width,
      sampleX,
      sampleY + cell.height - scroll,
      cell.x,
      cell.y,
      cell.width,
      scroll
    )
  }
  copyContinuousCellSample(
    master,
    dest,
    width,
    sampleX,
    sampleY,
    cell.x,
    cell.y + scroll,
    cell.width,
    cell.height - scroll
  )

  applySmearStyles(dest, width, height, cell, settings, decay, dest, smearEdge)
  if (isTextureEffect(effect)) {
    applyTexture(
      dest,
      width,
      height,
      effect,
      cell.x,
      cell.y,
      cell.width,
      cell.height
    )
  }
}

/** Cell-sized frame used while building a cache entry — the Cell at its origin. */
const fixedEntryCellScratch: CachedCell = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  sx: 0,
  sy: 0,
  randomVal: 0,
}

/**
 * The cacheable half for one Cell: its Color Master window with the directional
 * smear already applied, unscrolled, in a Cell-sized buffer.
 *
 * Built in its own little frame rather than in place on the canvas — the smear
 * only ever reads within the Cell, so a Cell-sized frame with the Cell at its
 * origin produces the identical result, and keeps the entry independent of
 * wherever it will later be blitted.
 */
function resolveFixedCellEntry(
  cache: FixedCellCache,
  index: number,
  master: Uint8ClampedArray,
  cell: CachedCell,
  settings: EffectSettings,
  width: number,
  height: number,
  decay: number
): Uint8ClampedArray {
  const cached = cache.cells[index]
  const cellWidth = cell.width
  const cellHeight = cell.height
  const byteLength = cellWidth * cellHeight * 4
  if (cached && cached.length === byteLength) return cached

  const entry = new Uint8ClampedArray(byteLength)
  const { sampleX, sampleY } = resolveCellSampleOrigin(
    cell,
    settings,
    width,
    height
  )
  const rowBytes = cellWidth * 4
  for (let row = 0; row < cellHeight; row++) {
    const srcStart = ((sampleY + row) * width + sampleX) * 4
    entry.set(master.subarray(srcStart, srcStart + rowBytes), row * rowBytes)
  }

  const whole = fixedEntryCellScratch
  whole.x = 0
  whole.y = 0
  whole.width = cellWidth
  whole.height = cellHeight
  whole.sx = 0
  whole.sy = 0
  whole.randomVal = cell.randomVal
  applyDirectionalSmearPass(
    entry,
    cellWidth,
    cellHeight,
    whole,
    settings,
    decay,
    entry,
    "wrap"
  )

  cache.cells[index] = entry
  return entry
}

/**
 * Blit a cached entry into the canvas, rotated down by `scroll`.
 * Output row r shows entry row (r − scroll) mod height — the same two bands the
 * uncached path reads from the master, which is what makes the two agree.
 * Row-at-a-time `set` calls, so this is a memcpy per row rather than per pixel.
 */
function blitRotatedCellEntry(
  entry: Uint8ClampedArray,
  dest: Uint8ClampedArray,
  cell: CachedCell,
  scroll: number,
  fullWidth: number
) {
  const cellWidth = cell.width
  const cellHeight = cell.height
  const rowBytes = cellWidth * 4
  for (let row = 0; row < cellHeight; row++) {
    const srcRow = row < scroll ? cellHeight - scroll + row : row - scroll
    const srcStart = srcRow * rowBytes
    dest.set(
      entry.subarray(srcStart, srcStart + rowBytes),
      ((cell.y + row) * fullWidth + cell.x) * 4
    )
  }
}

/**
 * Hybrid cell loop: assign → copy Color Master window → smear → texture.
 * Dest starts as the original master (OFF Cells stay Normal).
 *
 * Live Play never touches Phase 1: the layout, the mask, the effect assignment
 * and the smear roll are exactly what a static frame would use, and the Cell
 * rectangles hold still in both modes. All that animates is the contents of each
 * Cell, scrolling downward and wrapping at that Cell's own borders — plus how
 * the smear responds to it, which is the whole difference between the modes.
 */
function applyHybridCells(
  dest: Uint8ClampedArray,
  masters: ColorMasters,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  decay: number,
  offsetY: number,
  mode: LivePlayMode,
  cache: FixedCellCache | null,
  jobId?: number
) {
  const cells = layout.cells
  const baseCellSize = layout.baseCellSize
  const smearEdge: SmearEdge = mode === "dynamic" ? "clamp" : "wrap"
  dest.set(masters.original)

  for (let i = 0; i < cells.length; i++) {
    if (jobId !== undefined) throwIfStale(jobId)
    const cell = cells[i]!
    if (!sampleCellMask(cell, settings, baseCellSize)) continue

    const effect = chooseEffect(cell.randomVal, settings)
    const master = masterForName(masters, colorMasterForEffect(effect))
    const scroll = wrapOffset(offsetY, cell.height)

    if (cache && cell.width > 0 && cell.height > 0) {
      const entry = resolveFixedCellEntry(
        cache,
        i,
        master,
        cell,
        settings,
        width,
        height,
        decay
      )
      blitRotatedCellEntry(entry, dest, cell, scroll, width)
      // The two halves that cannot ride along with a scroll, re-run on the
      // rotated pixels exactly where the uncached path would have run them.
      applyRecursiveSmearPass(dest, width, height, cell, settings, decay, "wrap")
      if (isTextureEffect(effect)) {
        applyTexture(
          dest,
          width,
          height,
          effect,
          cell.x,
          cell.y,
          cell.width,
          cell.height
        )
      }
      continue
    }

    paintCell(
      dest,
      master,
      cell,
      scroll,
      effect,
      settings,
      width,
      height,
      decay,
      smearEdge
    )
  }
}

/**
 * Hybrid: layout → mask → Color Master sample → smear → post-smear textures.
 * Repeats Phases 1+2 for `settings.passes` (1–3). Pass 0 uses persistent masters
 * and the cached layout. Later passes re-layout with seed+i and never write
 * those caches.
 */
function drawNormalEffects(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  offsetY = 0,
  mode: LivePlayMode = "fixed",
  live = false,
  jobId?: number
) {
  throwIfStale(jobId)
  if (!baseMasters) throw new Error("Color Masters missing")

  const passCount = Math.max(1, Math.min(3, settings.passes | 0))
  const rate = Math.max(0, Math.min(100, Number(settings.rate) || 0))
  const imageData = acquireWorkImageData(ctx, width, height)
  const dest = imageData.data

  const slitScanParams = extractSlitScanParams(settings, width, height)
  /**
   * At weight 0 no Cell can be assigned Slit Scan: `chooseEffect`'s bucket for
   * it is empty, so that branch is unreachable and the master is never sampled.
   * Building it anyway costs a field build plus a full-frame gather on every
   * seed change - which Random rolls on every click, and every Repeat pass
   * repeats. Alias the slot to the original master instead: a reference, not a
   * copy, and it reads as an untouched frame if anything ever does sample it.
   */
  const slitScanActive = settings.weightSlitScan > 0
  // Nothing else drops these once the gate stops rebuilding them, so at weight 0
  // the last master and field would sit resident until the next source swap.
  if (!slitScanActive) releaseSlitScanCaches()

  /**
   * The Cell cache serves live Fixed-mode frames only. Anything else — a slider,
   * Random, a Bake, a Dynamic frame — drops it, so a stale entry can never reach
   * the canvas, and a paused session stops holding the memory. Later Repeat
   * passes are never cached either: they build throwaway masters from the
   * previous pass's output, which changes on every frame of playback.
   */
  const cacheEligible = live && mode === "fixed"
  if (!cacheEligible) clearFixedCellCache()

  let passLayout = layout
  let passMasters: ColorMasters = withSlitScanMaster(
    baseMasters,
    slitScanActive
      ? resolveSlitScanMaster(baseMasters, slitScanParams)
      : baseMasters.original
  )

  for (let i = 0; i < passCount; i++) {
    throwIfStale(jobId)
    const passSettings =
      i > 0 ? { ...settings, seed: settings.seed + i } : settings
    if (i > 0) {
      const prevFrame = new Uint8ClampedArray(dest)
      const passBase = buildBaseColorMasters(
        prevFrame,
        width,
        height,
        blurHeatField
      )
      // Throwaway, exactly like the other masters on a later pass: the pixels
      // differ every frame, so this never reads or writes the pass-0 cache.
      // Only the gather runs — the field is still cached by params.
      passMasters = withSlitScanMaster(
        passBase,
        slitScanActive
          ? buildSlitScanMaster(passBase.original, {
              ...slitScanParams,
              seed: passSettings.seed,
            })
          : passBase.original
      )
      passLayout = generateLayout(passSettings, width, height)
    }
    const decay = Math.pow(rate / 100, i)
    const passCache =
      cacheEligible && i === 0
        ? resolveFixedCellCache(settings, width, height, passLayout.cells.length)
        : null
    applyHybridCells(
      dest,
      passMasters,
      passLayout,
      passSettings,
      width,
      height,
      decay,
      offsetY,
      mode,
      passCache,
      jobId
    )
  }

  ctx.putImageData(imageData, 0, 0)
}

function drawComposite(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  offsetY = 0,
  mode: LivePlayMode = "fixed",
  live = false,
  jobId?: number
) {
  if (settings.showCellLayout) {
    drawCellLayoutDebug(ctx, layout.cells, width, height)
    return
  }

  if (settings.showNoiseMap) {
    drawCellNoiseMapDebug(ctx, layout, settings, width, height)
    return
  }

  drawNormalEffects(
    ctx,
    layout,
    settings,
    width,
    height,
    offsetY,
    mode,
    live,
    jobId
  )
}

function compositeCells(
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  offsetY: number,
  mode: LivePlayMode,
  live: boolean,
  jobId?: number
): ImageBitmap {
  const ctx = ensureWorkSurface(width, height)
  drawComposite(
    ctx,
    layout,
    settings,
    width,
    height,
    offsetY,
    mode,
    live,
    jobId
  )

  const bitmap = workCanvas!.transferToImageBitmap()
  workCanvas = null
  workCtx = null
  workWidth = 0
  workHeight = 0
  return bitmap
}

function resolveLayout(settings: EffectSettings, width: number, height: number) {
  const layoutParams = extractLayoutParams(settings, width, height)
  const canReuseLayout =
    cachedLayout !== null &&
    cachedLayoutParams !== null &&
    layoutParamsEqual(cachedLayoutParams, layoutParams)

  if (canReuseLayout) return cachedLayout!

  const layout = generateLayout(settings, width, height)
  cachedLayout = layout
  cachedLayoutParams = layoutParams
  return layout
}

function renderFrame(
  jobId: number,
  settings: EffectSettings,
  offsetY: number,
  mode: LivePlayMode,
  live: boolean
) {
  if (!cachedSource || !baseMasters) {
    post({ type: "error", jobId, message: "No source image cached in worker" })
    return
  }

  if (isStale(jobId)) {
    post({ type: "cancelled", jobId })
    return
  }

  const width = cachedSource.width
  const height = cachedSource.height

  let bitmap: ImageBitmap
  try {
    const layout = resolveLayout(settings, width, height)
    bitmap = compositeCells(
      layout,
      settings,
      width,
      height,
      offsetY,
      mode,
      live,
      jobId
    )
  } catch (err) {
    if (err instanceof Error && err.message === "__cancelled__") {
      post({ type: "cancelled", jobId })
      return
    }
    post({
      type: "error",
      jobId,
      message: err instanceof Error ? err.message : "Render failed",
    })
    return
  }

  if (isStale(jobId)) {
    bitmap.close()
    post({ type: "cancelled", jobId })
    return
  }

  post(
    {
      type: "result",
      jobId,
      width,
      height,
      bitmap,
    },
    [bitmap]
  )
}

let renderPumpRunning = false
let queuedRender: {
  jobId: number
  settings: EffectSettings
  offsetY: number
  mode: LivePlayMode
  live: boolean
} | null = null

function pumpRenders() {
  if (renderPumpRunning) return
  renderPumpRunning = true
  try {
    while (queuedRender) {
      const job = queuedRender
      queuedRender = null
      if (job.jobId !== activeJobId) continue
      renderFrame(job.jobId, job.settings, job.offsetY, job.mode, job.live)
    }
  } finally {
    renderPumpRunning = false
    if (queuedRender) pumpRenders()
  }
}

self.onmessage = (event: MessageEvent<EffectWorkerInMessage>) => {
  const msg = event.data
  if (
    !msg ||
    typeof msg !== "object" ||
    typeof (msg as { type?: unknown }).type !== "string"
  ) {
    return
  }

  if (msg.type === "setSource") {
    if (!(msg.bitmap instanceof ImageBitmap)) return
    activeJobId += 1
    queuedRender = null
    if (cachedSource) {
      cachedSource.close()
      cachedSource = null
    }
    cachedSource = msg.bitmap
    clearLayoutCache()
    clearFixedCellCache()
    rebuildColorMasters(msg.bitmap)
    workImageData = null
    return
  }

  if (msg.type === "clearSource") {
    activeJobId += 1
    queuedRender = null
    if (cachedSource) {
      cachedSource.close()
      cachedSource = null
    }
    clearLayoutCache()
    clearFixedCellCache()
    clearColorMasters()
    workCanvas = null
    workCtx = null
    workImageData = null
    return
  }

  if (msg.type === "render") {
    if (typeof msg.jobId !== "number" || !Number.isFinite(msg.jobId)) return
    const settings = sanitizeEffectSettings(msg.settings)
    if (!settings) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: "Invalid effect settings",
      })
      return
    }
    // Untrusted like the settings beside it: anything non-finite is a static frame.
    const offsetY =
      typeof msg.offsetY === "number" && Number.isFinite(msg.offsetY)
        ? msg.offsetY
        : 0
    const mode: LivePlayMode =
      msg.livePlayMode === "dynamic" ? "dynamic" : "fixed"
    const live = msg.live === true
    activeJobId = msg.jobId
    queuedRender = { jobId: msg.jobId, settings, offsetY, mode, live }
    pumpRenders()
    return
  }
}
