"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, X } from "lucide-react"
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
  halftoneAmount: { min: 0, max: 70, zeroChance: 0.5 },
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

/** A user-captured snapshot of the current result, shown in the History sidebar. */
interface HistorySnapshot {
  id: string
  /** Small JPEG data URL used as the sidebar thumbnail. */
  thumbnail: string
  /**
   * Full-resolution PNG blob URL of the canvas at capture time — what the preview modal
   * displays. Never show `thumbnail` there; it's a 150px JPEG and looks awful scaled up.
   */
  previewSrc: string | null
  imageSrc: string | null
  /** Carries `seed` too — never store it separately or the two can drift. */
  effectSettings: EffectSettings
}

/** Soft cap on saved thumbnails — each one embeds image data, so keep this small. */
const MAX_VISUAL_HISTORY = 10
const HISTORY_THUMBNAIL_WIDTH = 150
/** Pixels the History column scrolls per chevron press. */
const HISTORY_SCROLL_STEP = 200

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
  vertical: 0,
  horizontal: 0,
  diagonal: 0,
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
  halftoneAmount: 0,
} as const

/** Default global seed (matches initial page state). */
const DEFAULT_SEED = 20599

function buildDefaultEffectSettings(): EffectSettings {
  return {
    seed: DEFAULT_SEED,
    weightDither: CONTROL_DEFAULTS.weightDither,
    weightInvert: CONTROL_DEFAULTS.weightInvert,
    weightSurreal: CONTROL_DEFAULTS.weightSurreal,
    weightPixelate: CONTROL_DEFAULTS.weightPixelate,
    weightOriginal: CONTROL_DEFAULTS.weightOriginal,
    randomSample: false,
    edgeClamp: false,
    smearVertical: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.vertical),
    smearHorizontal: defaultSmear(true, SMEAR_AMOUNT_DEFAULTS.horizontal),
    smearDiagonal: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.diagonal),
    smearRecursive: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.recursive),
    verticalWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
    horizontalWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
    diagonalWeight: SMEAR_WEIGHT_DEFAULTS.diagonal,
    recursiveWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
    noiseScale: CONTROL_DEFAULTS.noiseScale,
    noiseSpread: CONTROL_DEFAULTS.noiseSpread,
    maxCellSize: CONTROL_DEFAULTS.maxCellSize,
    subdivisionLoops: CONTROL_DEFAULTS.subdivisionLoops,
    subdivisionMode: "frontier",
    subdivisionRate: CONTROL_DEFAULTS.subdivisionRate,
    passes: CONTROL_DEFAULTS.passes,
    rate: CONTROL_DEFAULTS.rate,
    showNoiseMap: false,
    showCellLayout: false,
    textureEnabled: true,
    textureOpacity: CONTROL_DEFAULTS.textureOpacity,
    halftoneAmount: CONTROL_DEFAULTS.halftoneAmount,
  }
}

/**
 * Neutral state for Bake: every generative modifier off, structural preferences kept.
 * Not pure — `seed` is rolled fresh on each call, so the next pass over the flattened
 * frame starts from new randomness instead of repeating the layout that produced it.
 *
 * Deliberately NOT `buildDefaultEffectSettings` — those defaults are a good-looking
 * starting point (invert 30, surreal 20, horizontal smear on), which is exactly what must
 * not land back on top of an already-flattened frame.
 *
 * ── Why the baked pixels survive this untouched ──────────────────────────────────────
 * The Cell mask is no longer forced OFF (`noiseScale` / `noiseSpread` carry over), so
 * Cells *do* light up and `drawNormalEffects` walks them. Three separate properties make
 * every one of those Cells a no-op, and all three must hold:
 *
 *   1. `randomSample: false` → `resolveCellSampleOrigin` returns the Cell's own origin,
 *      and `copyContinuousCellSample` early-returns when source and dest coincide.
 *   2. All six effect weights (five + `halftoneAmount`) at 0 → `chooseEffect` hits its
 *      `totalWeight === 0` guard and returns "original", which `applyEffectGlobal` has
 *      no branch for.
 *   3. All four smears `enabled: false` → each block in `applySmearStyles` short-circuits
 *      on `enabled` before anything else is evaluated.
 *
 * Nothing else in the pipeline writes pixels: no global pass follows the Cell loop, and
 * both debug overlays are off. Break any one of the three and a Bake starts re-processing
 * the frame it just flattened.
 *
 * ── Carried over from `current` ──────────────────────────────────────────────────────
 * Phase 3 grain, because it is a post-process laid over the finished frame rather than a
 * modifier of it, and Bake flattens the *pre-grain* capture precisely so it never stacks.
 * Plus the structural preferences behind the Cell Pattern and Noise Mask callouts — they
 * shape where Cells fall, not how hard anything hits, and are inert while every Cell is a
 * no-op. Zeroing them would just discard the user's setup.
 *
 * The debug overlays stay false on purpose: `showNoiseMap` and `showCellLayout` do not
 * modulate the image, they *replace* it, so carrying either over would leave a fresh bake
 * showing a debug visualization instead of the frame that was just flattened.
 */
