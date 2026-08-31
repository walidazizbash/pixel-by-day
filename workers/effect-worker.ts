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
  EffectSettings,
  EffectWorkerInMessage,
  EffectWorkerOutMessage,
  LayoutParams,
} from "@/lib/effect-types"
import {
  extractLayoutParams,
  generateLayout,
  hash2D,
  layoutParamsEqual,
} from "@/lib/phase1-floor"
import { applySmearStyles } from "@/lib/smear-styles"
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
 * Hybrid cell loop: assign → copy Color Master window → smear → texture.
 * Dest starts as the original master (OFF Cells stay Normal).
 */
function applyHybridCells(
  dest: Uint8ClampedArray,
  masters: ColorMasters,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  decay: number,
  jobId?: number
) {
  const cells = layout.cells
  const baseCellSize = layout.baseCellSize
  dest.set(masters.original)

  for (let i = 0; i < cells.length; i++) {
    if (jobId !== undefined) throwIfStale(jobId)
    const cell = cells[i]!
    if (!sampleCellMask(cell, settings, baseCellSize)) continue

    const effect = chooseEffect(cell.randomVal, settings)
    const master = masterForName(masters, colorMasterForEffect(effect))
    const { sampleX, sampleY } = resolveCellSampleOrigin(
      cell,
      settings,
      width,
      height
    )
    copyContinuousCellSample(
      master,
      dest,
      width,
      sampleX,
      sampleY,
      cell.x,
      cell.y,
      cell.width,
      cell.height
    )
    applySmearStyles(dest, width, height, cell, settings, decay)
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
    applyHybridCells(
      dest,
      passMasters,
      passLayout,
      passSettings,
      width,
      height,
      decay,
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

  drawNormalEffects(ctx, layout, settings, width, height, jobId)
}

function compositeCells(
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  jobId?: number
): ImageBitmap {
  const ctx = ensureWorkSurface(width, height)
  drawComposite(ctx, layout, settings, width, height, jobId)

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

function renderFrame(jobId: number, settings: EffectSettings) {
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
    bitmap = compositeCells(layout, settings, width, height, jobId)
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
let queuedRender: { jobId: number; settings: EffectSettings } | null = null

function pumpRenders() {
  if (renderPumpRunning) return
  renderPumpRunning = true
  try {
    while (queuedRender) {
      const job = queuedRender
      queuedRender = null
      if (job.jobId !== activeJobId) continue
      renderFrame(job.jobId, job.settings)
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
    activeJobId = msg.jobId
    queuedRender = { jobId: msg.jobId, settings }
    pumpRenders()
    return
  }
}
