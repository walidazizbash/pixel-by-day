"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CompositeTextureSettings,
  CompositeWorkerOutMessage,
  EffectSettings,
  EffectWorkerOutMessage,
  SpeedRampPoint,
} from "@/lib/effect-types"
import { MAX_DECODE_EDGE, MAX_DECODE_PIXELS } from "@/lib/constants"
import { DEFAULT_SPEED_RAMP } from "@/lib/speed-ramp"

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
  /**
   * Per-Cell Live Play speed curve (see `lib/speed-ramp.ts`). Sibling of the
   * offset passed to `renderLiveFrame` / `setLiveOffsetY`, not part of
   * `settings` — it only has an effect once that offset is nonzero, so it must
   * never trigger the settings-driven regen effect. Read fresh at dispatch
   * time, same as the offset.
   */
  speedRamp?: readonly SpeedRampPoint[]
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
  /**
   * Live Play: try to post one frame at the given offset, straight past React.
   * The caller drives this from a `requestAnimationFrame` loop with the offset
   * in a ref — routing it through `setState` would re-render the whole
   * unmemoized control tree every frame.
   *
   * Returns whether the frame was actually dispatched. A dropped frame commits
   * nothing, so the caller must only advance its offset on `true`: the stored
   * offset has to stay equal to the one on screen, or the next settings-driven
   * render would jump the pixels forward by every tick that was skipped.
   */
  renderLiveFrame: (offsetY: number) => boolean
  /**
   * Overwrite the offset the *next* render dispatch will use, without dispatching
   * one itself. For History Restore: the caller sets this to the snapshot's
   * captured offset, then the settings-driven effect's own `paused` transition
   * (already forced by closing the modal) renders at that offset instead of
   * wherever Live Play happened to be when the preview was opened.
   */
  setLiveOffsetY: (offsetY: number) => void
  /**
   * Offset of the last frame whose pixels were drawn to the live canvas.
   * History Capture must use this — not the Live Play loop's dispatch cursor —
   * so Restore regenerates the frame that was actually on screen.
   */
  getPaintedLiveOffsetY: () => number
}