function buildNeutralEffectSettings(current: EffectSettings): EffectSettings {
  return {
    // The same roll the Random button makes (`buildRandomPhase12Settings`), so a baked
    // seed is indistinguishable from a rolled one. The shared range is what matters:
    // `sanitizeEffectSettings` clamps seed to 0–99999, so anything wider would collapse
    // most bakes onto 99999 in the worker while the Seed field showed something else.
    seed: randInt(RANDOM_RANGES.seed.min, RANDOM_RANGES.seed.max),
    weightDither: 0,
    weightInvert: 0,
    weightSurreal: 0,
    weightPixelate: 0,
    weightOriginal: 0,
    // Load-bearing: keeps each Cell sampling its own geometry (see note 1 above).
    randomSample: false,
    edgeClamp: false,
    smearVertical: { enabled: false, amount: 0 },
    smearHorizontal: { enabled: false, amount: 0 },
    smearDiagonal: { enabled: false, amount: 0 },
    smearRecursive: { enabled: false, amount: 0 },
    // Smear Weights go back to their defaults rather than 0. They are per-Cell
    // probabilities, not intensities, so a 0 here would leave every smear parked at
    // "never fires" the moment the user switches one back on. Inert while baking:
    // `applySmearStyles` short-circuits on `enabled` before any weight is rolled.
    verticalWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
    horizontalWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
    diagonalWeight: SMEAR_WEIGHT_DEFAULTS.diagonal,
    recursiveWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
    // Noise Mask callout — carried over.
    noiseScale: current.noiseScale,
    noiseSpread: current.noiseSpread,
    // No control and no setter — `effectSettings` always reads this straight from
    // CONTROL_DEFAULTS, so any other value here would be one the app can never hold and
    // would only misreport itself into Random's undo stack.
    maxCellSize: CONTROL_DEFAULTS.maxCellSize,
    // Cell Pattern callout — carried over.
    subdivisionLoops: current.subdivisionLoops,
    subdivisionMode: current.subdivisionMode,
    subdivisionRate: current.subdivisionRate,
    // One pass = no repetition. Cannot be 0: clamped to 1–3 and the slider's min is 1.
    passes: 1,
    // Repeat Strength back to its default rather than 0. Only ever read on pass i > 0
    // (decay is `(rate/100)^i`), so at one pass it cannot affect the output either way.
    rate: CONTROL_DEFAULTS.rate,
    showNoiseMap: false,
    showCellLayout: false,
    textureEnabled: current.textureEnabled,
    textureOpacity: current.textureOpacity,
    halftoneAmount: 0,
  }
}

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
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
    >
      <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
    </button>
  )
}

function isAllowedImageFile(file: File) {
  return ALLOWED_IMAGE_TYPES.has(file.type)
}

/**
 * Swap the canvas's drawing buffer to the new frame.
 *
 * The canvas's *rendered* size is pure CSS (`size-full object-scale-down` inside
 * `canvasBoxClass`), never inline styles: the element fills its already-reserved box
 * from first paint, so changing the buffer here — including the very first frame,
 * which replaces the 300x150 canvas default — moves nothing and contributes no CLS.
 * `object-scale-down` reproduces the old JS fit exactly (contain, but never upscale
 * past 1:1), for any source aspect ratio.
 */
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
}

