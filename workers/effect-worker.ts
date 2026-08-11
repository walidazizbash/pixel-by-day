/// <reference lib="webworker" />

import type {
  CachedLayout,
  CachedPixel,
  EffectName,
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

const DITHER_SCALE = 2
const PIXELATE_SIZE = 4
const PIXELATE_COLOR_STEPS = 4
/** Fixed opacity for Overlay Debug (Version 1 — no UI slider). */
const DEBUG_OVERLAY_OPACITY = 0.35

const BAYER_MATRIX = [
  0, 128, 32, 160, 8, 136, 40, 168, 192, 64, 224, 96, 200, 72, 232, 104, 48,
  176, 16, 144, 56, 184, 24, 152, 240, 112, 208, 80, 248, 120, 216, 88, 12,
  140, 44, 172, 4, 132, 36, 164, 204, 76, 236, 108, 196, 68, 228, 100, 60,
  188, 28, 156, 52, 180, 20, 148, 252, 124, 220, 92, 244, 116, 212, 84,
] as const

const SURREAL_R = new Uint8ClampedArray(256)
const SURREAL_G = new Uint8ClampedArray(256)
const SURREAL_B = new Uint8ClampedArray(256)
for (let v = 0; v < 256; v++) {
  SURREAL_R[v] = Math.sin((v / 255) * Math.PI) * 255
  SURREAL_G[v] = Math.cos((v / 255) * Math.PI) * 255
  SURREAL_B[v] = Math.sin((v / 255) * 2 * Math.PI) * 255
}

let cachedSource: ImageBitmap | null = null
let cachedLayout: CachedLayout | null = null
let cachedLayoutParams: LayoutParams | null = null
let activeJobId = 0

/** Reused full-frame work surface — zero per-pixel canvas allocations. */
let workCanvas: OffscreenCanvas | null = null
let workCtx: OffscreenCanvasRenderingContext2D | null = null
let workWidth = 0
let workHeight = 0

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

function clearLayoutCache() {
  cachedLayout = null
  cachedLayoutParams = null
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

// ─── Phase 2: mask sampling (procedural noise) ────────────────────────────────

type MaskSample = {
  /** True when the finished pixel should receive effects. */
  on: boolean
}

/** Fixed Phase 2 mask contrast — keeps organic ON/OFF regions sharp. */
const MASK_NOISE_CONTRAST = 1.5

/**
 * Sample the Phase 2 mask for one structural App Pixel.
 * Uses the Pixel's placement (`pixel.x` / `pixel.y`) so the mask stays blocky
 * at grid resolution — not continuous per photo-pixel sampling.
 */
function samplePixelMask(
  pixel: CachedPixel,
  settings: EffectSettings,
  basePixelScale: number
): MaskSample {
  const scale = Math.max(1, basePixelScale)
  // Structural App Pixel center → grid units (blocky mask resolution).
  const gx = (pixel.x + pixel.width * 0.5) / scale
  const gy = (pixel.y + pixel.height * 0.5) / scale

  // UI noiseScale is 1–100; map to the internal 0.01–0.5 frequency range.
  const uiScale = Math.max(1, Math.min(100, Number(settings.noiseScale) || 1))
  const internalScale = 0.01 + ((uiScale - 1) / 99) * 0.49
  const v = valueNoise2D(
    gx * internalScale,
    gy * internalScale,
    settings.seed >>> 0
  )
  // Bound slightly past scaled noise peaks so extremes are absolute.
  const bound = MASK_NOISE_CONTRAST + 0.01
  // 0 → +bound (all OFF); 50 → 0; 100 → -bound (all ON)
  const threshold = bound * (1.0 - settings.noiseSpread / 50)

  return {
    on: v * MASK_NOISE_CONTRAST > threshold,
  }
}

// ─── Effect assignment (at composite time — weights can change without relayout) ─

function chooseEffect(randomVal: number, settings: EffectSettings): EffectName {
  const wOriginal = settings.weightOriginal
  const wDither = settings.weightDither
  const wInvert = settings.weightInvert
  const wSurreal = settings.weightSurreal
  const wPixelate = settings.weightPixelate
  const totalWeight = wOriginal + wDither + wInvert + wSurreal + wPixelate

  if (totalWeight === 0) return "original"

  const target = randomVal * totalWeight
  const afterOriginal = wOriginal
  const afterDither = afterOriginal + wDither
  const afterInvert = afterDither + wInvert
  const afterSurreal = afterInvert + wSurreal

  if (target < afterOriginal) return "original"
  if (target < afterDither) return "dither"
  if (target < afterInvert) return "invert"
  if (target < afterSurreal) return "surreal"
  if (target < afterSurreal + wPixelate) return "pixelate"
  return "original"
}

// ─── Step 4: compositePixels — one global buffer, inline effect math ───────────

function applyDitherGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number
) {
  const scale = DITHER_SCALE
  for (let localY = 0; localY < height; localY++) {
    const absY = pixelY + localY
    for (let localX = 0; localX < width; localX++) {
      const absX = pixelX + localX
      const qAbsX = absX - (absX % scale)
      const qAbsY = absY - (absY % scale)
      const qLocalX = Math.min(width - 1, Math.max(0, qAbsX - pixelX))
      const qLocalY = Math.min(height - 1, Math.max(0, qAbsY - pixelY))
      const qIndex = ((pixelY + qLocalY) * fullWidth + (pixelX + qLocalX)) * 4

      const r = data[qIndex]
      const g = data[qIndex + 1]
      const b = data[qIndex + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b

      const scaledX = (absX / scale) | 0
      const scaledY = (absY / scale) | 0
      const threshold = BAYER_MATRIX[(scaledY & 7) * 8 + (scaledX & 7)]
      const v = lum > threshold ? 255 : 0

      const i = (absY * fullWidth + absX) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
    }
  }
}

function applyInvertGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number
) {
  for (let localY = 0; localY < height; localY++) {
    const row = (pixelY + localY) * fullWidth + pixelX
    for (let localX = 0; localX < width; localX++) {
      const i = (row + localX) * 4
      data[i] = 255 - data[i]
      data[i + 1] = 255 - data[i + 1]
      data[i + 2] = 255 - data[i + 2]
    }
  }
}

function applySurrealGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number
) {
  for (let localY = 0; localY < height; localY++) {
    const row = (pixelY + localY) * fullWidth + pixelX
    for (let localX = 0; localX < width; localX++) {
      const i = (row + localX) * 4
      data[i] = SURREAL_R[data[i]]
      data[i + 1] = SURREAL_G[data[i + 1]]
      data[i + 2] = SURREAL_B[data[i + 2]]
    }
  }
}

