"use client";

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type {
  EffectSettings,
  LayoutMode,
  SmearStyleSettings,
  SubdivisionMode,
} from "@/lib/effect-types"
import { useAppWorkers } from "@/hooks/useAppWorkers"
import { cn } from "@/lib/utils"

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024
/** Reject pathological decode sizes before they enter the worker pipeline. */
const MAX_DECODE_EDGE = 8192
const MAX_DECODE_PIXELS = 36_000_000

function sliderValue(value: number | readonly number[], fallback = 0) {
  const raw = Array.isArray(value) ? value[0] : value
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function defaultSmear(enabled: boolean, amount = 50): SmearStyleSettings {
  return { enabled, amount }
}

function isAllowedImageFile(file: File) {
  return ALLOWED_IMAGE_TYPES.has(file.type)
}

/** Fit canvas CSS size to the preview pane (ResizeObserver target), with window fallback. */
function fitCanvasToPane(
  canvas: HTMLCanvasElement,
  pane: HTMLElement | null
) {
  if (canvas.width < 1 || canvas.height < 1) return

  let maxWidth: number
  let maxHeight: number

  if (pane && pane.clientWidth > 0 && pane.clientHeight > 0) {
    maxWidth = Math.max(40, pane.clientWidth)
    maxHeight = Math.max(40, pane.clientHeight)
  } else {
    // Fallback before the pane mounts or while layout is settling.
    const stacked = window.innerWidth < 768
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    maxWidth = stacked
      ? Math.max(200, window.innerWidth - 32)
      : Math.max(320, Math.min(1200, window.innerWidth - 380))
    maxHeight = stacked
      ? Math.max(140, viewportHeight * 0.38)
      : Math.max(240, Math.min(viewportHeight * 0.8, viewportHeight - 160))
  }

  const scale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height)
  canvas.style.width = `${Math.round(canvas.width * scale)}px`
  canvas.style.height = `${Math.round(canvas.height * scale)}px`
}

function prepareCanvasPreview(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  pane: HTMLElement | null
) {
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.drawImage(source, 0, 0, width, height)
  }
  fitCanvasToPane(canvas, pane)
}

