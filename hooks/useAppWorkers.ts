"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CompositeTextureSettings,
  CompositeWorkerOutMessage,
  EffectSettings,
  EffectWorkerOutMessage,
} from "@/lib/effect-types"
import { MAX_DECODE_EDGE, MAX_DECODE_PIXELS } from "@/lib/constants"

/** Max edge length for interactive preview / Phase 2+3 worker buffers. */
const MAX_PREVIEW_DIMENSION = 1200

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
  /**
   * Suspend settings-driven rendering — set while the History preview modal is open,
   * where the live controls track the previewed snapshot but the canvas underneath is
   * hidden behind an opaque overlay, so every render would be thrown away unseen.
   *
   * Only *settings* changes are suspended. A new `imageSrc` still renders, since that
   * path has to decode and upload a source bitmap either way. Clearing this flag
   * re-runs the render effect, so whatever the settings drifted to while suspended is
   * reconciled with exactly one job.
   */
  paused?: boolean
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
   * Used by Bake so grain does not stack across recursive swaps.
   */
  capturePhase2PngBlob: () => Promise<Blob | null>
}

export function useAppWorkers({
  settings,
  imageSrc,
  paused = false,
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
  /** Effect worker is running a render; do not post another until it settles. */
  const effectBusyRef = useRef(false)
  /** Latest settings changed while the effect worker was busy. */
  const pendingRegenRef = useRef(false)
  /** Composite worker is running; hold at most one pending Phase 3 job. */
  const compositeBusyRef = useRef(false)
  const pendingCompositeRef = useRef<{
    jobId: number
    phase2: ImageBitmap
    settings: EffectSettings
  } | null>(null)
  /** Highest jobId posted to the composite worker — never post a lower id after it. */
  const lastPostedCompositeJobIdRef = useRef(0)
  /** Highest jobId whose grained frame was drawn — ignore out-of-order results. */
  const lastShownCompositeJobIdRef = useRef(0)
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

      lastPostedCompositeJobIdRef.current = jobId
      compositeBusyRef.current = true
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

  const enqueueComposite = useCallback(
    (jobId: number, phase2: ImageBitmap, effectSettings: EffectSettings) => {
      if (jobId < lastPostedCompositeJobIdRef.current) {
        phase2.close()
        return
      }
      if (compositeBusyRef.current) {
        const prev = pendingCompositeRef.current
        if (prev) {
          if (prev.jobId > jobId) {
            phase2.close()
            return
          }
          prev.phase2.close()
        }
        pendingCompositeRef.current = { jobId, phase2, settings: effectSettings }
        return
      }
      dispatchComposite(jobId, phase2, effectSettings)
    },
    [dispatchComposite]
  )

  const flushPendingComposite = useCallback(() => {
    compositeBusyRef.current = false
    const pending = pendingCompositeRef.current
    if (!pending) return
    pendingCompositeRef.current = null

    if (!settingsRef.current.textureEnabled) {
      applyWorkerResult(
        pending.phase2.width,
        pending.phase2.height,
        pending.phase2
      )
      return
    }
    if (pending.jobId < lastPostedCompositeJobIdRef.current) {
      pending.phase2.close()
      return
    }
    dispatchComposite(pending.jobId, pending.phase2, pending.settings)
  }, [dispatchComposite])

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

      // Grain stays on the live canvas until the next Phase 3 frame lands.
      // Painting Phase 2 here is what flickered the overlay off mid-drag.
      if (!settingsRef.current.textureEnabled) {
        onPreviewFrameRef.current(width, height, bitmap)
      }

      let clone: ImageBitmap
      try {
        clone = await createImageBitmap(bitmap)
      } catch {
        bitmap.close()
        return
      }

      const stillCurrent = jobId === jobIdRef.current
      if (stillCurrent) {
        releaseBitmap(phase2BitmapRef.current)
        phase2BitmapRef.current = clone
      } else {
        clone.close()
      }

      if (settingsRef.current.textureEnabled) {
        enqueueComposite(jobId, bitmap, settingsRef.current)
        return
      }

      if (!stillCurrent) {
        bitmap.close()
        return
      }

      releaseBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = bitmap
    },
    [enqueueComposite]
  )

  const dispatchWorkerRender = useCallback(() => {
    const worker = workerRef.current
    const source = sourceBitmapRef.current
    const effectSettings = settingsRef.current
    if (!worker || !source || !effectSettings) {
      effectBusyRef.current = false
      return
    }

    const jobId = ++jobIdRef.current
    effectBusyRef.current = true
    worker.postMessage({
      type: "render",
      jobId,
      settings: { ...effectSettings },
    })
  }, [])

  const flushPendingRegen = useCallback(() => {
    effectBusyRef.current = false
    if (!pendingRegenRef.current) return
    pendingRegenRef.current = false
    dispatchWorkerRender()
  }, [dispatchWorkerRender])

  const scheduleRegen = useCallback(() => {
    if (effectBusyRef.current) {
      pendingRegenRef.current = true
      return
    }
    pendingDispatchRef.current = true
    if (dispatchRafRef.current !== null) return

    dispatchRafRef.current = requestAnimationFrame(() => {
      dispatchRafRef.current = null
      if (!pendingDispatchRef.current) return
      pendingDispatchRef.current = false
      if (effectBusyRef.current) {
        pendingRegenRef.current = true
        return
      }
      dispatchWorkerRender()
    })
  }, [dispatchWorkerRender])

  const schedulePhase3Only = useCallback(() => {
    // A full regen queued in this same commit already renders Phase 3 from the fresh
    // Phase 2 frame. Queuing a texture-only job on top would take the higher jobId and
    // invalidate that render when it lands, leaving stale Phase 2 pixels under new grain.
    // Relies on the render effect below being declared before the texture effect, so its
    // `scheduleRegen` has already set this flag by the time we get here.
    if (pendingDispatchRef.current || pendingRegenRef.current || effectBusyRef.current) {
      return
    }

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
          enqueueComposite(jobId, clone, effectSettings)
        } catch (err) {
          console.error("[pixel-by-day] Phase 3 refresh failed", err)
          scheduleRegen()
        }
      })()
    })
  }, [enqueueComposite, scheduleRegen])

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
        if (msg.jobId === jobIdRef.current) {
          void handlePhase2Result(msg.jobId, msg.width, msg.height, msg.bitmap)
        } else {
          msg.bitmap.close()
        }
        flushPendingRegen()
        return
      }
      if (msg.type === "cancelled") {
        flushPendingRegen()
        return
      }
      if (msg.type === "error") {
        console.error("[effect-worker]", msg.message)
        flushPendingRegen()
        return
      }
    }

    compositeWorker.onmessage = (
      event: MessageEvent<CompositeWorkerOutMessage>
    ) => {
      const msg = event.data
      if (msg.type === "result") {
        const grainOn = settingsRef.current.textureEnabled
        if (
          !grainOn ||
          msg.jobId < lastShownCompositeJobIdRef.current
        ) {
          msg.bitmap.close()
        } else {
          lastShownCompositeJobIdRef.current = msg.jobId
          applyWorkerResult(msg.width, msg.height, msg.bitmap)
        }
        flushPendingComposite()
        return
      }
      if (msg.type === "cancelled") {
        flushPendingComposite()
        return
      }
      if (msg.type === "error") {
        console.error("[composite-worker]", msg.message)
        flushPendingComposite()
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
  }, [dispatchComposite, handlePhase2Result, flushPendingRegen, flushPendingComposite])

  /**
   * Phase 1+2 render on any settings change.
   *
   * MUST stay declared before the texture-only effect below — `schedulePhase3Only`
   * defers to the `pendingDispatchRef` flag that `scheduleRegen` sets here.
   *
   * `paused` is a dependency, not just a guard: clearing it re-runs this effect, which
   * is what reconciles the canvas with however far the settings drifted while suspended.
   * That single job covers Phase 3 too, so the texture effect has nothing left to do.
   */
  useEffect(() => {
    if (!sourceBitmapRef.current || !workerRef.current) return
    if (paused) return
    scheduleRegen()
  }, [
    paused,
    settings.seed,
    settings.noiseScale,
    settings.noiseSpread,
    settings.maxCellSize,
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
    settings.halftoneAmount,
    settings.weightThermal,
    settings.randomSample,
    settings.smearVertical,
    settings.smearHorizontal,
    settings.smearDiagonal1,
    settings.smearDiagonal2,
    settings.smearRecursive,
    settings.verticalWeight,
    settings.horizontalWeight,
    settings.diagonal1Weight,
    settings.diagonal2Weight,
    settings.recursiveWeight,
    settings.showNoiseMap,
    settings.showCellLayout,
    scheduleRegen,
  ])

  /**
   * Grain-only refresh, reusing the retained Phase 2 frame. Declared after the render
   * effect on purpose — see the ordering note there.
   */
  useEffect(() => {
    if (!sourceBitmapRef.current || !phase2BitmapRef.current) return
    if (paused) return
    schedulePhase3Only()
  }, [
    paused,
    settings.textureEnabled,
    settings.textureOpacity,
    schedulePhase3Only,
  ])

  useEffect(() => {
    let cancelled = false

    if (!imageSrc) {
      jobIdRef.current += 1
      lastPostedCompositeJobIdRef.current = jobIdRef.current
      lastShownCompositeJobIdRef.current = jobIdRef.current
      pendingRegenRef.current = false
      effectBusyRef.current = false
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
        jobIdRef.current += 1
        lastPostedCompositeJobIdRef.current = jobIdRef.current
        lastShownCompositeJobIdRef.current = jobIdRef.current
        pendingRegenRef.current = false
        const pendingComposite = pendingCompositeRef.current
        if (pendingComposite) {
          pendingComposite.phase2.close()
          pendingCompositeRef.current = null
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
    image.onerror = () => {
      if (cancelled) return
      // Dead/revoked blob URL (e.g. a stale history thumbnail) — leave the
      // worker's source cleared rather than stuck mid-swap with no bitmaps.
      console.error("[pixel-by-day] Failed to load source image; it may be a revoked blob URL")
      workerRef.current?.postMessage({ type: "clearSource" })
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
