/// <reference lib="webworker" />

/**
 * Phase 3 — Final Composite worker.
 * Applies the 35mm grain image over a finished Phase 2 bitmap.
 * Does not touch Phase 1 geometry or Phase 2 masking.
 */

import type {
  CompositeTextureSettings,
  CompositeWorkerInMessage,
  CompositeWorkerOutMessage,
} from "@/lib/effect-types"
import { sanitizeCompositeTextureSettings } from "@/lib/validate-settings"

const GRAIN_TEXTURE_URL = "/images/35mm_texture.png"

let activeJobId = 0

/** Cached source grain bitmap (fetched once per worker lifetime). */
let cachedGrainBitmap: ImageBitmap | null = null
/** Cached grain pixels scaled to the current Phase 2 frame size (reuse across opacity scrubs). */
let cachedScaledGrain: {
  width: number
  height: number
  data: Uint8ClampedArray
} | null = null

function post(msg: CompositeWorkerOutMessage, transfer?: Transferable[]) {
  ;(self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? [])
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

async function ensureGrainBitmap(): Promise<ImageBitmap> {
  if (cachedGrainBitmap) return cachedGrainBitmap

  const response = await fetch(GRAIN_TEXTURE_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch grain texture (${response.status})`)
  }
  const blob = await response.blob()
  cachedGrainBitmap = await createImageBitmap(blob)
  // Dimension change invalidates any prior scaled cache.
  cachedScaledGrain = null
  return cachedGrainBitmap
}

async function ensureScaledGrainData(
  width: number,
  height: number
): Promise<Uint8ClampedArray> {
  if (
    cachedScaledGrain &&
    cachedScaledGrain.width === width &&
    cachedScaledGrain.height === height
  ) {
    return cachedScaledGrain.data
  }

  const grain = await ensureGrainBitmap()
  const texCanvas = new OffscreenCanvas(width, height)
  const texCtx = texCanvas.getContext("2d", { willReadFrequently: true })
  if (!texCtx) throw new Error("Failed to create grain canvas")

  // Scale grain to exact Phase 2 frame dimensions.
  texCtx.drawImage(grain, 0, 0, width, height)
  const imageData = texCtx.getImageData(0, 0, width, height)
  cachedScaledGrain = {
    width,
    height,
    data: imageData.data,
  }
  return imageData.data
}

async function applyPhase3Grain(
  source: ImageBitmap,
  settings: CompositeTextureSettings
): Promise<ImageBitmap> {
  const width = source.width
  const height = source.height
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Failed to create Phase 3 canvas")

  ctx.drawImage(source, 0, 0)
  const imageData = ctx.getImageData(0, 0, width, height)
  const layoutPixels = imageData.data
  const texturePixels = await ensureScaledGrainData(width, height)
  const textureOpacity = clamp01(Number(settings.textureOpacity) || 0)
  // Film base density: milky shadow lift + soft contrast as grain strength rises.
  const MAX_LIFT = 0.075
  const lift = textureOpacity * MAX_LIFT

  // Filmic grain (Camera Raw / FilmConvert style):
  // 1) Lift/compress the layout base (simulate film base density).
  // 2) Mono luminance grain centered on mid-gray.
  // 3) Add deviation onto the adjusted base.
  const inv255 = 1 / 255
  for (let i = 0; i < layoutPixels.length; i += 4) {
    const grainLuma =
      (0.2126 * texturePixels[i] +
        0.7152 * texturePixels[i + 1] +
        0.0722 * texturePixels[i + 2]) *
      inv255
    const grainDeviation = (grainLuma - 0.5) * 2 * textureOpacity

    for (let c = 0; c < 3; c++) {
      const baseFloat = layoutPixels[i + c] * inv255
      const adjustedBase = baseFloat * (1 - lift) + lift
      const finalFloat = adjustedBase + grainDeviation
      layoutPixels[i + c] = Math.max(0, Math.min(255, finalFloat * 255))
    }
    layoutPixels[i + 3] = 255
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.transferToImageBitmap()
}

function isStale(jobId: number) {
  return jobId !== activeJobId
}

async function exportComposite(
  source: ImageBitmap,
  settings: CompositeTextureSettings
) {
  try {
    const bitmap = settings.textureEnabled
      ? await applyPhase3Grain(source, settings)
      : source

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      post({ type: "EXPORT_ERROR", message: "Failed to create export canvas" })
      return
    }
    ctx.drawImage(bitmap, 0, 0)
    if (bitmap !== source) bitmap.close()
    source.close()

    const blob = await canvas.convertToBlob({ type: "image/png" })
    post({ type: "EXPORT_COMPLETE", blob })
  } catch (err) {
    source.close()
    post({
      type: "EXPORT_ERROR",
      message: err instanceof Error ? err.message : "Phase 3 export failed",
    })
  }
}

self.onmessage = (event: MessageEvent<CompositeWorkerInMessage>) => {
  const msg = event.data
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return

  if (msg.type === "composite") {
    if (
      typeof msg.jobId !== "number" ||
      !Number.isFinite(msg.jobId) ||
      !(msg.source instanceof ImageBitmap)
    ) {
      return
    }
    const settings = sanitizeCompositeTextureSettings(msg.settings)
    if (!settings) {
      msg.source.close()
      post({
        type: "error",
        jobId: msg.jobId,
        message: "Invalid composite settings",
      })
      return
    }
    activeJobId = msg.jobId

    void (async () => {
      try {
        if (isStale(msg.jobId)) {
          msg.source.close()
          post({ type: "cancelled", jobId: msg.jobId })
          return
        }

        if (!settings.textureEnabled) {
          post(
            {
              type: "result",
              jobId: msg.jobId,
              width: msg.source.width,
              height: msg.source.height,
              bitmap: msg.source,
            },
            [msg.source]
          )
          return
        }

        const bitmap = await applyPhase3Grain(msg.source, settings)
        msg.source.close()

        if (isStale(msg.jobId)) {
          bitmap.close()
          post({ type: "cancelled", jobId: msg.jobId })
          return
        }

        post(
          {
            type: "result",
            jobId: msg.jobId,
            width: bitmap.width,
            height: bitmap.height,
            bitmap,
          },
          [bitmap]
        )
      } catch (err) {
        msg.source.close()
        post({
          type: "error",
          jobId: msg.jobId,
          message:
            err instanceof Error ? err.message : "Phase 3 composite failed",
        })
      }
    })()
    return
  }

  if (msg.type === "EXPORT") {
    if (!(msg.source instanceof ImageBitmap)) return
    const settings = sanitizeCompositeTextureSettings(msg.settings)
    if (!settings) {
      msg.source.close()
      post({ type: "EXPORT_ERROR", message: "Invalid export settings" })
      return
    }
    void exportComposite(msg.source, settings)
  }
}