export default function Home() {
  const [imageSrc, setImageSrc] = useState<string | null>(
    "/images/Portrait_01.webp"
  )
  const [seed, setSeed] = useState(20599)
  const [isDragging, setIsDragging] = useState(false)
  const [randomSample, setRandomSample] = useState(false)
  const [edgeClamp, setEdgeClamp] = useState(false)
  const [smearVertical, setSmearVertical] = useState(() => defaultSmear(false, 0))
  const [smearHorizontal, setSmearHorizontal] = useState(() =>
    defaultSmear(true, 4)
  )
  const [smearDiagonal, setSmearDiagonal] = useState(() => defaultSmear(false, 0))
  const [smearRecursive, setSmearRecursive] = useState(() =>
    defaultSmear(true, 20)
  )
  const [noiseScale, setNoiseScale] = useState(19)
  const [noiseSpread, setNoiseSpread] = useState(50)
  const [maxCellSize, setMaxCellSize] = useState(20)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("subdivision")
  const [subdivisionLoops, setSubdivisionLoops] = useState(4)
  const [subdivisionMode, setSubdivisionMode] =
    useState<SubdivisionMode>("frontier")
  const [subdivisionRate, setSubdivisionRate] = useState(60)
  const [showNoiseMap, setShowNoiseMap] = useState(false)
  const [showCellLayout, setShowCellLayout] = useState(false)
  const [textureEnabled, setTextureEnabled] = useState(true)
  const [textureOpacity, setTextureOpacity] = useState(1)
  const [weightDither, setWeightDither] = useState(0)
  const [weightInvert, setWeightInvert] = useState(30)
  const [weightSurreal, setWeightSurreal] = useState(20)
  const [weightPixelate, setWeightPixelate] = useState(0)
  const [weightOriginal, setWeightOriginal] = useState(25)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewPaneRef = useRef<HTMLDivElement>(null)

  const effectSettings: EffectSettings = {
    seed,
    weightDither,
    weightInvert,
    weightSurreal,
    weightPixelate,
    weightOriginal,
    randomSample,
    edgeClamp,
    smearVertical,
    smearHorizontal,
    smearDiagonal,
    smearRecursive,
    noiseScale,
    noiseSpread,
    maxCellSize,
    layoutMode,
    subdivisionLoops,
    subdivisionMode,
    subdivisionRate,
    showNoiseMap,
    showCellLayout,
    textureEnabled,
    textureOpacity,
  }

  const onPreviewFrame = useCallback(
    (width: number, height: number, bitmap: ImageBitmap) => {
      const canvas = liveCanvasRef.current
      if (!canvas) {
        bitmap.close()
        return
      }
      prepareCanvasPreview(
        canvas,
        bitmap,
        width,
        height,
        previewPaneRef.current
      )
    },
    []
  )

  const onSourcePreview = useCallback(
    (width: number, height: number, bitmap: ImageBitmap) => {
      const canvas = liveCanvasRef.current
      if (!canvas) return
      prepareCanvasPreview(
        canvas,
        bitmap,
        width,
        height,
        previewPaneRef.current
      )
    },
    []
  )

  const { isExportingPng, exportHighResImage } = useAppWorkers({
    settings: effectSettings,
    imageSrc,
    onPreviewFrame,
    onSourcePreview,
  })

  function processFile(file: File) {
    if (!isAllowedImageFile(file)) {
      alert("Please upload a JPEG, PNG, WebP, or GIF image.")
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      alert("File is too large. Please upload an image under 40MB.")
      return
    }

    void (async () => {
      try {
        const probe = await createImageBitmap(file)
        const edge = Math.max(probe.width, probe.height)
        const pixels = probe.width * probe.height
        probe.close()
        if (edge > MAX_DECODE_EDGE || pixels > MAX_DECODE_PIXELS) {
          alert(
            "Image dimensions are too large. Please use an image under 8192px on the long edge."
          )
          return
        }

        const url = URL.createObjectURL(file)
        setImageSrc((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev)
          return url
        })
      } catch {
        alert("Could not read that image. Please try another file.")
      }
    })()
  }

  function handleShowNoiseMapChange(checked: boolean) {
    setShowNoiseMap(checked)
    if (checked) setShowCellLayout(false)
  }

  function handleShowCellLayoutChange(checked: boolean) {
    setShowCellLayout(checked)
    if (checked) setShowNoiseMap(false)
  }

  useEffect(() => {
    function refit() {
      const canvas = liveCanvasRef.current
      if (canvas && canvas.width > 0) {
        fitCanvasToPane(canvas, previewPaneRef.current)
      }
    }

    const pane = previewPaneRef.current
    let observer: ResizeObserver | null = null
    if (pane && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => refit())
      observer.observe(pane)
    }

    window.addEventListener("resize", refit)
    window.visualViewport?.addEventListener("resize", refit)
    refit()

    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", refit)
      window.visualViewport?.removeEventListener("resize", refit)
    }
  }, [imageSrc])

  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith("blob:")) URL.revokeObjectURL(imageSrc)
    }
  }, [imageSrc])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    processFile(file)
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const file = event.dataTransfer.files[0]
    if (!file || !isAllowedImageFile(file)) return
    processFile(file)
  }

  const floatingCard =
    "shrink-0 overflow-visible rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-[#f5f5f7] shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"
  const pageTitle =
    "font-heading text-sm font-semibold tracking-tight text-[#f5f5f7]"
  const sectionTitle =
    "font-heading text-xs font-medium uppercase tracking-[0.12em] text-slate-400"
  const controlLabel = "font-body text-sm text-slate-400"
  const helperText = "font-body text-xs text-slate-500"
  const bodyText = "font-body text-sm font-medium text-slate-200"
  const footerText = "font-footer text-xs text-slate-500"
  const footerLink =
    "font-footer text-slate-400 transition-colors hover:text-slate-300"
  const sliderRow = "flex items-center gap-3"
  const sliderValueReadout = cn(
    footerText,
    "w-8 shrink-0 text-right tabular-nums"
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-slate-900 via-[#08080a] to-black font-body text-[#f5f5f7] md:h-screen">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <header className="order-0 flex shrink-0 items-center px-4 py-3 md:hidden">
          <h1 className={pageTitle}>Pixel By Day</h1>
        </header>
        <aside className="order-2 flex min-h-0 w-full flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto border-none bg-transparent p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:order-1 md:h-full md:w-80 md:flex-none md:shrink-0 md:gap-6 md:overflow-y-auto md:p-6 md:pb-8">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
        <h1 className={cn(pageTitle, "hidden shrink-0 md:block")}>Pixel By Day</h1>

        <CollapsibleCallout
          title="Cell Pattern"
          className={floatingCard}
          titleClassName={sectionTitle}
          enabled={showCellLayout}
          enabledLabel="Visualizing"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor="show-cell-layout" className={controlLabel}>
                Show Cell Layout
              </label>
            </div>
            <Switch
              id="show-cell-layout"
              checked={showCellLayout}
              onCheckedChange={handleShowCellLayoutChange}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className={controlLabel}>Mode</span>
            <div
              role="group"
              aria-label="Mode"
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
                <label htmlFor="max-cell-size" className={controlLabel}>
                  Max Cell Size
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="max-cell-size"
                  className="min-w-0 flex-1"
                  value={[maxCellSize]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={(value) =>
                    setMaxCellSize(sliderValue(value, 1))
                  }
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {maxCellSize}
                </span>
              </div>
            </div>
          )}

          {layoutMode === "subdivision" && (
            <>
              <div className="flex items-center justify-between gap-4">
                <span className={controlLabel}>Type</span>
                <div
                  role="group"
                  aria-label="Type"
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
                  <label htmlFor="subdivision-loops" className={controlLabel}>
                    Passes
                  </label>
                </div>
                <div className={sliderRow}>
                  <Slider
                    id="subdivision-loops"
                    className="min-w-0 flex-1"
                    value={[subdivisionLoops]}
                    min={1}
                    max={7}
                    step={1}
                    onValueChange={(value) =>
                      setSubdivisionLoops(sliderValue(value, 4))
                    }
                  />
                  <span className={sliderValueReadout} aria-hidden="true">
                    {subdivisionLoops}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="subdivision-rate" className={controlLabel}>
                    Rate
                  </label>
                </div>
                <div className={sliderRow}>
                  <Slider
                    id="subdivision-rate"
                    className="min-w-0 flex-1"
                    value={[subdivisionRate]}
                    min={10}
                    max={100}
                    step={1}
                    onValueChange={(value) =>
                      setSubdivisionRate(sliderValue(value, 60))
                    }
                  />
                  <span className={sliderValueReadout} aria-hidden="true">
                    {subdivisionRate}
                  </span>
                </div>
              </div>
            </>
          )}
        </CollapsibleCallout>

        <CollapsibleCallout
          title="Noise Mask"
          className={floatingCard}
          titleClassName={sectionTitle}
          enabled={showNoiseMap}
          enabledLabel="Visualizing"
        >
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

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor="noise-scale" className={controlLabel}>
                Noise Scale
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="noise-scale"
                className="min-w-0 flex-1"
                value={[noiseScale]}
                min={1}
                max={100}
                step={1}
                onValueChange={(value) => setNoiseScale(sliderValue(value, 19))}
              />
              <span className={sliderValueReadout} aria-hidden="true">
                {noiseScale}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor="noise-spread" className={controlLabel}>
                Noise Spread
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="noise-spread"
                className="min-w-0 flex-1"
                value={[noiseSpread]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => setNoiseSpread(sliderValue(value, 50))}
              />
              <span className={sliderValueReadout} aria-hidden="true">
                {noiseSpread}
              </span>
            </div>
          </div>
        </CollapsibleCallout>

        <CollapsibleCallout
          title="Effects"
          className={floatingCard}
          titleClassName={sectionTitle}
          enabled={
            randomSample ||
            weightPixelate > 0 ||
            weightInvert > 0 ||
            weightSurreal > 0 ||
            weightDither > 0 ||
            weightOriginal > 0
          }
        >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <label htmlFor="random-sample" className={controlLabel}>
                  Random Sample
                </label>
              </div>
              <Switch
                id="random-sample"
                checked={randomSample}
                onCheckedChange={setRandomSample}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-pixelate" className={controlLabel}>
                  Pixelate
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-pixelate"
                  className="min-w-0 flex-1"
                  value={[weightPixelate]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setWeightPixelate(sliderValue(value))}
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {weightPixelate}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-invert" className={controlLabel}>
                  Invert
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-invert"
                  className="min-w-0 flex-1"
                  value={[weightInvert]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setWeightInvert(sliderValue(value, 30))}
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {weightInvert}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-surreal" className={controlLabel}>
                  Surreal
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-surreal"
                  className="min-w-0 flex-1"
                  value={[weightSurreal]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setWeightSurreal(sliderValue(value, 20))}
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {weightSurreal}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-dither" className={controlLabel}>
                  Dither
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-dither"
                  className="min-w-0 flex-1"
                  value={[weightDither]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setWeightDither(sliderValue(value))}
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {weightDither}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-original" className={controlLabel}>
                  Original
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-original"
                  className="min-w-0 flex-1"
                  value={[weightOriginal]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setWeightOriginal(sliderValue(value, 25))}
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {weightOriginal}
                </span>
              </div>
            </div>
        </CollapsibleCallout>

        <CollapsibleCallout
          title="Smear"
          className={floatingCard}
          titleClassName={sectionTitle}
          enabled={
            smearVertical.enabled ||
            smearHorizontal.enabled ||
            smearDiagonal.enabled ||
            smearRecursive.enabled
          }
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor="edge-clamp" className={controlLabel}>
                Edge Clamp
              </label>
            </div>
            <Switch
              id="edge-clamp"
              checked={edgeClamp}
              onCheckedChange={setEdgeClamp}
            />
          </div>
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
                id: "recursive",
                label: "Recursive",
                value: smearRecursive,
                set: setSmearRecursive,
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
                <div className={sliderRow}>
                  <Slider
                    id={`smear-${style.id}-amount`}
                    className="min-w-0 flex-1"
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
                  <span className={sliderValueReadout} aria-hidden="true">
                    {style.value.amount}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </CollapsibleCallout>

        <CollapsibleCallout
          title="Post-Process"
          className={floatingCard}
          titleClassName={sectionTitle}
          enabled={textureEnabled}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor="texture-enabled" className={controlLabel}>
                Apply 35mm Grain
              </label>
            </div>
            <Switch
              id="texture-enabled"
              checked={textureEnabled}
              onCheckedChange={setTextureEnabled}
            />
          </div>

          {textureEnabled && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <label htmlFor="texture-opacity" className={controlLabel}>
                  Grain Opacity
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="texture-opacity"
                  className="min-w-0 flex-1"
                  value={[textureOpacity]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(value) =>
                    setTextureOpacity(sliderValue(value, 1))
                  }
                />
                <span className={sliderValueReadout} aria-hidden="true">
                  {Math.round(textureOpacity * 100)}
                </span>
              </div>
            </div>
          )}
        </CollapsibleCallout>
        <p className={cn("px-1 pb-2 text-center text-slate-600 md:hidden", footerText)}>
          Designed and created by{" "}
          <a
            href="https://www.instagram.com/walidazizbash"
            target="_blank"
            rel="noopener noreferrer"
            className={footerLink}
          >
            Walid Aziz Basharyar
          </a>
        </p>
      </aside>

      <main className="order-1 flex h-[45dvh] w-full shrink-0 flex-col px-3 pb-3 pt-0 md:order-2 md:h-auto md:min-h-0 md:min-w-0 md:flex-1 md:overflow-hidden md:p-6">
        <div
          className={cn(
            floatingCard,
            "flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0 md:min-h-0 md:flex-1"
          )}
        >
          <div className="relative flex min-h-0 w-full flex-1 touch-none items-center justify-center overflow-hidden p-2 text-slate-500 sm:p-4 md:p-6">
            {imageSrc ? (
              <div
                ref={previewPaneRef}
                className="flex h-full max-h-full w-full max-w-[1200px] touch-none items-center justify-center overflow-hidden md:max-h-[80vh]"
                style={{ touchAction: "none" }}
              >
                <canvas
                  ref={liveCanvasRef}
                  className="block touch-none"
                  style={{ touchAction: "none" }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="absolute inset-0 z-0 flex touch-auto flex-col items-center justify-center gap-1.5 px-6 text-center"
              >
                <span className="pointer-events-none flex size-9 items-center justify-center rounded-lg border border-white/10 bg-transparent text-sm font-medium leading-none text-slate-300 sm:size-[4.5rem] sm:rounded-xl sm:text-2xl">
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
          <div className="grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-white/10 px-3 py-1 md:px-6 md:py-4">
            <Button
              type="button"
              size="sm"
              className="h-7 w-[3.25rem] shrink-0 justify-self-start rounded-md border border-white/10 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 px-2.5 text-xs font-semibold text-slate-950 shadow-none transition-[background,opacity,transform] hover:from-slate-200 hover:via-slate-300 hover:to-slate-400 md:h-8"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.value = ""
                  fileInputRef.current.click()
                }
              }}
            >
              Load
            </Button>

            <div className="flex min-w-0 max-w-[10rem] items-center justify-self-center gap-1.5 md:max-w-[12rem]">
              <label
                htmlFor="canvas-seed"
                className="shrink-0 text-xs text-slate-400 md:text-sm"
              >
                Seed
              </label>
              <div className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-white/10 bg-transparent md:h-8 md:rounded-lg">
                <button
                  type="button"
                  aria-label="Decrease seed"
                  onClick={() => setSeed((prev) => Math.max(0, prev - 1))}
                  className="inline-flex h-full shrink-0 items-center justify-center px-1.5 text-slate-400 transition-colors hover:text-slate-100 md:px-2"
                >
                  <ChevronLeft className="size-3.5 md:size-4" strokeWidth={2} />
                </button>
                <input
                  id="canvas-seed"
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
                  className="min-w-0 w-11 flex-1 bg-transparent py-1 text-center text-xs font-medium tabular-nums text-slate-200 outline-none md:w-12 md:py-2 md:text-sm"
                />
                <button
                  type="button"
                  aria-label="Increase seed"
                  onClick={() => setSeed((prev) => Math.min(99999, prev + 1))}
                  className="inline-flex h-full shrink-0 items-center justify-center px-1.5 text-slate-400 transition-colors hover:text-slate-100 md:px-2"
                >
                  <ChevronRight className="size-3.5 md:size-4" strokeWidth={2} />
                </button>
              </div>
            </div>

            <Button
              size="sm"
              className={cn(
                "h-7 w-[4.25rem] shrink-0 justify-self-end rounded-md border border-white/10 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 px-2.5 text-xs font-semibold text-slate-950 shadow-none transition-[background,opacity,transform] hover:from-slate-200 hover:via-slate-300 hover:to-slate-400",
                "md:h-8 md:w-[5rem] md:rounded-xl md:px-4 md:text-sm md:shadow-lg"
              )}
              disabled={!imageSrc || isExportingPng}
              onClick={exportHighResImage}
            >
              {isExportingPng ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </main>
      </div>
      <footer className={cn("hidden w-full shrink-0 border-t border-white/10 py-3 text-center md:block", footerText)}>
        Designed and created by{" "}
        <a
          href="https://www.instagram.com/walidazizbash"
          target="_blank"
          rel="noopener noreferrer"
          className={footerLink}
        >
          Walid Aziz Basharyar
        </a>
      </footer>
    </div>
  )
}
