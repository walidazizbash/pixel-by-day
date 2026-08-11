"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CompositeTextureSettings,
  CompositeWorkerOutMessage,
  EffectSettings,
  EffectWorkerOutMessage,
} from "@/lib/effect-types"

function releaseBitmap(bitmap: ImageBitmap | null) {
  if (!bitmap) return
  try {
    bitmap.close()
  } catch {
    // already closed
  }
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

/** Export always ships the finished mosaic — never debug overlay frames. */
function exportSettingsFrom(settings: EffectSettings): EffectSettings {
  return {
    ...settings,
    showNoiseMap: false,
    showCellLayout: false,
  }
}

function textureSettingsFrom(
  settings: EffectSettings
): CompositeTextureSettings {
  return {
    textureEnabled: settings.textureEnabled,
    textureOpacity: settings.textureOpacity,
  }
}

export type UseAppWorkersOptions = {
  settings: EffectSettings
  imageSrc: string | null
  /** Draw a finished composite frame to the live canvas. */
  onPreviewFrame: (width: number, height: number, bitmap: ImageBitmap) => void
  /** Draw the raw source while the first worker job is pending. */
  onSourcePreview?: (width: number, height: number, bitmap: ImageBitmap) => void
}

export type UseAppWorkersResult = {
  isExportingPng: boolean
  exportHighResImage: () => void
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
  const compositeBitmapRef = useRef<ImageBitmap | null>(null)
  const sourceBitmapRef = useRef<ImageBitmap | null>(null)
  /** Last finished Phase 2 frame — reused for texture-only Phase 3 updates. */
  const phase2BitmapRef = useRef<ImageBitmap | null>(null)

  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const onPreviewFrameRef = useRef(onPreviewFrame)
  onPreviewFrameRef.current = onPreviewFrame

  const onSourcePreviewRef = useRef(onSourcePreview)
  onSourcePreviewRef.current = onSourcePreview

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
    const effectSettings = settingsRef.current
    if (
      !sourceBitmapRef.current ||
      !workerRef.current ||
      isExportingPng ||
      !effectSettings
    ) {
      return
    }
    setIsExportingPng(true)
    workerRef.current.postMessage({
      type: "EXPORT",
      settings: exportSettingsFrom(effectSettings),
    })
  }, [isExportingPng])

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
      if (msg.type === "EXPORT_COMPLETE") {
        const effectSettings = settingsRef.current
        if (effectSettings?.textureEnabled && compositeWorkerRef.current) {
          void (async () => {
            try {
              const phase2 = await createImageBitmap(msg.blob)
              compositeWorkerRef.current!.postMessage(
                {
                  type: "EXPORT",
                  source: phase2,
                  settings: textureSettingsFrom(effectSettings),
                },
                [phase2]
              )
            } catch (err) {
              setIsExportingPng(false)
              console.error("[pixel-by-day] Phase 3 export prep failed", err)
            }
          })()
          return
        }

        setIsExportingPng(false)
        downloadPngBlob(msg.blob)
        return
      }
      if (msg.type === "EXPORT_ERROR") {
        setIsExportingPng(false)
        console.error("[effect-worker export]", msg.message)
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
      if (msg.type === "EXPORT_COMPLETE") {
        setIsExportingPng(false)
        downloadPngBlob(msg.blob)
        return
      }
      if (msg.type === "EXPORT_ERROR") {
        setIsExportingPng(false)
        console.error("[composite-worker export]", msg.message)
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
    settings.weightDither,
    settings.weightInvert,
    settings.weightSurreal,
    settings.weightPixelate,
    settings.weightOriginal,
    settings.randomSample,
    settings.smearVertical,
    settings.smearHorizontal,
    settings.smearDiagonal,
    settings.smearDrift,
    settings.smearRecursive,
    settings.smearStrip,
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

    const image = new Image()
    image.onload = async () => {
      if (cancelled) return
      try {
        const bitmap = await createImageBitmap(image)
        if (cancelled) {
          bitmap.close()
          return
        }
        sourceBitmapRef.current = bitmap

        onSourcePreviewRef.current?.(bitmap.width, bitmap.height, bitmap)

        const workerBitmap = await createImageBitmap(bitmap)
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
  }
}