function quantizeChannel(value: number, stepFactor: number): number {
  return Math.round(Math.round(value / stepFactor) * stepFactor)
}

function applyPixelateGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number
) {
  const blockSize = PIXELATE_SIZE
  const colorSteps = PIXELATE_COLOR_STEPS
  const stepFactor = 255 / (colorSteps - 1)
  const pixelRight = pixelX + width
  const pixelBottom = pixelY + height

  const blockStartY = pixelY - (pixelY % blockSize)
  for (let blockY = blockStartY; blockY < pixelBottom; blockY += blockSize) {
    const writeEndY = Math.min(blockY + blockSize, pixelBottom)

    const blockStartX = pixelX - (pixelX % blockSize)
    for (let blockX = blockStartX; blockX < pixelRight; blockX += blockSize) {
      const writeEndX = Math.min(blockX + blockSize, pixelRight)

      const centerX = Math.min(
        fullWidth - 1,
        Math.max(0, blockX + (blockSize >> 1))
      )
      const centerY = Math.min(
        fullHeight - 1,
        Math.max(0, blockY + (blockSize >> 1))
      )
      const centerIndex = (centerY * fullWidth + centerX) * 4

      const r = quantizeChannel(data[centerIndex], stepFactor)
      const g = quantizeChannel(data[centerIndex + 1], stepFactor)
      const b = quantizeChannel(data[centerIndex + 2], stepFactor)

      const writeStartY = Math.max(blockY, pixelY)
      const writeStartX = Math.max(blockX, pixelX)
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

function applyEffectGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  effect: EffectName,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number
) {
  if (effect === "dither") {
    applyDitherGlobal(data, fullWidth, pixelX, pixelY, width, height)
  } else if (effect === "invert") {
    applyInvertGlobal(data, fullWidth, pixelX, pixelY, width, height)
  } else if (effect === "surreal") {
    applySurrealGlobal(data, fullWidth, pixelX, pixelY, width, height)
  } else if (effect === "pixelate") {
    applyPixelateGlobal(
      data,
      fullWidth,
      fullHeight,
      pixelX,
      pixelY,
      width,
      height
    )
  }
}

function fillMaskDebugGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
  on: boolean
) {
  const g = on ? 255 : 0
  for (let localY = 0; localY < height; localY++) {
    const row = (pixelY + localY) * fullWidth + pixelX
    for (let localX = 0; localX < width; localX++) {
      const i = (row + localX) * 4
      data[i] = g
      data[i + 1] = g
      data[i + 2] = g
      data[i + 3] = 255
    }
  }
}

/** Blend a solid gray (0 or 1) over existing pixels at fixed opacity — debug overlay only. */
function blendMaskOverlayGlobal(
  data: Uint8ClampedArray,
  fullWidth: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
  on: boolean,
  opacity: number
) {
  const src = on ? 255 : 0
  const keep = 1 - opacity
  for (let localY = 0; localY < height; localY++) {
    const row = (pixelY + localY) * fullWidth + pixelX
    for (let localX = 0; localX < width; localX++) {
      const i = (row + localX) * 4
      data[i] = data[i] * keep + src * opacity
      data[i + 1] = data[i + 1] * keep + src * opacity
      data[i + 2] = data[i + 2] * keep + src * opacity
    }
  }
}

function drawPixelLayoutDebug(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedPixel[],
  width: number,
  height: number,
  overlay: boolean
) {
  if (!overlay) {
    // Phase 1 floor only — no source image, no Phase 2 mask.
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, width, height)
  }

  ctx.lineWidth = 1
  for (let i = 0; i < layout.length; i++) {
    const pixel = layout[i]
    const w = pixel.width
    const h = pixel.height
    if (w < 1 || h < 1) continue
    ctx.fillStyle = `hsl(${Math.floor(pixel.randomVal * 360)}, 70%, 50%)`
    ctx.fillRect(pixel.x, pixel.y, w, h)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
    ctx.strokeRect(pixel.x, pixel.y, w, h)
  }
}

