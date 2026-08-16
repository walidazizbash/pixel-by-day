"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CompositeTextureSettings,
  CompositeWorkerOutMessage,
  EffectSettings,
  EffectWorkerOutMessage,
} from "@/lib/effect-types"

/** Max edge length for interactive preview / Phase 2+3 worker buffers. */
const MAX_PREVIEW_DIMENSION = 1200
/** Hard reject for pathological source bitmaps. */
const MAX_DECODE_EDGE = 8192
const MAX_DECODE_PIXELS = 36_000_000

function releaseBitmap(bitmap: ImageBitmap | null) {
  if (!bitmap) return
  try {
    bitmap.close()
  } catch {
    // already closed
  }
}

function fitMaxEdge(width: number, height: number, maxEdge: number) {
  const edge = Math.max(width, height)
  if (edge <= maxEdge) {
    return { width, height }
  }
  const scale = maxEdge / edge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function createSizedBitmap(
  source: ImageBitmap | HTMLImageElement,
  maxEdge: number
) {
  const width = "naturalWidth" in source ? source.naturalWidth : source.width
  const height = "naturalHeight" in source ? source.naturalHeight : source.height
  const size = fitMaxEdge(width, height, maxEdge)
  if (size.width === width && size.height === height) {
    return createImageBitmap(source)
  }
  return createImageBitmap(source, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: "high",
  })
}

async function createPreviewBitmap(source: ImageBitmap | HTMLImageElement) {
  return createSizedBitmap(source, MAX_PREVIEW_DIMENSION)
}

function downloadPngBlob(blob: Blob, filenamePrefix = "generated-mosaic") {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filenamePrefix}-${Date.now()}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function textureSettingsFrom(
  settings: EffectSettings
): CompositeTextureSettings {
  return {
    textureEnabled: settings.textureEnabled,
    textureOpacity: settings.textureOpacity,
  }
}

type UseAppWorkersOptions = {
  settings: EffectSettings
  imageSrc: string | null
  /** Draw a finished composite frame to the live canvas. */
  onPreviewFrame: (width: number, height: number, bitmap: ImageBitmap) => void
  /** Draw the raw source while the first worker job is pending. */
  onSourcePreview?: (width: number, height: number, bitmap: ImageBitmap) => void
}

type UseAppWorkersResult = {
  isExportingPng: boolean
  exportHighResImage: () => void
  /**
   * PNG blob of the last Phase 2 frame (effects + smears), before Phase 3 grain.
   * Used by Reuse Image so grain does not stack across recursive swaps.
   */
  capturePhase2PngBlob: () => Promise<Blob | null>
}

