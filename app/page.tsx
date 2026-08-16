"use client";

import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type {
  EffectSettings,
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

/** Inclusive integer roll in [min, max]. */
function randInt(min: number, max: number) {
  const lo = Math.ceil(min)
  const hi = Math.floor(max)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

/**
 * Random-button ranges for Phase 1 + Phase 2.
 * UI slider limits stay wider; these only constrain Auto Fill / Random rolls.
 */
const RANDOM_RANGES = {
  seed: { min: 0, max: 99999 },
  /** Weighted: ~60% → 1, ~30% → 2, ~10% → 3 (see randomPasses). */
  passes: {
    weights: [
      { value: 1, weight: 0.6 },
      { value: 2, weight: 0.3 },
      { value: 3, weight: 0.1 },
    ],
  },
  rate: { min: 30, max: 70 },
  subdivisionLoops: { min: 3, max: 5 },
  subdivisionRate: { min: 30, max: 60 },
  noiseScale: { min: 10, max: 60 },
  noiseSpread: { min: 30, max: 70 },
  smearAmount: { min: 0, max: 70, zeroChance: 0.3 },
  smearWeight: { min: 0, max: 70 },
  /** Chance a smear stays enabled even when amount rolled 0. */
  smearEnabledWhenZero: 0.25,
  weightOriginal: { min: 0, max: 100 },
  weightDither: { min: 0, max: 70 },
  weightInvert: { min: 20, max: 70 },
  weightSurreal: { min: 20, max: 70 },
  weightPixelate: { min: 20, max: 70 },
  randomSampleChance: 0.35,
  edgeClampChance: 0.4,
  subdivisionModeFrontierChance: 0.5,
} as const

function randomPasses() {
  const roll = Math.random()
  let cumulative = 0
  for (const entry of RANDOM_RANGES.passes.weights) {
    cumulative += entry.weight
    if (roll < cumulative) return entry.value
  }
  return RANDOM_RANGES.passes.weights[RANDOM_RANGES.passes.weights.length - 1]!
    .value
}

/** Smear amount: chance of 0, otherwise [min, max] from RANDOM_RANGES. */
function randomSmearAmount() {
  const { min, max, zeroChance } = RANDOM_RANGES.smearAmount
  if (Math.random() < zeroChance) return 0
  return randInt(min, max)
}

function defaultSmear(enabled: boolean, amount = 50): SmearStyleSettings {
  return { enabled, amount }
}

/** Soft cap — each entry is a tiny settings object (~1KB), not bitmaps. */
const MAX_AUTO_FILL_HISTORY = 40

function cloneEffectSettings(settings: EffectSettings): EffectSettings {
  return {
    ...settings,
    smearVertical: { ...settings.smearVertical },
    smearHorizontal: { ...settings.smearHorizontal },
    smearDiagonal: { ...settings.smearDiagonal },
    smearRecursive: { ...settings.smearRecursive },
  }
}

/** Default Amount values for Smear reset buttons (UI slider only). */
const SMEAR_AMOUNT_DEFAULTS = {
  vertical: 3,
  horizontal: 4,
  diagonal: 2,
  recursive: 20,
} as const

/** Default Weight values for Smear probability (independent coin flips). */
const SMEAR_WEIGHT_DEFAULTS = {
  vertical: 80,
  horizontal: 80,
  diagonal: 80,
  recursive: 80,
} as const

/** Default values for all other control sliders. */
const CONTROL_DEFAULTS = {
  maxCellSize: 20,
  subdivisionLoops: 4,
  subdivisionRate: 60,
  noiseScale: 19,
  noiseSpread: 50,
  weightPixelate: 0,
  weightInvert: 30,
  weightSurreal: 20,
  weightDither: 0,
  weightOriginal: 25,
  textureOpacity: 1,
  passes: 1,
  rate: 50,
} as const

function ResetAmountButton({
  label,
  defaultValue,
  onReset,
}: {
  label: string
  defaultValue: number
  onReset: () => void
}) {
  return (
    <button
      type="button"
      aria-label={`Reset ${label} to ${defaultValue}`}
      title="Reset to default"
      onClick={onReset}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
    >
      <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
    </button>
  )
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
  const [reuseConfirmOpen, setReuseConfirmOpen] = useState(false)
  const [isReusingImage, setIsReusingImage] = useState(false)
  const [randomSample, setRandomSample] = useState(false)
  const [edgeClamp, setEdgeClamp] = useState(false)
  const [smearVertical, setSmearVertical] = useState(() =>
    defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.vertical)
  )
  const [smearHorizontal, setSmearHorizontal] = useState(() =>
    defaultSmear(true, SMEAR_AMOUNT_DEFAULTS.horizontal)
  )
  const [smearDiagonal, setSmearDiagonal] = useState(() =>
    defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.diagonal)
  )
  const [smearRecursive, setSmearRecursive] = useState(() =>
    defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.recursive)
  )
  const [verticalWeight, setVerticalWeight] = useState<number>(
    SMEAR_WEIGHT_DEFAULTS.vertical
  )
  const [horizontalWeight, setHorizontalWeight] = useState<number>(
    SMEAR_WEIGHT_DEFAULTS.horizontal
  )
  const [diagonalWeight, setDiagonalWeight] = useState<number>(
    SMEAR_WEIGHT_DEFAULTS.diagonal
  )
  const [recursiveWeight, setRecursiveWeight] = useState<number>(
    SMEAR_WEIGHT_DEFAULTS.recursive
  )
  const [noiseScale, setNoiseScale] = useState<number>(CONTROL_DEFAULTS.noiseScale)
  const [noiseSpread, setNoiseSpread] = useState<number>(CONTROL_DEFAULTS.noiseSpread)
  // Standard layout mode disabled — keep defaults for worker payload only.
  // const [maxCellSize, setMaxCellSize] = useState(CONTROL_DEFAULTS.maxCellSize)
  // const [layoutMode, setLayoutMode] = useState<LayoutMode>("subdivision")
  const [subdivisionLoops, setSubdivisionLoops] = useState<number>(
    CONTROL_DEFAULTS.subdivisionLoops
  )
  const [subdivisionMode, setSubdivisionMode] =
    useState<SubdivisionMode>("frontier")
  const [subdivisionRate, setSubdivisionRate] = useState<number>(
    CONTROL_DEFAULTS.subdivisionRate
  )
  const [passes, setPasses] = useState<number>(CONTROL_DEFAULTS.passes)
  const [rate, setRate] = useState<number>(CONTROL_DEFAULTS.rate)
  const [showNoiseMap, setShowNoiseMap] = useState(false)
  const [showCellLayout, setShowCellLayout] = useState(false)
  const [textureEnabled, setTextureEnabled] = useState(true)
  const [textureOpacity, setTextureOpacity] = useState<number>(
    CONTROL_DEFAULTS.textureOpacity
  )
  const [weightDither, setWeightDither] = useState<number>(
    CONTROL_DEFAULTS.weightDither
  )
  const [weightInvert, setWeightInvert] = useState<number>(
    CONTROL_DEFAULTS.weightInvert
  )
  const [weightSurreal, setWeightSurreal] = useState<number>(
    CONTROL_DEFAULTS.weightSurreal
  )
  const [weightPixelate, setWeightPixelate] = useState<number>(
    CONTROL_DEFAULTS.weightPixelate
  )
  const [weightOriginal, setWeightOriginal] = useState<number>(
    CONTROL_DEFAULTS.weightOriginal
  )
  const [autoFillHistory, setAutoFillHistory] = useState<EffectSettings[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<EffectSettings | null>(null)

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
    verticalWeight,
    horizontalWeight,
    diagonalWeight,
    recursiveWeight,
    noiseScale,
    noiseSpread,
    maxCellSize: CONTROL_DEFAULTS.maxCellSize,
    layoutMode: "subdivision",
    subdivisionLoops,
    subdivisionMode,
    subdivisionRate,
    passes,
    rate,
    showNoiseMap,
    showCellLayout,
    textureEnabled,
    textureOpacity,
  }
  settingsRef.current = effectSettings

  /** Apply Phase 1+2 from a history snapshot; keep current Phase 3 + debug overlays. */
  function applyPhase12Settings(next: EffectSettings) {
    setSeed(next.seed)
    setPasses(next.passes)
    setRate(next.rate)
    setSubdivisionLoops(next.subdivisionLoops)
    setSubdivisionRate(next.subdivisionRate)
    setSubdivisionMode(next.subdivisionMode)
    setNoiseScale(next.noiseScale)
    setNoiseSpread(next.noiseSpread)
    setRandomSample(next.randomSample)
    setEdgeClamp(next.edgeClamp)
    setSmearVertical({ ...next.smearVertical })
    setSmearHorizontal({ ...next.smearHorizontal })
    setSmearDiagonal({ ...next.smearDiagonal })
    setSmearRecursive({ ...next.smearRecursive })
    setVerticalWeight(next.verticalWeight)
    setHorizontalWeight(next.horizontalWeight)
    setDiagonalWeight(next.diagonalWeight)
    setRecursiveWeight(next.recursiveWeight)
    setWeightOriginal(next.weightOriginal)
    setWeightDither(next.weightDither)
    setWeightInvert(next.weightInvert)
    setWeightSurreal(next.weightSurreal)
    setWeightPixelate(next.weightPixelate)
  }

  function buildRandomPhase12Settings(base: EffectSettings): EffectSettings {
    const verticalAmount = randomSmearAmount()
    const horizontalAmount = randomSmearAmount()
    const diagonalAmount = randomSmearAmount()
    const recursiveAmount = randomSmearAmount()
    const R = RANDOM_RANGES
    const enableWhenZero = R.smearEnabledWhenZero

    return {
      ...base,
      seed: randInt(R.seed.min, R.seed.max),
      passes: randomPasses(),
      rate: randInt(R.rate.min, R.rate.max),
      subdivisionLoops: randInt(R.subdivisionLoops.min, R.subdivisionLoops.max),
      subdivisionRate: randInt(R.subdivisionRate.min, R.subdivisionRate.max),
      subdivisionMode:
        Math.random() < R.subdivisionModeFrontierChance ? "frontier" : "global",
      noiseScale: randInt(R.noiseScale.min, R.noiseScale.max),
      noiseSpread: randInt(R.noiseSpread.min, R.noiseSpread.max),
      randomSample: Math.random() < R.randomSampleChance,
      edgeClamp: Math.random() < R.edgeClampChance,
      smearVertical: {
        enabled: verticalAmount > 0 || Math.random() < enableWhenZero,
        amount: verticalAmount,
      },
      smearHorizontal: {
        enabled: horizontalAmount > 0 || Math.random() < enableWhenZero,
        amount: horizontalAmount,
      },
      smearDiagonal: {
        enabled: diagonalAmount > 0 || Math.random() < enableWhenZero,
        amount: diagonalAmount,
      },
      smearRecursive: {
        enabled: recursiveAmount > 0 || Math.random() < enableWhenZero,
        amount: recursiveAmount,
      },
      verticalWeight: randInt(R.smearWeight.min, R.smearWeight.max),
      horizontalWeight: randInt(R.smearWeight.min, R.smearWeight.max),
      diagonalWeight: randInt(R.smearWeight.min, R.smearWeight.max),
      recursiveWeight: randInt(R.smearWeight.min, R.smearWeight.max),
      weightOriginal: randInt(R.weightOriginal.min, R.weightOriginal.max),
      weightDither: randInt(R.weightDither.min, R.weightDither.max),
      weightInvert: randInt(R.weightInvert.min, R.weightInvert.max),
      weightSurreal: randInt(R.weightSurreal.min, R.weightSurreal.max),
      weightPixelate: randInt(R.weightPixelate.min, R.weightPixelate.max),
      // Phase 3 preserved from base
      textureEnabled: base.textureEnabled,
      textureOpacity: base.textureOpacity,
      showNoiseMap: base.showNoiseMap,
      showCellLayout: base.showCellLayout,
    }
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

  const { isExportingPng, exportHighResImage, capturePhase2PngBlob } =
    useAppWorkers({
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

  /**
   * Randomize Phase 1 + Phase 2 only.
   * Phase 3 (textureEnabled / textureOpacity) and debug overlays are preserved.
   * Pushes onto the Random history stack (truncating any redo future).
   */
  function handleAutoFill() {
    const base = settingsRef.current
    if (!base) return

    const newSettings = cloneEffectSettings(buildRandomPhase12Settings(base))
    const truncated = autoFillHistory.slice(0, Math.max(0, historyIndex + 1))
    let nextHistory = [...truncated, newSettings]
    // Drop oldest entries if the stack grows past the soft cap.
    if (nextHistory.length > MAX_AUTO_FILL_HISTORY) {
      nextHistory = nextHistory.slice(nextHistory.length - MAX_AUTO_FILL_HISTORY)
    }
    setAutoFillHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
    applyPhase12Settings(newSettings)
  }

  function handleAutoFillBack() {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const snapshot = autoFillHistory[nextIndex]
    if (!snapshot) return
    setHistoryIndex(nextIndex)
    applyPhase12Settings(snapshot)
  }

  function handleAutoFillForward() {
    if (historyIndex >= autoFillHistory.length - 1) return
    const nextIndex = historyIndex + 1
    const snapshot = autoFillHistory[nextIndex]
    if (!snapshot) return
    setHistoryIndex(nextIndex)
    applyPhase12Settings(snapshot)
  }

  /**
   * Open the Reuse Image confirmation modal.
   * Actual swap runs only after Confirm (pre-grain Phase 2 capture).
   */
  function handleReuseImageClick() {
    if (!imageSrc || isReusingImage) return
    setReuseConfirmOpen(true)
  }

  async function confirmReuseImage() {
    if (isReusingImage) return
    setIsReusingImage(true)
    try {
      const blob = await capturePhase2PngBlob()
      if (!blob) {
        console.error(
          "[pixel-by-day] Reuse Image: no Phase 2 frame available"
        )
        return
      }
      const url = URL.createObjectURL(blob)
      setImageSrc((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev)
        return url
      })
      setReuseConfirmOpen(false)
    } catch (err) {
      console.error("[pixel-by-day] Reuse Image failed", err)
    } finally {
      setIsReusingImage(false)
    }
  }

  // Seed Auto Fill history with the current base settings whenever a source image is set.
  useEffect(() => {
    if (!imageSrc) {
      setAutoFillHistory([])
      setHistoryIndex(-1)
      return
    }
    const base = settingsRef.current
    if (!base) return
    setAutoFillHistory([cloneEffectSettings(base)])
    setHistoryIndex(0)
  }, [imageSrc])

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
  const toolbarActionButton =
    "h-7 shrink-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 px-2.5 text-xs font-semibold text-slate-950 shadow-none transition-[background,opacity,transform] hover:from-slate-200 hover:via-slate-300 hover:to-slate-400 md:h-8"
  const helperText = "font-body text-xs text-slate-500"
  const bodyText = "font-body text-sm font-medium text-slate-200"
  const footerText = "font-footer text-xs text-slate-500"
  const footerLink =
    "font-footer text-slate-400 transition-colors hover:text-slate-300"
  const controlField = "flex flex-col gap-1.5"
  const sliderRow = "flex w-full min-w-0 items-center gap-1.5"
  const sliderTrackClass = "w-full min-w-0 flex-1"
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

        <div className={cn(floatingCard, "flex flex-col gap-3 p-4")}>
          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="pipeline-passes" className={controlLabel}>
                Repeat
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="pipeline-passes"
                className={sliderTrackClass}
                value={[passes]}
                min={1}
                max={3}
                step={1}
                onValueChange={(value) =>
                  setPasses(sliderValue(value, CONTROL_DEFAULTS.passes))
                }
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {passes}
                </span>
                <ResetAmountButton
                  label="Repeat"
                  defaultValue={CONTROL_DEFAULTS.passes}
                  onReset={() => setPasses(CONTROL_DEFAULTS.passes)}
                />
              </div>
            </div>
          </div>
          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="pipeline-rate" className={controlLabel}>
                Repeat Strength
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="pipeline-rate"
                className={sliderTrackClass}
                value={[rate]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) =>
                  setRate(sliderValue(value, CONTROL_DEFAULTS.rate))
                }
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {rate}
                </span>
                <ResetAmountButton
                  label="Repeat Strength"
                  defaultValue={CONTROL_DEFAULTS.rate}
                  onReset={() => setRate(CONTROL_DEFAULTS.rate)}
                />
              </div>
            </div>
          </div>
        </div>

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

          {/*
          Standard layout mode (disabled — restore when re-enabling UI):
          <div className="flex items-center justify-between gap-4">
            <span className={controlLabel}>Mode</span>
            ...
          </div>
          {layoutMode === "standard" && (
            <div className={controlField}>Max Cell Size slider...</div>
          )}
          */}

          <div className="flex items-center justify-between gap-4">
            <span className={controlLabel}>Mode</span>
            <div
              role="group"
              aria-label="Mode"
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

          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="subdivision-loops" className={controlLabel}>
                Split Passes
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="subdivision-loops"
                className={sliderTrackClass}
                value={[subdivisionLoops]}
                min={1}
                max={7}
                step={1}
                onValueChange={(value) =>
                  setSubdivisionLoops(
                    sliderValue(value, CONTROL_DEFAULTS.subdivisionLoops)
                  )
                }
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {subdivisionLoops}
                </span>
                <ResetAmountButton
                  label="Split Passes"
                  defaultValue={CONTROL_DEFAULTS.subdivisionLoops}
                  onReset={() =>
                    setSubdivisionLoops(CONTROL_DEFAULTS.subdivisionLoops)
                  }
                />
              </div>
            </div>
          </div>

          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="subdivision-rate" className={controlLabel}>
                Split Rate
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="subdivision-rate"
                className={sliderTrackClass}
                value={[subdivisionRate]}
                min={10}
                max={100}
                step={1}
                onValueChange={(value) =>
                  setSubdivisionRate(
                    sliderValue(value, CONTROL_DEFAULTS.subdivisionRate)
                  )
                }
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {subdivisionRate}
                </span>
                <ResetAmountButton
                  label="Split Rate"
                  defaultValue={CONTROL_DEFAULTS.subdivisionRate}
                  onReset={() =>
                    setSubdivisionRate(CONTROL_DEFAULTS.subdivisionRate)
                  }
                />
              </div>
            </div>
          </div>
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

          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="noise-scale" className={controlLabel}>
                Noise Scale
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="noise-scale"
                className={sliderTrackClass}
                value={[noiseScale]}
                min={1}
                max={100}
                step={1}
                onValueChange={(value) =>
                  setNoiseScale(sliderValue(value, CONTROL_DEFAULTS.noiseScale))
                }
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {noiseScale}
                </span>
                <ResetAmountButton
                  label="Noise Scale"
                  defaultValue={CONTROL_DEFAULTS.noiseScale}
                  onReset={() => setNoiseScale(CONTROL_DEFAULTS.noiseScale)}
                />
              </div>
            </div>
          </div>

          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="noise-spread" className={controlLabel}>
                Noise Spread
              </label>
            </div>
            <div className={sliderRow}>
              <Slider
                id="noise-spread"
                className={sliderTrackClass}
                value={[noiseSpread]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) =>
                  setNoiseSpread(
                    sliderValue(value, CONTROL_DEFAULTS.noiseSpread)
                  )
                }
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {noiseSpread}
                </span>
                <ResetAmountButton
                  label="Noise Spread"
                  defaultValue={CONTROL_DEFAULTS.noiseSpread}
                  onReset={() => setNoiseSpread(CONTROL_DEFAULTS.noiseSpread)}
                />
              </div>
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

            <div className={controlField}>
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-pixelate" className={controlLabel}>
                  Pixelate
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-pixelate"
                  className={sliderTrackClass}
                  value={[weightPixelate]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setWeightPixelate(
                      sliderValue(value, CONTROL_DEFAULTS.weightPixelate)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {weightPixelate}
                  </span>
                  <ResetAmountButton
                    label="Pixelate"
                    defaultValue={CONTROL_DEFAULTS.weightPixelate}
                    onReset={() =>
                      setWeightPixelate(CONTROL_DEFAULTS.weightPixelate)
                    }
                  />
                </div>
              </div>
            </div>

            <div className={controlField}>
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-invert" className={controlLabel}>
                  Invert
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-invert"
                  className={sliderTrackClass}
                  value={[weightInvert]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setWeightInvert(
                      sliderValue(value, CONTROL_DEFAULTS.weightInvert)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {weightInvert}
                  </span>
                  <ResetAmountButton
                    label="Invert"
                    defaultValue={CONTROL_DEFAULTS.weightInvert}
                    onReset={() =>
                      setWeightInvert(CONTROL_DEFAULTS.weightInvert)
                    }
                  />
                </div>
              </div>
            </div>

            <div className={controlField}>
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-surreal" className={controlLabel}>
                  Surreal
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-surreal"
                  className={sliderTrackClass}
                  value={[weightSurreal]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setWeightSurreal(
                      sliderValue(value, CONTROL_DEFAULTS.weightSurreal)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {weightSurreal}
                  </span>
                  <ResetAmountButton
                    label="Surreal"
                    defaultValue={CONTROL_DEFAULTS.weightSurreal}
                    onReset={() =>
                      setWeightSurreal(CONTROL_DEFAULTS.weightSurreal)
                    }
                  />
                </div>
              </div>
            </div>

            <div className={controlField}>
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-dither" className={controlLabel}>
                  Dither
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-dither"
                  className={sliderTrackClass}
                  value={[weightDither]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setWeightDither(
                      sliderValue(value, CONTROL_DEFAULTS.weightDither)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {weightDither}
                  </span>
                  <ResetAmountButton
                    label="Dither"
                    defaultValue={CONTROL_DEFAULTS.weightDither}
                    onReset={() =>
                      setWeightDither(CONTROL_DEFAULTS.weightDither)
                    }
                  />
                </div>
              </div>
            </div>

            <div className={controlField}>
              <div className="flex items-center gap-1.5">
                <label htmlFor="weight-original" className={controlLabel}>
                  Original
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="weight-original"
                  className={sliderTrackClass}
                  value={[weightOriginal]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setWeightOriginal(
                      sliderValue(value, CONTROL_DEFAULTS.weightOriginal)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {weightOriginal}
                  </span>
                  <ResetAmountButton
                    label="Original"
                    defaultValue={CONTROL_DEFAULTS.weightOriginal}
                    onReset={() =>
                      setWeightOriginal(CONTROL_DEFAULTS.weightOriginal)
                    }
                  />
                </div>
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
                defaultAmount: SMEAR_AMOUNT_DEFAULTS.vertical,
                weight: verticalWeight,
                setWeight: setVerticalWeight,
                defaultWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
              },
              {
                id: "horizontal",
                label: "Horizontal",
                value: smearHorizontal,
                set: setSmearHorizontal,
                defaultAmount: SMEAR_AMOUNT_DEFAULTS.horizontal,
                weight: horizontalWeight,
                setWeight: setHorizontalWeight,
                defaultWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
              },
              {
                id: "diagonal",
                label: "Diagonal",
                value: smearDiagonal,
                set: setSmearDiagonal,
                defaultAmount: SMEAR_AMOUNT_DEFAULTS.diagonal,
                weight: diagonalWeight,
                setWeight: setDiagonalWeight,
                defaultWeight: SMEAR_WEIGHT_DEFAULTS.diagonal,
              },
              {
                id: "recursive",
                label: "Recursive",
                value: smearRecursive,
                set: setSmearRecursive,
                defaultAmount: SMEAR_AMOUNT_DEFAULTS.recursive,
                weight: recursiveWeight,
                setWeight: setRecursiveWeight,
                defaultWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
              },
            ] as const
          ).map((style) => (
            <div
              key={style.id}
              className="border-b border-white/5 pb-4 last:border-b-0 last:pb-0"
            >
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
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  style.value.enabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
                <div
                  className="min-h-0 overflow-hidden"
                  aria-hidden={!style.value.enabled}
                  inert={!style.value.enabled ? true : undefined}
                >
                  <div className="flex flex-col gap-3 pt-3">
                    <div className={controlField}>
                      <span className={helperText}>Amount</span>
                      <div className={sliderRow}>
                        <Slider
                          id={`smear-${style.id}-amount`}
                          aria-label={`${style.label} amount`}
                          className={sliderTrackClass}
                          value={[style.value.amount]}
                          min={0}
                          max={100}
                          step={1}
                          onValueChange={(value) =>
                            style.set({
                              ...style.value,
                              amount: sliderValue(value, style.defaultAmount),
                            })
                          }
                        />
                        <div className="flex shrink-0 items-center gap-0.5">
                          <span
                            className={sliderValueReadout}
                            aria-hidden="true"
                          >
                            {style.value.amount}
                          </span>
                          <ResetAmountButton
                            label={`${style.label} amount`}
                            defaultValue={style.defaultAmount}
                            onReset={() =>
                              style.set({
                                ...style.value,
                                amount: style.defaultAmount,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className={controlField}>
                      <span className={helperText}>Weight</span>
                      <div className={sliderRow}>
                        <Slider
                          id={`smear-${style.id}-weight`}
                          aria-label={`${style.label} weight`}
                          className={sliderTrackClass}
                          value={[style.weight]}
                          min={0}
                          max={100}
                          step={1}
                          onValueChange={(value) =>
                            style.setWeight(
                              sliderValue(value, style.defaultWeight)
                            )
                          }
                        />
                        <div className="flex shrink-0 items-center gap-0.5">
                          <span
                            className={sliderValueReadout}
                            aria-hidden="true"
                          >
                            {style.weight}
                          </span>
                          <ResetAmountButton
                            label={`${style.label} weight`}
                            defaultValue={style.defaultWeight}
                            onReset={() =>
                              style.setWeight(style.defaultWeight)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
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
            <div className={controlField}>
              <div className="flex items-center gap-1.5">
                <label htmlFor="texture-opacity" className={controlLabel}>
                  Grain Opacity
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="texture-opacity"
                  className={sliderTrackClass}
                  value={[textureOpacity]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(value) =>
                    setTextureOpacity(
                      sliderValue(value, CONTROL_DEFAULTS.textureOpacity)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {Math.round(textureOpacity * 100)}
                  </span>
                  <ResetAmountButton
                    label="Grain Opacity"
                    defaultValue={Math.round(
                      CONTROL_DEFAULTS.textureOpacity * 100
                    )}
                    onReset={() =>
                      setTextureOpacity(CONTROL_DEFAULTS.textureOpacity)
                    }
                  />
                </div>
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
          <div className="flex shrink-0 flex-col gap-2 border-t border-white/10 px-3 py-2 md:grid md:grid-cols-[auto_1fr_auto] md:items-center md:gap-2 md:px-6 md:py-4">
            <div className="flex items-center justify-center gap-2 md:contents">
              <div className="flex shrink-0 items-center gap-2 md:justify-self-start">
                <Button
                  type="button"
                  size="sm"
                  className={toolbarActionButton}
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.value = ""
                      fileInputRef.current.click()
                    }
                  }}
                >
                  <span className="md:hidden">Load</span>
                  <span className="hidden md:inline">Load Image</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={toolbarActionButton}
                  disabled={!imageSrc || isReusingImage}
                  title="Use the current output as the next input image"
                  onClick={handleReuseImageClick}
                >
                  <span className="md:hidden">Reuse</span>
                  <span className="hidden md:inline">Reuse Image</span>
                </Button>
              </div>

              <Button
                size="sm"
                className={cn(
                  toolbarActionButton,
                  "justify-self-end md:col-start-3 md:shadow-lg"
                )}
                disabled={!imageSrc || isExportingPng}
                onClick={exportHighResImage}
              >
                {isExportingPng ? (
                  "Saving…"
                ) : (
                  <>
                    <span className="md:hidden">Save</span>
                    <span className="hidden md:inline">Save Image</span>
                  </>
                )}
              </Button>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 md:col-start-2 md:row-start-1 md:justify-self-center md:gap-3">
              <div className="flex min-w-0 max-w-[10rem] items-center gap-1.5 md:max-w-[12rem]">
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
                    <ChevronLeft
                      className="size-3.5 md:size-4"
                      strokeWidth={2}
                    />
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
                    <ChevronRight
                      className="size-3.5 md:size-4"
                      strokeWidth={2}
                    />
                  </button>
                </div>
              </div>

              <div className="flex h-7 min-w-0 items-center rounded-md border border-white/10 bg-transparent md:h-8 md:rounded-lg">
                <button
                  type="button"
                  aria-label="Previous Random"
                  title="Previous Random"
                  disabled={!imageSrc || historyIndex <= 0}
                  onClick={handleAutoFillBack}
                  className="inline-flex h-full shrink-0 items-center justify-center px-1.5 text-slate-400 transition-colors hover:text-slate-100 disabled:pointer-events-none disabled:opacity-35 md:px-2"
                >
                  <ChevronLeft
                    className="size-3.5 md:size-4"
                    strokeWidth={2}
                  />
                </button>
                <button
                  type="button"
                  aria-label="Generate Random"
                  title="Randomize layout and effects (keeps grain settings)"
                  disabled={!imageSrc}
                  onClick={handleAutoFill}
                  className="min-w-0 px-2 text-center text-xs font-medium text-slate-400 transition-colors hover:text-slate-100 disabled:pointer-events-none disabled:opacity-35 md:px-2.5 md:text-sm"
                >
                  Random
                </button>
                <button
                  type="button"
                  aria-label="Next Random"
                  title="Next Random"
                  disabled={
                    !imageSrc || historyIndex >= autoFillHistory.length - 1
                  }
                  onClick={handleAutoFillForward}
                  className="inline-flex h-full shrink-0 items-center justify-center px-1.5 text-slate-400 transition-colors hover:text-slate-100 disabled:pointer-events-none disabled:opacity-35 md:px-2"
                >
                  <ChevronRight
                    className="size-3.5 md:size-4"
                    strokeWidth={2}
                  />
                </button>
              </div>
            </div>
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

      {reuseConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Dismiss dialog"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => {
              if (!isReusingImage) setReuseConfirmOpen(false)
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reuse-confirm-title"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-[#f5f5f7] shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          >
            <p
              id="reuse-confirm-title"
              className="text-center font-body text-sm leading-relaxed text-slate-200"
            >
              This will replace your original image
              <br />
              with the current output.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-2xl border-white/10 bg-transparent px-4 text-xs font-semibold text-slate-300 shadow-none hover:bg-white/5 hover:text-slate-100"
                disabled={isReusingImage}
                onClick={() => setReuseConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className={cn(toolbarActionButton, "h-8 px-4")}
                disabled={isReusingImage}
                onClick={() => {
                  void confirmReuseImage()
                }}
              >
                {isReusingImage ? "Working…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