export function useAppWorkers({
  settings,
  imageSrc,
  paused = false,
  speedRamp = DEFAULT_SPEED_RAMP,
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
  /**
   * Offset of the last frame actually dispatched — never of one that was
   * dropped. Read by every dispatch, not just the animated ones, so a slider
   * moved while playing (or long after pausing) renders at exactly the position
   * the canvas is already showing.
   */
  const liveOffsetYRef = useRef(0)
  /**
   * Offset of the last frame whose pixels were drawn to the live canvas.
   * Capture reads this so a History snapshot matches the painted frame, not a
   * newer offset that was only dispatched and is still in flight.
   */
  const paintedOffsetYRef = useRef(0)
  /** jobId → offsetY for in-flight renders, so a painted result can recover it. */
  const jobOffsetByIdRef = useRef(new Map<number, number>())
  /** Mirrors the `speedRamp` prop for the same reason as `settingsRef`: read fresh at dispatch time, not captured in a stale closure. */
  const speedRampRef = useRef(speedRamp)

  const settingsRef = useRef(settings)
  const onPreviewFrameRef = useRef(onPreviewFrame)
  const onSourcePreviewRef = useRef(onSourcePreview)

  useEffect(() => {
    settingsRef.current = settings
    speedRampRef.current = speedRamp
    onPreviewFrameRef.current = onPreviewFrame
    onSourcePreviewRef.current = onSourcePreview
  }, [settings, speedRamp, onPreviewFrame, onSourcePreview])

  const rememberJobOffset = useCallback((jobId: number, offsetY: number) => {
    const map = jobOffsetByIdRef.current
    map.set(jobId, offsetY)
    if (map.size > 64) {
      const minKeep = jobId - 32
      for (const key of map.keys()) {
        if (key < minKeep) map.delete(key)
      }
    }
  }, [])

  const markPaintedOffset = useCallback((jobId: number) => {
    const offset = jobOffsetByIdRef.current.get(jobId)
    if (offset === undefined) return
    paintedOffsetYRef.current = offset
    jobOffsetByIdRef.current.delete(jobId)
  }, [])

  const applyWorkerResult = useCallback(
    (
      width: number,
      height: number,
      bitmap: ImageBitmap,
      jobId?: number
    ) => {
      releaseBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = bitmap
      if (jobId !== undefined) markPaintedOffset(jobId)
      onPreviewFrameRef.current(width, height, bitmap)
    },
    [markPaintedOffset]
  )

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
      // Same watermark discipline as handlePhase2Result's texture-off path: a
      // pending Phase 2 must not repaint after a newer clean apply, and applying
      // it must retire older in-flight composites so they cannot flash grain back.
      if (pending.jobId < lastShownCompositeJobIdRef.current) {
        pending.phase2.close()
        return
      }
      lastShownCompositeJobIdRef.current = Math.max(
        lastShownCompositeJobIdRef.current,
        pending.jobId
      )
      lastPostedCompositeJobIdRef.current = Math.max(
        lastPostedCompositeJobIdRef.current,
        pending.jobId
      )
      applyWorkerResult(
        pending.phase2.width,
        pending.phase2.height,
        pending.phase2,
        pending.jobId
      )
      return
    }
    if (pending.jobId < lastPostedCompositeJobIdRef.current) {
      pending.phase2.close()
      return
    }
    dispatchComposite(pending.jobId, pending.phase2, pending.settings)
  }, [applyWorkerResult, dispatchComposite])

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
        markPaintedOffset(jobId)
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

      // Stale Phase 2 must never enqueue grain: a newer texture-off job may already
      // have painted, and a late composite with an older jobId would flash grain back.
      if (settingsRef.current.textureEnabled) {
        if (!stillCurrent) {
          bitmap.close()
          return
        }
        enqueueComposite(jobId, bitmap, settingsRef.current)
        return
      }

      if (!stillCurrent) {
        bitmap.close()
        return
      }

      // Texture-off applies count as "shown" so a late lower-id composite cannot win.
      lastShownCompositeJobIdRef.current = Math.max(
        lastShownCompositeJobIdRef.current,
        jobId
      )
      lastPostedCompositeJobIdRef.current = Math.max(
        lastPostedCompositeJobIdRef.current,
        jobId
      )
      releaseBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = bitmap
    },
    [enqueueComposite, markPaintedOffset]
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
    const offsetY = liveOffsetYRef.current
    rememberJobOffset(jobId, offsetY)
    effectBusyRef.current = true
    worker.postMessage({
      type: "render",
      jobId,
      settings: { ...effectSettings },
      offsetY,
      speedRamp: speedRampRef.current,
    })
  }, [rememberJobOffset])

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

      // A Live Play frame or settings regen may have started since we scheduled.
      // Abort rather than steal their jobId and flash a stale Phase 2 under grain.
      if (
        effectBusyRef.current ||
        pendingRegenRef.current ||
        pendingDispatchRef.current
      ) {
        pendingPhase3Ref.current = false
        return
      }

      const effectSettings = settingsRef.current
      const phase2 = phase2BitmapRef.current
      if (!effectSettings || !phase2 || !compositeWorkerRef.current) {
        pendingPhase3Ref.current = false
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
            lastShownCompositeJobIdRef.current = Math.max(
              lastShownCompositeJobIdRef.current,
              jobId
            )
            lastPostedCompositeJobIdRef.current = Math.max(
              lastPostedCompositeJobIdRef.current,
              jobId
            )
            // Phase-3-only re-applies the retained Phase 2 — scroll position unchanged.
            applyWorkerResult(clone.width, clone.height, clone)
            return
          }
          enqueueComposite(jobId, clone, effectSettings)
        } catch (err) {
          console.error("[pixel-by-day] Phase 3 refresh failed", err)
          scheduleRegen()
        } finally {
          pendingPhase3Ref.current = false
        }
      })()
    })
  }, [applyWorkerResult, enqueueComposite, scheduleRegen])

  const renderLiveFrame = useCallback(
    (offsetY: number) => {
      if (!workerRef.current || !sourceBitmapRef.current) return false
      // The worker paces the loop. A frame that arrives while it is still busy is
      // dropped rather than queued, so playback degrades to a lower frame rate
      // instead of accumulating a backlog of stale frames behind the animation.
      if (effectBusyRef.current || pendingRegenRef.current) return false
      // A settings-driven regen is already queued for this frame; it renders at
      // the committed offset, which is what the canvas is already showing.
      if (pendingDispatchRef.current) return false
      // Grain-only refresh owns the next jobId until it posts or aborts — do not
      // interleave a Live Play dispatch or the painted frame can flash un-grained.
      if (pendingPhase3Ref.current) return false

      // Commit only now that the frame is going out. Storing a dropped tick's
      // offset is what made a paused canvas jump on the next slider move: the
      // ref had run ahead of the last frame anyone actually saw.
      liveOffsetYRef.current = offsetY
      dispatchWorkerRender()
      return true
    },
    [dispatchWorkerRender]
  )

  const setLiveOffsetY = useCallback((offsetY: number) => {
    liveOffsetYRef.current = offsetY
    paintedOffsetYRef.current = offsetY
  }, [])

  /** Offset of the pixels currently on the live canvas (for History Capture). */
  const getPaintedLiveOffsetY = useCallback(
    () => paintedOffsetYRef.current,
    []
  )

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
          applyWorkerResult(msg.width, msg.height, msg.bitmap, msg.jobId)
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
      const pendingComposite = pendingCompositeRef.current
      if (pendingComposite) {
        pendingComposite.phase2.close()
        pendingCompositeRef.current = null
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
  }, [applyWorkerResult, dispatchComposite, handlePhase2Result, flushPendingRegen, flushPendingComposite])

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
    settings.weightSlitScan,
    settings.slitScanAmount,
    settings.slitScanFrequency,
    settings.slitScanMode,
    settings.slitScanLuminanceMask,
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
   * Speed ramp is intentionally not in the Phase-1+2 dependency list above: at
   * `offsetY === 0` it cannot change pixels, so dragging the curve must not spend
   * a full regen. Once something is scrolled on screen (Live Play stopped mid-
   * scroll, or a restored History offset after the preview modal closes —
   * `paused` here is History preview, not Live Play), force one job so the
   * canvas tracks the curve.
   */
  useEffect(() => {
    if (!sourceBitmapRef.current || !workerRef.current) return
    if (paused) return
    if (liveOffsetYRef.current === 0) return
    scheduleRegen()
  }, [paused, speedRamp, scheduleRegen])

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
      pendingPhase3Ref.current = false
      paintedOffsetYRef.current = 0
      jobOffsetByIdRef.current.clear()
      const pendingComposite = pendingCompositeRef.current
      if (pendingComposite) {
        pendingComposite.phase2.close()
        pendingCompositeRef.current = null
      }
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
    renderLiveFrame,
    setLiveOffsetY,
    getPaintedLiveOffsetY,
  }
}
