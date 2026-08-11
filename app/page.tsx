"use client";

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type {
  EffectSettings,
  EffectWorkerOutMessage,
  LayoutMode,
  SmearStyleSettings,
  SubdivisionMode,
} from "@/lib/effect-types"
import { cn } from "@/lib/utils"

function sliderValue(value: number | readonly number[], fallback = 0) {
  const raw = Array.isArray(value) ? value[0] : value
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function defaultSmear(enabled: boolean, amount = 50): SmearStyleSettings {
  return { enabled, amount }
}

function fitCanvasDisplay(canvas: HTMLCanvasElement) {
  if (canvas.width < 1 || canvas.height < 1) return

  // Stacked layout below md (768px): sidebar sits above canvas
  const stacked = window.innerWidth < 768
  const maxWidth = stacked
    ? Math.max(240, window.innerWidth - 48)
    : Math.max(320, Math.min(1200, window.innerWidth - 380))
  const maxHeight = stacked
    ? Math.max(200, window.innerHeight * 0.55)
    : Math.max(240, Math.min(window.innerHeight * 0.8, window.innerHeight - 160))

  const scale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height)
  canvas.style.width = `${Math.round(canvas.width * scale)}px`
  canvas.style.height = `${Math.round(canvas.height * scale)}px`
}

function prepareCanvasPreview(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number
) {
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.drawImage(source, 0, 0, width, height)
  }
  fitCanvasDisplay(canvas)
}

function releaseCompositeBitmap(bitmap: ImageBitmap | null) {
  if (!bitmap) return
  try {
    bitmap.close()
  } catch {
    // already closed
  }
}

function randomSeed() {
  return Math.floor(10000 + Math.random() * 90000)
}