export default function Home() {
  const [imageSrc, setImageSrc] = useState<string | null>(
    "/images/Portrait_01.webp"
  )
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [isDragging, setIsDragging] = useState(false)
  const [bakeConfirmOpen, setBakeConfirmOpen] = useState(false)
  const [isBaking, setIsBaking] = useState(false)
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
  const [subdivisionLoops, setSubdivisionLoops] = useState<number>(
    CONTROL_DEFAULTS.subdivisionLoops
  )
  const [subdivisionMode, setSubdivisionMode] =
    useState<SubdivisionMode>("frontier")
  const [subdivisionRate, setSubdivisionRate] = useState<number>(
    CONTROL_DEFAULTS.subdivisionRate
  )
  const [passes, setPasses] = useState<number>(CONTROL_DEFAULTS.passes)
  /** Continuous thumb position while dragging Repeat (engine still uses integer `passes`). */
  const [passesDrag, setPassesDrag] = useState<number | null>(null)
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
  const [halftoneAmount, setHalftoneAmount] = useState<number>(
    CONTROL_DEFAULTS.halftoneAmount
  )
  const [autoFillHistory, setAutoFillHistory] = useState<EffectSettings[]>(() => [
    cloneEffectSettings(buildDefaultEffectSettings()),
  ])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [visualHistory, setVisualHistory] = useState<HistorySnapshot[]>([])
  /** Monotonic id source for captured snapshots (avoids impure Date.now/Math.random in a handler). */
  const captureIdRef = useRef(0)
  /** History snapshot currently shown in the preview modal, or null when the modal is closed. */
  const [previewItem, setPreviewItem] = useState<HistorySnapshot | null>(null)
  /**
   * Live settings as they were the instant the preview modal opened, so Cancel / Escape /
   * backdrop can rewind the controls. Written only on the transition *into* previewing —
   * clicking straight from one thumbnail to another must not overwrite the working state
   * with the settings of the snapshot being stepped over. Null whenever no preview is open.
   */
  const [backupSettings, setBackupSettings] = useState<EffectSettings | null>(
    null
  )
  const previewing = previewItem !== null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const historyScrollRef = useRef<HTMLDivElement>(null)

  function scrollHistory(delta: number) {
    historyScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" })
  }

  function seedRandomHistory(base: EffectSettings) {
    setAutoFillHistory([cloneEffectSettings(base)])
    setHistoryIndex(0)
  }

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
    subdivisionLoops,
    subdivisionMode,
    subdivisionRate,
    passes,
    rate,
    showNoiseMap,
    showCellLayout,
    textureEnabled,
    textureOpacity,
    halftoneAmount,
  }

  /**
   * Apply Phase 1+2 from a history snapshot; keep current Phase 3 + debug overlays.
   * Memoized with no deps — the body is nothing but state setters, which React keeps
   * stable — so effects that restore settings can depend on it without re-subscribing.
   */
  const applyPhase12Settings = useCallback((next: EffectSettings) => {
    setSeed(next.seed)
    setPasses(next.passes)
    setPassesDrag(null)
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
    setHalftoneAmount(next.halftoneAmount)
  }, [])

  /** Apply every field of a snapshot, including Phase 3 + debug overlays. */
  const applyFullEffectSettings = useCallback(
    (next: EffectSettings) => {
      applyPhase12Settings(next)
      setTextureEnabled(next.textureEnabled)
      setTextureOpacity(next.textureOpacity)
      setShowNoiseMap(next.showNoiseMap)
      setShowCellLayout(next.showCellLayout)
    },
    [applyPhase12Settings]
  )

  /* eslint-disable react-hooks/purity -- randomization is intentional here; only ever
     invoked from the Random button's click handler, never during render. */
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
      halftoneAmount:
        Math.random() < R.halftoneAmount.zeroChance
          ? 0
          : randInt(R.halftoneAmount.min, R.halftoneAmount.max),
      // Phase 3 preserved from base
      textureEnabled: base.textureEnabled,
      textureOpacity: base.textureOpacity,
      showNoiseMap: base.showNoiseMap,
      showCellLayout: base.showCellLayout,
    }
  }
  /* eslint-enable react-hooks/purity */

  const onPreviewFrame = useCallback(
    (width: number, height: number, bitmap: ImageBitmap) => {
      const canvas = liveCanvasRef.current
      if (!canvas) {
        bitmap.close()
        return
      }
      prepareCanvasPreview(canvas, bitmap, width, height)
    },
    []
  )

  const onSourcePreview = useCallback(
    (width: number, height: number, bitmap: ImageBitmap) => {
      const canvas = liveCanvasRef.current
      if (!canvas) return
      prepareCanvasPreview(canvas, bitmap, width, height)
    },
    []
  )

  const { isExportingPng, exportHighResImage, capturePhase2PngBlob } =
    useAppWorkers({
      settings: effectSettings,
      imageSrc,
      // The preview modal paints an opaque overlay across the canvas, so the renders
      // that `openPreview`'s settings swap would otherwise kick off are never seen.
      paused: previewing,
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
          releaseSourceBlob(prev, { history: visualHistoryRef.current })
          return url
        })
        seedRandomHistory(effectSettings)
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
    const base = effectSettings

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

  /** Save a thumbnail + full settings of the current result into the History sidebar. */
  function handleCapture() {
    const canvas = liveCanvasRef.current
    if (!canvas || canvas.width < 1 || canvas.height < 1) return

    const thumbHeight = Math.max(
      1,
      Math.round(canvas.height * (HISTORY_THUMBNAIL_WIDTH / canvas.width))
    )

    const offscreen = document.createElement("canvas")
    offscreen.width = HISTORY_THUMBNAIL_WIDTH
    offscreen.height = thumbHeight
    const ctx = offscreen.getContext("2d")
    if (!ctx) return
    ctx.drawImage(canvas, 0, 0, HISTORY_THUMBNAIL_WIDTH, thumbHeight)

    const thumbnail = offscreen.toDataURL("image/jpeg", 0.6)
    // Cloned now because the live settings keep mutating; the callback's other
    // captures (imageSrc, previewItem) are already frozen by the closure.
    const capturedSettings = cloneEffectSettings(effectSettings)
    const capturedImageSrc = imageSrc
    const previewedId = previewItem?.id

    // Lossless capture of the live canvas (already capped at MAX_PREVIEW_DIMENSION),
    // kept as a blob URL rather than a data URL so it stays off the JS string heap.
    canvas.toBlob((blob) => {
      captureIdRef.current += 1
      const snapshot: HistorySnapshot = {
        id: `capture-${captureIdRef.current}`,
        thumbnail,
        previewSrc: blob ? URL.createObjectURL(blob) : null,
        imageSrc: capturedImageSrc,
        effectSettings: capturedSettings,
      }
      setVisualHistory((prev) => {
        const combined = [snapshot, ...prev]
        const nextHistory = combined.slice(0, MAX_VISUAL_HISTORY)
        combined.slice(MAX_VISUAL_HISTORY).forEach((evicted) => {
          releaseSourceBlob(evicted.imageSrc, {
            liveImageSrc: imageSrcRef.current,
            history: nextHistory,
          })
          revokeSnapshotPreview(evicted, previewedId)
        })
        return nextHistory
      })
    }, "image/png")
  }

  /**
   * Free a snapshot's preview blob. Unlike `imageSrc`, each `previewSrc` belongs to exactly
   * one snapshot, so it only needs guarding against the copy the modal is currently showing.
   */
  function revokeSnapshotPreview(
    snapshot: HistorySnapshot,
    previewedId?: string
  ) {
    if (!snapshot.previewSrc || snapshot.id === previewedId) return
    URL.revokeObjectURL(snapshot.previewSrc)
  }

  /** Instantly remove one History thumbnail and free its blobs if nothing else needs them. */
  function handleDeleteHistory(id: string, event: React.MouseEvent) {
    event.stopPropagation()
    // Deleting the snapshot on screen would leave the modal showing a revoked URL.
    // Dismiss it the same way Cancel does, so the controls rewind instead of being
    // stranded on the deleted snapshot's settings.
    if (previewItem?.id === id) cancelPreview()
    setVisualHistory((prev) => {
      const target = prev.find((snap) => snap.id === id)
      const survivors = prev.filter((snap) => snap.id !== id)
      if (target) {
        releaseSourceBlob(target.imageSrc, {
          liveImageSrc: imageSrcRef.current,
          history: survivors,
        })
        revokeSnapshotPreview(target)
      }
      return survivors
    })
  }

  /**
   * Open the preview modal, or switch it to a different snapshot.
   *
   * The live controls jump to the snapshot's settings so the sidebar reads out the exact
   * parameters behind the image on screen. The pre-preview state is stashed once, on the
   * way in, and `previewing` is what gates that — see `backupSettings`.
   *
   * The single entry point into previewing: `handlePreviewKeep` relies on the settings
   * already being live, so nothing else may call `setPreviewItem` with a snapshot.
   */
  function openPreview(snapshot: HistorySnapshot) {
    if (!previewing) {
      setBackupSettings(cloneEffectSettings(effectSettings))
    }
    applyFullEffectSettings(snapshot.effectSettings)
    setPreviewItem(snapshot)
  }

  /** Dismiss the preview without keeping it: rewind the controls to the stashed state. */
  function cancelPreview() {
    if (backupSettings) {
      applyFullEffectSettings(backupSettings)
    }
    setBackupSettings(null)
    setPreviewItem(null)
  }

  /** Keep the previewed snapshot: load its image as the live working state. */
  function handlePreviewKeep() {
    if (!previewItem) return
    const { imageSrc: keptSrc } = previewItem
    setImageSrc((prev) => {
      releaseSourceBlob(prev, { history: visualHistoryRef.current })
      return keptSrc
    })
    // The snapshot's settings went live back in `openPreview`, so keeping them is just a
    // matter of dropping the backup — re-applying here would only churn the smear object
    // identities `useAppWorkers` watches and cost a redundant worker render.
    setBackupSettings(null)
    setPreviewItem(null)
  }

  /**
   * Escape dismisses the History preview modal, same as the backdrop or Cancel.
   * `backupSettings` is in the deps because the restore reads it: it only ever changes in
   * lockstep with `previewing` today, but listing it keeps the handler correct rather than
   * dependent on that coupling holding.
   */
  useEffect(() => {
    if (!previewing) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (backupSettings) {
        applyFullEffectSettings(backupSettings)
      }
      setBackupSettings(null)
      setPreviewItem(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [previewing, backupSettings, applyFullEffectSettings])

  /**
   * Reset every generation control to the app's default starting state — the toolbar's
   * Reset button, which wants the good-looking defaults back.
   *
   * Not what Bake uses: flattening needs a zero state, not a pleasing one. See
   * `buildNeutralEffectSettings`.
   */
  function resetGenerationParameters() {
    applyFullEffectSettings(buildDefaultEffectSettings())
  }

  /** Open the Bake confirmation modal (pre-grain Phase 2 capture on confirm). */
  function handleBakeClick() {
    if (!imageSrc || isBaking) return
    setBakeConfirmOpen(true)
  }

  async function confirmBake() {
    if (isBaking) return
    setIsBaking(true)
    try {
      const blob = await capturePhase2PngBlob()
      if (!blob) {
        console.error("[pixel-by-day] Bake: no Phase 2 frame available")
        return
      }
      const url = URL.createObjectURL(blob)
      // The baked frame already carries every effect that was on screen. Handing it back
      // to the pipeline under the app defaults re-applied them on top of themselves, so
      // the new base starts from a zero state instead — grain excepted, which carries
      // over from the live settings.
      const neutral = buildNeutralEffectSettings(effectSettings)
      // Same synchronous block as the swap, so React commits the new source and the
      // zeroed controls in one render — no frame showing the old image un-effected.
      setImageSrc((prev) => {
        releaseSourceBlob(prev, { history: visualHistoryRef.current })
        return url
      })
      applyFullEffectSettings(neutral)
      // Seed Random's undo stack with what actually went live, or stepping back would
      // restore parameters the canvas never had.
      seedRandomHistory(neutral)
      setBakeConfirmOpen(false)
    } catch (err) {
      console.error("[pixel-by-day] Bake failed", err)
    } finally {
      setIsBaking(false)
    }
  }

  /**
   * Revoke the live blob URL only on unmount — not on every `imageSrc` change.
   * A `[imageSrc]` dependency would run this cleanup on each transition too,
   * destroying a blob still held by `visualHistory` for later restoration.
   */
  /** Mirrors for reads from blob helpers, which must see committed state, not a stale closure. */
  const imageSrcRef = useRef(imageSrc)
  const visualHistoryRef = useRef(visualHistory)
  useEffect(() => {
    imageSrcRef.current = imageSrc
    visualHistoryRef.current = visualHistory
  }, [imageSrc, visualHistory])

  useEffect(() => {
    return () => {
      // Nothing can reference these once the component is gone, so revoke unconditionally.
      // Repeat revokes are no-ops, which covers a source blob shared by several snapshots.
      if (imageSrcRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrcRef.current)
      }
      for (const snapshot of visualHistoryRef.current) {
        if (snapshot.previewSrc) URL.revokeObjectURL(snapshot.previewSrc)
        if (snapshot.imageSrc?.startsWith("blob:")) {
          URL.revokeObjectURL(snapshot.imageSrc)
        }
      }
    }
  }, [])

  /**
   * Release a source-image blob URL once no holder references it. A source blob can be held
   * by the live `imageSrc` and by any number of History snapshots at once, so both holders
   * must be checked — revoking one still in use is what produced the `net::ERR_FILE_NOT_FOUND`
   * crash when a stale thumbnail tried to reuse it.
   *
   * Callers pass the holder they are currently rewriting; the other is read from its ref.
   * The caller dropping `imageSrc` must omit `liveImageSrc`, because the ref still holds the
   * outgoing URL at that point and would wrongly veto the revoke.
   */
  function releaseSourceBlob(
    url: string | null | undefined,
    holders: { liveImageSrc?: string | null; history: HistorySnapshot[] }
  ) {
    if (!url?.startsWith("blob:")) return
    if (holders.liveImageSrc === url) return
    if (holders.history.some((snap) => snap.imageSrc === url)) return
    URL.revokeObjectURL(url)
  }

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
    "font-heading text-xs font-medium uppercase tracking-[0.12em] text-slate-300"
  const controlLabel = "font-body text-sm text-slate-300"
  /**
   * The small-screen `px-2.5` is a deliberate ceiling, not a guess. These sit in a
   * `flex-nowrap` / `overflow-x-auto` strip below `lg` and are `shrink-0`, so padding is
   * never compressed — it just pushes the five buttons into horizontal scrolling. 10px a
   * side is about the most that keeps them all on screen at ~360px.
   *
   * Kept to two steps on purpose: a `sm:` step would leak into the `cn(toolbarActionButton,
   * "... px-6")` call sites, since tailwind-merge only resolves conflicts within a matching
   * variant and an unprefixed override cannot cancel a prefixed one.
   */
  const toolbarActionButton =
    "h-7 shrink-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 px-2.5 text-xs font-semibold text-slate-950 shadow-none transition-[background,opacity,transform] hover:from-slate-200 hover:via-slate-300 hover:to-slate-400 lg:h-8 lg:px-6"
  /**
   * The box the rendered image occupies. Shared by the live canvas pane and the preview
   * overlay so the preview lands on exactly the canvas's footprint — they must stay identical.
   */
  const canvasBoxClass =
    "flex h-full max-h-full w-full max-w-[1200px] items-center justify-center overflow-hidden md:max-h-[80vh]"
  const helperText = "font-body text-xs text-slate-400"
  const bodyText = "font-body text-sm font-medium text-slate-200"
  const footerText = "font-footer text-xs text-slate-400"
  const footerLink =
    "font-footer text-slate-300 transition-colors hover:text-slate-100"
  const controlField = "flex flex-col gap-1.5"
  const sliderRow = "flex w-full min-w-0 items-center gap-1.5"
  const sliderTrackClass = "w-full min-w-0 flex-1"
  const sliderValueReadout = cn(
    footerText,
    "w-8 shrink-0 text-right tabular-nums"
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-slate-900 via-[#08080a] to-black font-body text-[#f5f5f7] pb-16 md:h-screen">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <header className="order-0 flex shrink-0 items-center px-4 py-3 lg:hidden">
          <h1 className={pageTitle}>Pixel By Day</h1>
        </header>
        {/* While previewing, every control in this column dims and goes inert — but the
            title (h1) and the mobile footer (p) stay at full strength. */}
        <aside
          className={cn(
            "order-2 flex min-h-0 w-full flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto border-none bg-transparent p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:order-1 lg:h-full lg:w-80 lg:flex-none lg:shrink-0 lg:gap-6 lg:overflow-y-auto lg:p-6 lg:pb-8",
            "[&>*:not(h1):not(p)]:transition-opacity [&>*:not(h1):not(p)]:duration-300",
            previewing &&
              "[&>*:not(h1):not(p)]:pointer-events-none [&>*:not(h1):not(p)]:opacity-30"
          )}
        >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
        <h1 className={cn(pageTitle, "hidden shrink-0 lg:block")}>Pixel By Day</h1>

        <div className={cn(floatingCard, "flex flex-col gap-3 p-4")}>
          <div className={controlField}>
            <div className="flex items-center gap-1.5">
              <label htmlFor="pipeline-passes" className={controlLabel}>
                Repeat
              </label>
            </div>
            <div className={sliderRow}>
              <div className={cn(sliderTrackClass, "relative")}>
                <Slider
                  id="pipeline-passes"
                  aria-label="Repeat"
                  className="relative z-10 w-full min-w-0"
                  value={[passesDrag ?? passes]}
                  min={1}
                  max={3}
                  step={0.01}
                  onValueChange={(value) => {
                    const raw = sliderValue(value, CONTROL_DEFAULTS.passes)
                    setPassesDrag(raw)
                    setPasses(
                      Math.max(1, Math.min(3, Math.round(raw)))
                    )
                  }}
                  onValueCommitted={(value) => {
                    const raw = sliderValue(value, CONTROL_DEFAULTS.passes)
                    setPasses(
                      Math.max(1, Math.min(3, Math.round(raw)))
                    )
                    setPassesDrag(null)
                  }}
                />
                {/* Integer stop ticks (1 / 2 / 3) — ends sit at the track tips */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-0"
                >
                  {[0, 50, 100].map((pct) => (
                    <span
                      key={pct}
                      className={cn(
                        "absolute top-0 h-1.5 w-px -translate-y-1/2 bg-slate-400",
                        pct === 0
                          ? "left-0"
                          : pct === 100
                            ? "right-0"
                            : "left-1/2 -translate-x-1/2"
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <span className={sliderValueReadout} aria-hidden="true">
                  {passes}
                </span>
                <ResetAmountButton
                  label="Repeat"
                  defaultValue={CONTROL_DEFAULTS.passes}
                  onReset={() => {
                    setPasses(CONTROL_DEFAULTS.passes)
                    setPassesDrag(null)
                  }}
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
                aria-label="Repeat Strength"
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
                        : "text-slate-300 hover:text-slate-100"
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
                aria-label="Split Passes"
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
                aria-label="Split Rate"
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
                aria-label="Noise Scale"
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
                aria-label="Noise Spread"
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
            weightOriginal > 0 ||
            halftoneAmount > 0
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
                  aria-label="Pixelate"
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
                  aria-label="Invert"
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
                  aria-label="Surreal"
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
                  aria-label="Dither"
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
                <label htmlFor="halftone-amount" className={controlLabel}>
                  Halftone
                </label>
              </div>
              <div className={sliderRow}>
                <Slider
                  id="halftone-amount"
                  aria-label="Halftone"
                  className={sliderTrackClass}
                  value={[halftoneAmount]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setHalftoneAmount(
                      sliderValue(value, CONTROL_DEFAULTS.halftoneAmount)
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={sliderValueReadout} aria-hidden="true">
                    {halftoneAmount}
                  </span>
                  <ResetAmountButton
                    label="Halftone"
                    defaultValue={CONTROL_DEFAULTS.halftoneAmount}
                    onReset={() =>
                      setHalftoneAmount(CONTROL_DEFAULTS.halftoneAmount)
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
                  aria-label="Original"
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
                  aria-label="Grain Opacity"
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

      {/* min-w-0 lets this row shrink to fit; without it the History column overflows
          off-screen and clicking a thumbnail scrolls the whole layout sideways. */}
      <div className="order-1 flex w-full min-w-0 flex-1 flex-row gap-2 lg:order-2 lg:gap-6">
      <main className="flex min-h-[50vh] min-w-0 flex-1 flex-col px-3 pb-3 pt-0 lg:h-auto lg:min-h-0 lg:overflow-hidden lg:p-6">
        <div
          className={cn(
            floatingCard,
            "flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0 md:min-h-0 md:flex-1"
          )}
        >
          <div className="relative flex min-h-0 w-full flex-1 touch-manipulation items-center justify-center overflow-hidden p-2 text-slate-400 sm:p-4 md:p-6">
            {imageSrc ? (
              <div className={cn(canvasBoxClass, "touch-manipulation")}>
                {/* Fills the reserved box at every viewport size, so the first frame
                    (and every later one) swaps the drawing buffer without resizing
                    the element. `object-scale-down` letterboxes any aspect ratio and
                    never upscales past 1:1. */}
                <canvas
                  ref={liveCanvasRef}
                  className="block size-full object-scale-down touch-manipulation"
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
            {previewItem && (
              /* `inset-0` spans this pane's padding box, so repeating its padding here is
                 what makes the preview land on exactly the canvas's box — not double-inset.
                 Keep/Cancel live down in the toolbar, leaving the image full size here. */
              <div
                className="absolute inset-0 z-40 flex items-center justify-center bg-[#08080a] p-2 sm:p-4 md:p-6"
                onClick={cancelPreview}
              >
                <div className={canvasBoxClass}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL of the captured canvas, not an optimizable remote asset */}
                  <img
                    src={previewItem.previewSrc ?? previewItem.thumbnail}
                    alt="Previewed saved result"
                    className="max-h-full max-w-full object-contain"
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="relative flex shrink-0 flex-col items-center gap-2 border-t border-white/10 px-3 py-2 md:gap-3 md:px-6 md:py-4">
            {/* Keep/Cancel sit on top of the hidden controls, so the toolbar keeps its
                exact height and the canvas above it never resizes. */}
            {previewing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-4">
                <Button
                  type="button"
                  size="sm"
                  className={cn(toolbarActionButton, "h-8 rounded-full px-6")}
                  onClick={handlePreviewKeep}
                >
                  Keep
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 rounded-full border border-zinc-700/50 bg-zinc-900 px-6 text-xs text-white hover:bg-zinc-800"
                  onClick={cancelPreview}
                >
                  Cancel
                </Button>
              </div>
            )}
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center justify-center gap-1.5 md:gap-3",
                previewing && "invisible"
              )}
            >
              <div className="flex min-w-0 max-w-[12rem] items-center gap-1.5 md:max-w-[12rem]">
                <label
                  htmlFor="canvas-seed"
                  className="shrink-0 text-sm text-slate-300"
                >
                  Seed
                </label>
                <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-white/10 bg-transparent">
                  <button
                    type="button"
                    aria-label="Decrease seed"
                    onClick={() => setSeed((prev) => Math.max(0, prev - 1))}
                    className="inline-flex h-full shrink-0 items-center justify-center px-2 text-slate-300 transition-colors hover:text-slate-100 md:px-2"
                  >
                    <ChevronLeft
                      className="size-4 md:size-4"
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
                    className="pointer-events-none min-w-0 w-12 flex-1 select-none bg-transparent py-2 text-center text-sm font-medium tabular-nums text-slate-200 outline-none md:pointer-events-auto md:select-auto"
                  />
                  <button
                    type="button"
                    aria-label="Increase seed"
                    onClick={() => setSeed((prev) => Math.min(99999, prev + 1))}
                    className="inline-flex h-full shrink-0 items-center justify-center px-2 text-slate-300 transition-colors hover:text-slate-100 md:px-2"
                  >
                    <ChevronRight
                      className="size-4 md:size-4"
                      strokeWidth={2}
                    />
                  </button>
                </div>
              </div>

              <div className="flex h-8 min-w-0 items-center rounded-lg border border-white/10 bg-transparent">
                <button
                  type="button"
                  aria-label="Previous Random"
                  title="Previous Random"
                  disabled={!imageSrc || historyIndex <= 0}
                  onClick={handleAutoFillBack}
                  className="inline-flex h-full shrink-0 items-center justify-center px-2 text-slate-300 transition-colors hover:text-slate-100 disabled:pointer-events-none disabled:opacity-35 md:px-2"
                >
                  <ChevronLeft
                    className="size-4 md:size-4"
                    strokeWidth={2}
                  />
                </button>
                <button
                  type="button"
                  aria-label="Generate Random"
                  title="Randomize layout and effects (keeps grain settings)"
                  disabled={!imageSrc}
                  onClick={handleAutoFill}
                  className="min-w-0 px-2.5 py-2 text-center text-sm font-medium text-slate-300 transition-colors hover:text-slate-100 disabled:pointer-events-none disabled:opacity-35"
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
                  className="inline-flex h-full shrink-0 items-center justify-center px-2 text-slate-300 transition-colors hover:text-slate-100 disabled:pointer-events-none disabled:opacity-35 md:px-2"
                >
                  <ChevronRight
                    className="size-4 md:size-4"
                    strokeWidth={2}
                  />
                </button>
              </div>
            </div>

            <div
              className={cn(
                "hide-scrollbar flex w-full max-w-full flex-row flex-nowrap items-center justify-center-safe gap-1 overflow-x-auto transition-opacity duration-300 lg:max-w-none lg:gap-3 lg:overflow-visible lg:flex-wrap lg:justify-center",
                previewing && "invisible"
              )}
            >
              <div className="contents">
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
                  Load
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={toolbarActionButton}
                  disabled={!imageSrc || isBaking}
                  title="Bake the current output as the next input image"
                  onClick={handleBakeClick}
                >
                  Bake
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={toolbarActionButton}
                  disabled={!imageSrc}
                  title="Reset all generation parameters to defaults"
                  onClick={resetGenerationParameters}
                >
                  Reset
                </Button>
              </div>
              <div className="contents">
                <Button
                  type="button"
                  size="sm"
                  className={toolbarActionButton}
                  disabled={!imageSrc}
                  title="Save a thumbnail of this result to History"
                  onClick={handleCapture}
                >
                  Capture
                </Button>
                <Button
                  size="sm"
                  className={toolbarActionButton}
                  disabled={!imageSrc || isExportingPng}
                  onClick={exportHighResImage}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {visualHistory.length > 0 && (
      <aside className="flex w-28 shrink-0 flex-col items-center gap-2 py-3 pl-1 pr-3">
        <button
          type="button"
          aria-label="Scroll history up"
          onClick={() => scrollHistory(-HISTORY_SCROLL_STEP)}
          className="flex w-full cursor-pointer items-center justify-center p-1 text-gray-300 hover:text-white"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <div
          ref={historyScrollRef}
          className="hide-scrollbar flex w-full flex-1 min-h-0 max-h-[calc(100vh-16rem)] flex-col items-center gap-2 overflow-y-auto"
        >
          {visualHistory.map((snapshot) => (
              <div
                key={snapshot.id}
                role="button"
                tabIndex={0}
                title="Preview this saved result"
                onClick={() => openPreview(snapshot)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openPreview(snapshot)
                  }
                }}
                className="group flex shrink-0 cursor-pointer items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
              >
                <div className="aspect-square w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 transition-colors group-hover:border-white/30">
                  {/* eslint-disable-next-line @next/next/no-img-element -- small local data URL thumbnail, not an optimizable remote asset */}
                  <img
                    src={snapshot.thumbnail}
                    alt="Saved generation"
                    className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Delete this saved result"
                  title="Delete"
                  onClick={(event) => handleDeleteHistory(snapshot.id, event)}
                  className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-700/60 text-white shadow-sm hover:bg-slate-600/70"
                >
                  <X className="size-4" />
                </button>
              </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll history down"
          onClick={() => scrollHistory(HISTORY_SCROLL_STEP)}
          className="flex w-full cursor-pointer items-center justify-center p-1 text-gray-300 hover:text-white"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </aside>
      )}
      </div>
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

      {bakeConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Dismiss dialog"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => {
              if (!isBaking) setBakeConfirmOpen(false)
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="bake-confirm-title"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-[#f5f5f7] shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          >
            <p
              id="bake-confirm-title"
              className="text-center font-body text-sm leading-relaxed text-slate-200"
            >
              This will replace your original image
              <br />
              and reset all parameters.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-2xl border-white/10 bg-transparent px-4 text-xs font-semibold text-slate-300 shadow-none hover:bg-white/5 hover:text-slate-100"
                disabled={isBaking}
                onClick={() => setBakeConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className={cn(toolbarActionButton, "h-8 px-4")}
                disabled={isBaking}
                onClick={() => {
                  void confirmBake()
                }}
              >
                {isBaking ? "Working…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