/** Normal Phase 2 composite: source → mask → sample → effects. No debug visualization. */
function drawNormalEffects(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number
) {
  ctx.drawImage(cachedSource!, 0, 0, width, height)

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const pixels = layout.pixels
  const basePixelScale = layout.basePixelScale

  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i]
    const mask = samplePixelMask(pixel, settings, basePixelScale)

    // OFF pixels leave the source background untouched.
    if (!mask.on) continue

    applySmearStyles(data, width, height, pixel, settings)
    const effect = chooseEffect(pixel.randomVal, settings)
    if (effect !== "original") {
      applyEffectGlobal(
        data,
        width,
        height,
        effect,
        pixel.x,
        pixel.y,
        pixel.width,
        pixel.height
      )
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

function drawBooleanMaskDebug(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number,
  overlay: boolean
) {
  if (!overlay) {
    ctx.drawImage(cachedSource!, 0, 0, width, height)
  }

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const pixels = layout.pixels
  const basePixelScale = layout.basePixelScale

  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i]
    const mask = samplePixelMask(pixel, settings, basePixelScale)
    if (overlay) {
      blendMaskOverlayGlobal(
        data,
        width,
        pixel.x,
        pixel.y,
        pixel.width,
        pixel.height,
        mask.on,
        DEBUG_OVERLAY_OPACITY
      )
    } else {
      fillMaskDebugGlobal(
        data,
        width,
        pixel.x,
        pixel.y,
        pixel.width,
        pixel.height,
        mask.on
      )
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

function drawComposite(
  ctx: OffscreenCanvasRenderingContext2D,
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number
) {
  const overlayDebug = settings.overlayDebug

  if (settings.showPixelLayout) {
    if (overlayDebug) {
      // Finished effects first, then translucent Phase 1 floor on top.
      drawNormalEffects(ctx, layout, settings, width, height)
      ctx.save()
      ctx.globalAlpha = DEBUG_OVERLAY_OPACITY
      drawPixelLayoutDebug(ctx, layout.pixels, width, height, true)
      ctx.restore()
    } else {
      drawPixelLayoutDebug(ctx, layout.pixels, width, height, false)
    }
    return
  }

  if (settings.showNoiseMap) {
    if (overlayDebug) {
      // Finished effects first, then translucent boolean mask on top.
      drawNormalEffects(ctx, layout, settings, width, height)
      drawBooleanMaskDebug(ctx, layout, settings, width, height, true)
    } else {
      drawBooleanMaskDebug(ctx, layout, settings, width, height, false)
    }
    return
  }

  drawNormalEffects(ctx, layout, settings, width, height)
}

function compositePixels(
  layout: CachedLayout,
  settings: EffectSettings,
  width: number,
  height: number
): ImageBitmap {
  const ctx = ensureWorkSurface(width, height)
  drawComposite(ctx, layout, settings, width, height)

  const bitmap = workCanvas!.transferToImageBitmap()
  // transferToImageBitmap detaches the canvas — recreate on next composite
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

async function exportComposite(settings: EffectSettings) {
  if (!cachedSource) {
    post({ type: "EXPORT_ERROR", message: "No source image cached in worker" })
    return
  }

  const width = cachedSource.width
  const height = cachedSource.height
  const layout = resolveLayout(settings, width, height)

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    post({ type: "EXPORT_ERROR", message: "Failed to create export canvas" })
    return
  }

  // Overlay Debug is preview-only — keep export on solid debug/replace or normal render.
  drawComposite(
    ctx,
    layout,
    { ...settings, overlayDebug: false },
    width,
    height
  )

  try {
    const blob = await canvas.convertToBlob({ type: "image/png" })
    post({ type: "EXPORT_COMPLETE", blob })
  } catch (err) {
    post({
      type: "EXPORT_ERROR",
      message: err instanceof Error ? err.message : "PNG export failed",
    })
  }
}

// ─── Render orchestration ───────────────────────────────────────────────────

function renderFrame(jobId: number, settings: EffectSettings) {
  if (!cachedSource) {
    post({ type: "error", jobId, message: "No source image cached in worker" })
    return
  }

  if (isStale(jobId)) {
    post({ type: "cancelled", jobId })
    return
  }

  const width = cachedSource.width
  const height = cachedSource.height
  const layout = resolveLayout(settings, width, height)

  if (isStale(jobId)) {
    post({ type: "cancelled", jobId })
    return
  }

  const bitmap = compositePixels(layout, settings, width, height)

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
  if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") {
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
    workCanvas = null
    workCtx = null
    workWidth = 0
    workHeight = 0
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
    workCanvas = null
    workCtx = null
    return
  }

  if (msg.type === "render") {
    if (typeof msg.jobId !== "number" || !msg.settings) return
    activeJobId = msg.jobId
    queuedRender = { jobId: msg.jobId, settings: msg.settings }
    pumpRenders()
    return
  }

  if (msg.type === "EXPORT") {
    if (!msg.settings) return
    void exportComposite(msg.settings)
  }
}