export default function Home() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [seed, setSeed] = useState(randomSeed)
  const [isDragging, setIsDragging] = useState(false)
  const [isExportingPng, setIsExportingPng] = useState(false)
  const [sampleInPlace, setSampleInPlace] = useState(true)
  const [smearVertical, setSmearVertical] = useState(() => defaultSmear(false, 50))
  const [smearHorizontal, setSmearHorizontal] = useState(() =>
    defaultSmear(false, 50)
  )
  const [smearDiagonal, setSmearDiagonal] = useState(() => defaultSmear(false, 50))
  const [smearDrift, setSmearDrift] = useState(() => defaultSmear(false, 50))
  const [smearRecursive, setSmearRecursive] = useState(() =>
    defaultSmear(false, 50)
  )
  const [smearStrip, setSmearStrip] = useState(() => defaultSmear(false, 50))
  const [noiseScale, setNoiseScale] = useState(19)
  const [noiseSpread, setNoiseSpread] = useState(50)
  const [maxPixelSize, setMaxPixelSize] = useState(20)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("standard")
  const [subdivisionLoops, setSubdivisionLoops] = useState(3)
  const [subdivisionMode, setSubdivisionMode] =
    useState<SubdivisionMode>("frontier")
  const [subdivisionRate, setSubdivisionRate] = useState(60)
  const [showNoiseMap, setShowNoiseMap] = useState(false)
  const [showPixelLayout, setShowPixelLayout] = useState(false)
  const [overlayDebug, setOverlayDebug] = useState(false)
  const [weightDither, setWeightDither] = useState(0)
  const [weightInvert, setWeightInvert] = useState(25)
  const [weightSurreal, setWeightSurreal] = useState(25)
  const [weightPixelate, setWeightPixelate] = useState(0)
  const [weightOriginal, setWeightOriginal] = useState(25)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const dispatchRafRef = useRef<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const jobIdRef = useRef(0)
  const pendingDispatchRef = useRef(false)
  const compositeBitmapRef = useRef<ImageBitmap | null>(null)
  const sourceBitmapRef = useRef<ImageBitmap | null>(null)

  const effectSettingsRef = useRef<EffectSettings | null>(null)
  // Keep the ref in sync during render so rAF-coalesced worker posts never
  // read a stale snapshot (useEffect-after-paint can race requestAnimationFrame).
  effectSettingsRef.current = {
    seed,
    weightDither,
    weightInvert,
    weightSurreal,
    weightPixelate,
    weightOriginal,
    sampleInPlace,
    smearVertical,
    smearHorizontal,
    smearDiagonal,
    smearDrift,
    smearRecursive,
    smearStrip,
    noiseScale,
    noiseSpread,
    maxPixelSize,
    layoutMode,
    subdivisionLoops,
    subdivisionMode,
    subdivisionRate,
    showNoiseMap,
    showPixelLayout,
    overlayDebug,
  }

  function processFile(file: File) {
    if (!file.type.startsWith("image/")) return
    // Cap uploads to keep worker memory reasonable (~40MB binary ≈ large photo).
    if (file.size > 40 * 1024 * 1024) {
      console.warn("[pixel-by-day] Image exceeds 40MB limit")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageSrc(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  function releaseSourceBitmap() {
    if (sourceBitmapRef.current) {
      sourceBitmapRef.current.close()
      sourceBitmapRef.current = null
    }
  }

  function applyWorkerResult(
    width: number,
    height: number,
    bitmap: ImageBitmap
  ) {
    const canvas = liveCanvasRef.current
    if (!canvas) {
      bitmap.close()
      return
    }

    releaseCompositeBitmap(compositeBitmapRef.current)
    compositeBitmapRef.current = bitmap
    prepareCanvasPreview(canvas, bitmap, width, height)
  }

  const dispatchWorkerRender = useCallback(() => {
    const worker = workerRef.current
    const source = sourceBitmapRef.current
    const settings = effectSettingsRef.current
    if (!worker || !source || !settings) return

    // Monotonic job id — worker aborts any in-flight layout whose id is older.
    const jobId = ++jobIdRef.current
    worker.postMessage({
      type: "render",
      jobId,
      // Plain clone of the latest settings snapshot (coalesced scrubbing)
      settings: { ...settings },
    })
  }, [])

  /**
   * Coalesce regenerations to one post per requestAnimationFrame tick.
   * Scrubbing sliders at 60+ Hz collapses to a single latest-wins dispatch;
   * the worker drops stale jobs via activeJobId.
   */
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

  function handleExportHighResImage() {
    const settings = effectSettingsRef.current
    if (!sourceBitmapRef.current || !workerRef.current || isExportingPng || !settings)
      return
    setIsExportingPng(true)
    workerRef.current.postMessage({
      type: "EXPORT",
      settings: { ...settings },
    })
  }

  function handleShowNoiseMapChange(checked: boolean) {
    setShowNoiseMap(checked)
    if (checked) setShowPixelLayout(false)
  }

  function handleShowPixelLayoutChange(checked: boolean) {
    setShowPixelLayout(checked)
    if (checked) setShowNoiseMap(false)
  }

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/effect-worker.ts", import.meta.url)
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<EffectWorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === "result") {
        if (msg.jobId !== jobIdRef.current) {
          msg.bitmap.close()
          return
        }
        applyWorkerResult(msg.width, msg.height, msg.bitmap)
        return
      }
      if (msg.type === "error") {
        console.error("[effect-worker]", msg.message)
        return
      }
      if (msg.type === "EXPORT_COMPLETE") {
        setIsExportingPng(false)
        const url = URL.createObjectURL(msg.blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `generated-mosaic-${Date.now()}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        return
      }
      if (msg.type === "EXPORT_ERROR") {
        setIsExportingPng(false)
        console.error("[effect-worker export]", msg.message)
      }
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  // Effect-parameter changes dispatch full worker jobs (rAF-throttled).
  useEffect(() => {
    if (!sourceBitmapRef.current || !workerRef.current) return
    scheduleRegen()
  }, [
    seed,
    noiseScale,
    noiseSpread,
    maxPixelSize,
    layoutMode,
    subdivisionLoops,
    subdivisionMode,
    subdivisionRate,
    weightDither,
    weightInvert,
    weightSurreal,
    weightPixelate,
    weightOriginal,
    sampleInPlace,
    smearVertical,
    smearHorizontal,
    smearDiagonal,
    smearDrift,
    smearRecursive,
    smearStrip,
    showNoiseMap,
    showPixelLayout,
    overlayDebug,
    scheduleRegen,
  ])

  useEffect(() => {
    let cancelled = false

    if (!imageSrc) {
      workerRef.current?.postMessage({ type: "clearSource" })
      releaseSourceBitmap()
      releaseCompositeBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = null
      return
    }

    releaseCompositeBitmap(compositeBitmapRef.current)
    compositeBitmapRef.current = null
    releaseSourceBitmap()

    const image = new Image()
    image.onload = async () => {
      if (cancelled) return
      try {
        const bitmap = await createImageBitmap(image)
        if (cancelled) {
          bitmap.close()
          return
        }
        releaseSourceBitmap()
        sourceBitmapRef.current = bitmap

        const canvas = liveCanvasRef.current
        if (canvas) {
          prepareCanvasPreview(canvas, bitmap, bitmap.width, bitmap.height)
        }

        // Clone + transfer a worker-owned ImageBitmap; main keeps its cache
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

  useEffect(() => {
    function handleResize() {
      const canvas = liveCanvasRef.current
      if (canvas && canvas.width > 0) {
        fitCanvasDisplay(canvas)
      }
    }

    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
      if (dispatchRafRef.current !== null) {
        cancelAnimationFrame(dispatchRafRef.current)
        dispatchRafRef.current = null
      }
      releaseCompositeBitmap(compositeBitmapRef.current)
      compositeBitmapRef.current = null
      releaseSourceBitmap()
    }
  }, [])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    processFile(file)
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const file = event.dataTransfer.files[0]
    if (!file || !file.type.startsWith("image/")) return
    processFile(file)
  }

  const floatingCard =
    "shrink-0 overflow-visible rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-[#f5f5f7] shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"
  const chromeButton =
    "w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 text-sm font-semibold text-slate-950 shadow-lg hover:from-slate-200 hover:via-slate-300 hover:to-slate-400"
  const pageTitle = "text-xl font-semibold tracking-tight text-[#f5f5f7]"
  const sectionTitle =
    "text-xs font-medium uppercase tracking-[0.12em] text-slate-400"
  const controlLabel = "text-sm text-slate-400"
  const helperText = "text-xs text-slate-500"
  const bodyText = "text-sm font-medium text-slate-200"

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-slate-900 via-[#08080a] to-black text-[#f5f5f7]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <aside className="flex w-full shrink-0 flex-col gap-6 overflow-x-hidden border-none bg-transparent p-6 pb-8 md:h-full md:w-80 md:overflow-y-auto">
        <div className={cn(floatingCard, "flex flex-col gap-4")}>
          <h1 className={pageTitle}>Pixel By Day</h1>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative aspect-[21/9] w-full overflow-hidden rounded-xl bg-transparent md:aspect-video"
          >
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
            >
              <rect
                x="1"
                y="1"
                rx="11"
                ry="11"
                fill="none"
                stroke={isDragging ? "rgba(168, 196, 224, 0.65)" : "rgba(137, 164, 199, 0.38)"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="0.01 3.5"
                style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
              />
            </svg>
            {imageSrc ? (
              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ""
                    fileInputRef.current.click()
                  }
                }}
                className="group relative size-full"
              >
                {/* User-uploaded preview; next/image is not suitable for ephemeral data URLs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageSrc}
                  alt="Uploaded source image"
                  className="pointer-events-none absolute inset-0 size-full object-cover"
                />
                <span className="absolute bottom-2 right-2 z-10 flex items-center justify-center rounded-lg border border-white/10 bg-black/65 px-2.5 py-1 text-xs font-medium leading-none text-white shadow-lg backdrop-blur-sm transition-colors group-hover:bg-black/80">
                  Load
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-full flex-col items-center justify-center gap-1.5 bg-transparent px-4 text-center"
              >
                <span className="pointer-events-none flex size-9 items-center justify-center rounded-lg border border-white/10 bg-transparent text-sm font-medium leading-none text-slate-300">
                  +
                </span>
                <span className={cn("pointer-events-none", bodyText)}>
                  {isDragging ? "Drop image here" : "Drag and drop an image"}
                </span>
                {!isDragging && (
                  <span className={cn("pointer-events-none", helperText)}>
                    or click to upload
                  </span>
                )}
              </button>
            )}
          </div>

          <div className="flex h-9 w-full items-center gap-3">
            <label htmlFor="global-seed" className={cn("shrink-0", controlLabel)}>
              Seed
            </label>
            <div className="flex h-full min-w-0 flex-1 items-center rounded-lg border border-white/10 bg-transparent">
              <button
                type="button"
                aria-label="Decrease seed"
                onClick={() => setSeed((prev) => Math.max(0, prev - 1))}
                className="inline-flex h-full shrink-0 items-center justify-center px-2.5 text-slate-400 transition-colors hover:text-slate-100"
              >
                <ChevronLeft className="size-4" strokeWidth={2} />
              </button>
              <input
                id="global-seed"
                type="text"
                inputMode="numeric"
                value={seed}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "")
                  if (digits === "") {
                    setSeed(0)
                    return
                  }
                  const next = Number.parseInt(digits, 10)
                  if (Number.isFinite(next)) {
                    setSeed(Math.max(0, Math.min(99999, next)))
                  }
                }}
                className="min-w-0 flex-1 bg-transparent py-2 text-center text-sm font-medium tabular-nums text-slate-200 outline-none"
              />
              <button
                type="button"
                aria-label="Increase seed"
                onClick={() => setSeed((prev) => Math.min(99999, prev + 1))}
                className="inline-flex h-full shrink-0 items-center justify-center px-2.5 text-slate-400 transition-colors hover:text-slate-100"
              >
                <ChevronRight className="size-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>

        <CollapsibleCallout title="Noise" defaultOpen className={floatingCard} titleClassName={sectionTitle}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <label htmlFor="show-noise-map" className={controlLabel}>
                  Visualize Noise
                </label>
              </div>
              <Switch
                id="show-noise-map"
                checked={showNoiseMap}
                onCheckedChange={handleShowNoiseMapChange}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <label htmlFor="show-pixel-layout" className={controlLabel}>
                  Show Pixel Layout
                </label>
              </div>
              <Switch
                id="show-pixel-layout"
                checked={showPixelLayout}
                onCheckedChange={handleShowPixelLayoutChange}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <label htmlFor="overlay-debug" className={controlLabel}>
                  Overlay Debug
                </label>
              </div>
              <Switch
                id="overlay-debug"
                checked={overlayDebug}
                onCheckedChange={setOverlayDebug}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <label htmlFor="sample-in-place" className={controlLabel}>
                  Sample In Place
                </label>
              </div>
              <Switch
                id="sample-in-place"
                checked={sampleInPlace}
                onCheckedChange={setSampleInPlace}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="noise-scale" className={controlLabel}>
                  Noise Scale
                </label>
              </div>
              <Slider
                id="noise-scale"
                value={[noiseScale]}
                min={1}
                max={100}
                step={1}
                onValueChange={(value) => setNoiseScale(sliderValue(value, 19))}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="noise-spread" className={controlLabel}>
                  Noise Spread
                </label>
              </div>
              <Slider
                id="noise-spread"
                value={[noiseSpread]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setNoiseSpread(sliderValue(value, 50))}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className={controlLabel}>Layout Mode</span>
              <div
                role="group"
                aria-label="Layout Mode"
                className="inline-flex rounded-lg border border-white/10 bg-slate-950/40 p-0.5"
              >
                {(
                  [
                    { id: "standard", label: "Standard" },
                    { id: "subdivision", label: "Subdivision" },
                  ] as const
                ).map((option) => {
                  const active = layoutMode === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setLayoutMode(option.id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-slate-200 text-slate-950"
                          : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {layoutMode === "standard" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="max-pixel-size" className={controlLabel}>
                    Max Pixel Size
                  </label>
                </div>
                <Slider
                  id="max-pixel-size"
                  value={[maxPixelSize]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={(value) =>
                    setMaxPixelSize(sliderValue(value, 1))
                  }
                />
              </div>
            )}

            {layoutMode === "subdivision" && (
              <>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="subdivision-loops" className={controlLabel}>
                      Subdivision Loops
                    </label>
                  </div>
                  <Slider
                    id="subdivision-loops"
                    value={[subdivisionLoops]}
                    min={1}
                    max={7}
                    step={1}
                    onValueChange={(value) =>
                      setSubdivisionLoops(sliderValue(value, 3))
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className={controlLabel}>Subdivision Mode</span>
                  <div
                    role="group"
                    aria-label="Subdivision Mode"
                    className="inline-flex rounded-lg border border-white/10 bg-slate-950/40 p-0.5"
                  >
                    {(
                      [
                        { id: "frontier", label: "Frontier" },
                        { id: "global", label: "Global" },
                      ] as const
                    ).map((option) => {
                      const active = subdivisionMode === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSubdivisionMode(option.id)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            active
                              ? "bg-slate-200 text-slate-950"
                              : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="subdivision-rate" className={controlLabel}>
                      Subdivision Rate
                    </label>
                  </div>
                  <Slider
                    id="subdivision-rate"
                    value={[subdivisionRate]}
                    min={10}
                    max={100}
                    step={1}
                    onValueChange={(value) =>
                      setSubdivisionRate(sliderValue(value, 60))
                    }
                  />
                </div>
              </>
            )}

        </CollapsibleCallout>

        <CollapsibleCallout title="Smear Styles" className={floatingCard} titleClassName={sectionTitle}>
          {(
            [
              {
                id: "vertical",
                label: "Vertical",
                value: smearVertical,
                set: setSmearVertical,
              },
              {
                id: "horizontal",
                label: "Horizontal",
                value: smearHorizontal,
                set: setSmearHorizontal,
              },
              {
                id: "diagonal",
                label: "Diagonal",
                value: smearDiagonal,
                set: setSmearDiagonal,
              },
              {
                id: "drift",
                label: "Drift",
                value: smearDrift,
                set: setSmearDrift,
              },
              {
                id: "recursive",
                label: "Recursive",
                value: smearRecursive,
                set: setSmearRecursive,
              },
              {
                id: "strip",
                label: "Strip Feedback",
                value: smearStrip,
                set: setSmearStrip,
              },
            ] as const
          ).map((style) => (
            <div key={style.id} className="flex flex-col gap-3 border-b border-white/5 pb-4 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <label htmlFor={`smear-${style.id}`} className={controlLabel}>
                    {style.label}
                  </label>
                </div>
                <Switch
                  id={`smear-${style.id}`}
                  checked={style.value.enabled}
                  onCheckedChange={(checked) =>
                    style.set({ ...style.value, enabled: checked })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor={`smear-${style.id}-amount`} className={helperText}>
                  Amount
                </label>
                <Slider
                  id={`smear-${style.id}-amount`}
                  value={[style.value.amount]}
                  min={0}
                  max={100}
                  step={1}
                  disabled={!style.value.enabled}
                  onValueChange={(value) =>
                    style.set({
                      ...style.value,
                      amount: sliderValue(value, 50),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </CollapsibleCallout>

        <CollapsibleCallout title="Effects" className={floatingCard} titleClassName={sectionTitle}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-pixelate" className={controlLabel}>
                  Pixelate
                </label>
              </div>
              <Slider
                id="weight-pixelate"
                value={[weightPixelate]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setWeightPixelate(sliderValue(value))}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-invert" className={controlLabel}>
                  Invert
                </label>
              </div>
              <Slider
                id="weight-invert"
                value={[weightInvert]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setWeightInvert(sliderValue(value, 25))}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-surreal" className={controlLabel}>
                  Surreal
                </label>
              </div>
              <Slider
                id="weight-surreal"
                value={[weightSurreal]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setWeightSurreal(sliderValue(value, 25))}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-dither" className={controlLabel}>
                  Dither
                </label>
              </div>
              <Slider
                id="weight-dither"
                value={[weightDither]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setWeightDither(sliderValue(value))}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-original" className={controlLabel}>
                  Original
                </label>
              </div>
              <Slider
                id="weight-original"
                value={[weightOriginal]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setWeightOriginal(sliderValue(value, 25))}
              />
            </div>
        </CollapsibleCallout>
      </aside>

      <main className="flex w-full shrink-0 flex-col p-6 md:min-h-0 md:min-w-0 md:flex-1 md:overflow-hidden">
        <div
          className={cn(
            floatingCard,
            "flex min-h-[55vh] flex-col gap-0 overflow-hidden p-0 md:min-h-0 md:flex-1"
          )}
        >
          <div className="flex w-full flex-1 items-center justify-center overflow-hidden p-4 text-slate-500 sm:p-6">
            {imageSrc ? (
              <div className="flex h-full max-h-[80vh] w-full max-w-[1200px] items-center justify-center overflow-hidden">
                <canvas
                  ref={liveCanvasRef}
                  className="block h-full w-full object-contain"
                />
              </div>
            ) : (
              <span className={cn("px-6 text-center", helperText)}>
                Upload an image to get started
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-white/10 px-6 py-4">
            <Button
              className={cn(chromeButton, "w-auto px-4")}
              disabled={!imageSrc || isExportingPng}
              onClick={handleExportHighResImage}
            >
              {isExportingPng ? "Exporting…" : "Export High-Res Image"}
            </Button>
          </div>
        </div>
      </main>
      </div>
      <footer className="w-full shrink-0 border-t border-white/10 py-3 text-center text-xs text-slate-500">
        Designed and created by{" "}
        <a
          href="https://www.instagram.com/walidazizbash"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-slate-300"
        >
          Walid Aziz Basharyar
        </a>
      </footer>
    </div>
  )
}