export function useAppWorkers({
  settings,
  imageSrc,
  onPreviewFrame,
  onSourcePreview,
}: UseAppWorkersOptions): UseAppWorkersResult {
  const [isExportingPng, setIsExportingPng] = useState(false)

  const dispatchRafRef = useRef<number | null>(null)
  const phase3RafRef = useRef<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const compositeWorkerRef = useRef<Worker | null>(null)
  const jobIdRef = useRef(0)
  const pendingDispatchRef = useRef(false)
  const pendingPhase3Ref = useRef(false)
  /** Last finished preview frame (Phase 2, or Phase 3 if grain is on) — Save uses this. */
  const compositeBitmapRef = useRef<ImageBitmap | null>(null)
  /** Capped preview source (what the effect worker uses for interactive renders). */
  const sourceBitmapRef = useRef<ImageBitmap | null>(null)
  /** Full-resolution source — Save uses its native dimensions for PNG output size. */
  const fullSourceBitmapRef = useRef<ImageBitmap | null>(null)
  /** Last finished Phase 2 frame — reused for texture-only Phase 3 updates. */
  const phase2BitmapRef = useRef<ImageBitmap | null>(null)

  const settingsRef = useRef(settings)
  const onPreviewFrameRef = useRef(onPreviewFrame)
  const onSourcePreviewRef = useRef(onSourcePreview)

  useEffect(() => {
    settingsRef.current = settings
    onPreviewFrameRef.current = onPreviewFrame
    onSourcePreviewRef.current = onSourcePreview
  }, [settings, onPreviewFrame, onSourcePreview])

  function applyWorkerResult(
    width: number,
    height: number,
    bitmap: ImageBitmap
  ) {
    releaseBitmap(compositeBitmapRef.current)
    compositeBitmapRef.current = bitmap
    onPreviewFrameRef.current(width, height, bitmap)
  }

  const dispatchComposite = useCallback(
    (jobId: number, phase2: ImageBitmap, effectSettings: EffectSettings) => {
      const worker = compositeWorkerRef.current
      if (!worker) {
        phase2.close()
        return
      }

      worker.postMessage(
        {
          type: "composite",
          jobId,
          source: phase2,
          settings: textureSettingsFrom(effectSettings),
        },
        [phase2]
      )
    },
    []
  )

  const handlePhase2Result = useCallback(
    async (
      jobId: number,
      width: number,
      height: number,
      bitmap: ImageBitmap
    ) => {
      if (jobId !== jobIdRef.current) {
        bitmap.close()
        return
      }

      releaseBitmap(phase2BitmapRef.current)
      try {
        phase2BitmapRef.current = await createImageBitmap(bitmap)
      } catch {
        phase2BitmapRef.current = null
      }

      const effectSettings = settingsRef.current
      if (effectSettings.textureEnabled) {
        dispatchComposite(jobId, bitmap, effectSettings)
        return
      }

      applyWorkerResult(width, height, bitmap)
    },
    [dispatchComposite]
  )

  const dispatchWorkerRender = useCallback(() => {
    const worker = workerRef.current
    const source = sourceBitmapRef.current
    const effectSettings = settingsRef.current
    if (!worker || !source || !effectSettings) return

    const jobId = ++jobIdRef.current
    worker.postMessage({
      type: "render",
      jobId,
      settings: { ...effectSettings },
    })
  }, [])

  const scheduleRegen = useCallback(() => {
    pendingDispatchRef.current = true
    if (dispatchRafRef.current !== null) return

    dispatchRafRef.current = requestAnimationFrame(() => {
      dispatchRafRef.current = null
      if (!pendingDispatchRef.current) return
      pendingDispatchRef.current = false
      dispatchWorkerRender()
    })
  }, [dispatchWorkerRender])

  const schedulePhase3Only = useCallback(() => {
    pendingPhase3Ref.current = true
    if (phase3RafRef.current !== null) return

    phase3RafRef.current = requestAnimationFrame(() => {
      phase3RafRef.current = null
      if (!pendingPhase3Ref.current) return
      pendingPhase3Ref.current = false

      const effectSettings = settingsRef.current
      const phase2 = phase2BitmapRef.current
      if (!effectSettings || !phase2 || !compositeWorkerRef.current) {
        scheduleRegen()
        return
      }

      const jobId = ++jobIdRef.current
      void (async () => {
        try {
          const clone = await createImageBitmap(phase2)
          if (jobId !== jobIdRef.current) {
            clone.close()
            return
          }
          if (!effectSettings.textureEnabled) {
            applyWorkerResult(clone.width, clone.height, clone)
            return
          }
          dispatchComposite(jobId, clone, effectSettings)
        } catch (err) {
          console.error("[pixel-by-day] Phase 3 refresh failed", err)
          scheduleRegen()
        }
      })()
    })
  }, [dispatchComposite, scheduleRegen])

  const exportHighResImage = useCallback(() => {
    const fullSource = fullSourceBitmapRef.current
    const previewFrame = compositeBitmapRef.current
    if (!fullSource || !previewFrame || isExportingPng) {
      return
    }

    const outputWidth = Math.max(1, Math.round(fullSource.width))
    const outputHeight = Math.max(1, Math.round(fullSource.height))

    // Draw synchronously from the live preview frame before any await, so a
    // concurrent regen can't close the ImageBitmap mid-export.
    let canvas: OffscreenCanvas
    try {
      canvas = new OffscreenCanvas(outputWidth, outputHeight)
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        throw new Error("Failed to create export canvas")
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(previewFrame, 0, 0, outputWidth, outputHeight)
    } catch (err) {
      console.error("[pixel-by-day] Export prep failed", err)
      return
    }

    setIsExportingPng(true)
    void (async () => {
      try {
        const blob = await canvas.convertToBlob({ type: "image/png" })
        downloadPngBlob(blob)
      } catch (err) {
        console.error("[pixel-by-day] Export failed", err)
      } finally {
        setIsExportingPng(false)
      }
    })()
  }, [isExportingPng])

  /** Capture Phase 2 only — never include Phase 3 grain. */
  const capturePhase2PngBlob = useCallback(async (): Promise<Blob | null> => {
    const phase2 = phase2BitmapRef.current
    if (!phase2 || phase2.width < 1 || phase2.height < 1) return null

    // Draw synchronously first so a concurrent regen can't close the bitmap mid-await.
    let canvas: OffscreenCanvas
    try {
      canvas = new OffscreenCanvas(phase2.width, phase2.height)
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.drawImage(phase2, 0, 0)
    } catch (err) {
      console.error("[pixel-by-day] Phase 2 capture failed", err)
      return null
    }

    try {
      return await canvas.convertToBlob({ type: "image/png" })
    } catch (err) {
      console.error("[pixel-by-day] Phase 2 PNG encode failed", err)
      return null
    }
  }, [])

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/effect-worker.ts", import.meta.url)
    )
    workerRef.current = worker

    const compositeWorker = new Worker(
      new URL("../workers/composite-worker.ts", import.meta.url)
    )
    compositeWorkerRef.current = compositeWorker

    worker.onmessage = (event: MessageEvent<EffectWorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === "result") {
        if (msg.jobId !== jobIdRef.current) {
          msg.bitmap.close()
          return
        }
        void handlePhase2Result(msg.jobId, msg.width, msg.height, msg.bitmap)
        return
      }
      if (msg.type === "cancelled") return
      if (msg.type === "error") {
        console.error("[effect-worker]", msg.message)
        return
      }
    }

    compositeWorker.onmessage = (
      event: MessageEvent<CompositeWorkerOutMessage>
    ) => {
      const msg = event.data
      if (msg.type === "result") {
        if (msg.jobId !== jobIdRef.current) {
          msg.bitmap.close()
          return
        }
        applyWorkerResult(msg.width, msg.height, msg.bitmap)
        return
      }
      if (msg.type === "cancelled") return
      if (msg.type === "error") {
        console.error("[composite-worker]", msg.message)
        return
      }
    }

    return () => {
      if (dispatchRafRef.current !== null) {
        cancelAnimationFrame(dispatchRafRef.current)
        dispatchRafRef.current = null
      }
      if (phase3RafRef.current !== null) {
        cancelAnimationFrame(phase3RafRef.current)
        phase3RafRef.current = null
      }
      worker.terminate()
      workerRef.current = null
      compositeWorker.terminate()
      compositeWorkerRef.current = null
      releaseBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = null
      releaseBitmap(phase2BitmapRef.current)
      phase2BitmapRef.current = null
      releaseBitmap(sourceBitmapRef.current)
      sourceBitmapRef.current = null
      releaseBitmap(fullSourceBitmapRef.current)
      fullSourceBitmapRef.current = null
    }
  }, [dispatchComposite, handlePhase2Result])

  useEffect(() => {
    if (!sourceBitmapRef.current || !workerRef.current) return
    scheduleRegen()
  }, [
    settings.seed,
    settings.noiseScale,
    settings.noiseSpread,
    settings.maxCellSize,
    settings.layoutMode,
    settings.subdivisionLoops,
    settings.subdivisionMode,
    settings.subdivisionRate,
    settings.passes,
    settings.rate,
    settings.weightDither,
    settings.weightInvert,
    settings.weightSurreal,
    settings.weightPixelate,
    settings.weightOriginal,
    settings.randomSample,
    settings.edgeClamp,
    settings.smearVertical,
    settings.smearHorizontal,
    settings.smearDiagonal,
    settings.smearRecursive,
    settings.verticalWeight,
    settings.horizontalWeight,
    settings.diagonalWeight,
    settings.recursiveWeight,
    settings.showNoiseMap,
    settings.showCellLayout,
    scheduleRegen,
  ])

  useEffect(() => {
    if (!sourceBitmapRef.current || !phase2BitmapRef.current) return
    schedulePhase3Only()
  }, [
    settings.textureEnabled,
    settings.textureOpacity,
    schedulePhase3Only,
  ])

  useEffect(() => {
    let cancelled = false

    if (!imageSrc) {
      workerRef.current?.postMessage({ type: "clearSource" })
      releaseBitmap(sourceBitmapRef.current)
      sourceBitmapRef.current = null
      releaseBitmap(fullSourceBitmapRef.current)
      fullSourceBitmapRef.current = null
      releaseBitmap(phase2BitmapRef.current)
      phase2BitmapRef.current = null
      releaseBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = null
      return
    }

    releaseBitmap(compositeBitmapRef.current)
    compositeBitmapRef.current = null
    releaseBitmap(phase2BitmapRef.current)
    phase2BitmapRef.current = null
    releaseBitmap(sourceBitmapRef.current)
    sourceBitmapRef.current = null
    releaseBitmap(fullSourceBitmapRef.current)
    fullSourceBitmapRef.current = null

    const image = new Image()
    image.onload = async () => {
      if (cancelled) return
      try {
        const edge = Math.max(image.naturalWidth, image.naturalHeight)
        const pixels = image.naturalWidth * image.naturalHeight
        if (
          edge > MAX_DECODE_EDGE ||
          pixels > MAX_DECODE_PIXELS ||
          image.naturalWidth < 1 ||
          image.naturalHeight < 1
        ) {
          console.error(
            "[pixel-by-day] Source image exceeds safe decode limits"
          )
          return
        }

        const fullBitmap = await createImageBitmap(image)
        if (cancelled) {
          fullBitmap.close()
          return
        }
        fullSourceBitmapRef.current = fullBitmap

        const previewBitmap = await createPreviewBitmap(fullBitmap)
        if (cancelled) {
          previewBitmap.close()
          return
        }
        sourceBitmapRef.current = previewBitmap

        onSourcePreviewRef.current?.(
          previewBitmap.width,
          previewBitmap.height,
          previewBitmap
        )

        const workerBitmap = await createImageBitmap(previewBitmap)
        if (cancelled) {
          workerBitmap.close()
          return
        }
        workerRef.current?.postMessage(
          { type: "setSource", bitmap: workerBitmap },
          [workerBitmap]
        )
        scheduleRegen()
      } catch {
        // Ignore decode failures; user can re-upload.
      }
    }
    image.src = imageSrc

    return () => {
      cancelled = true
    }
  }, [imageSrc, scheduleRegen])

  return {
    isExportingPng,
    exportHighResImage,
    capturePhase2PngBlob,
  }
}
