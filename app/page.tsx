"use client";

/**
 * App shell and orchestrator.
 *
 * Owns the settings state, the History and Random stacks, the blob-URL lifecycle and
 * the two worker hooks, then hands each region of the UI the exact props it needs.
 * Deliberately not a Context: a provider holding the settings object would re-render
 * every panel on every slider tick, which is the thing the split exists to avoid.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  EffectSettings,
  SlitScanMode,
  SmearStyleSettings,
  SubdivisionMode,
} from "@/lib/effect-types"
import { BakeDialog } from "@/components/BakeDialog"
import { CanvasViewport } from "@/components/canvas/CanvasViewport"
import { HeaderControls } from "@/components/canvas/HeaderControls"
import { BaseEffectsSection } from "@/components/controls/BaseEffectsSection"
import { LayoutSection } from "@/components/controls/LayoutSection"
import { NoiseMaskSection } from "@/components/controls/NoiseMaskSection"
import { PostProcessingSection } from "@/components/controls/PostProcessingSection"
import { RepeatSection } from "@/components/controls/RepeatSection"
import { SmearsSection } from "@/components/controls/SmearsSection"
import { HistoryFilmstrip } from "@/components/history/HistoryFilmstrip"
import type { HistorySnapshot } from "@/components/history/types"
import {
  CONTROL_DEFAULTS,
  DEFAULT_SEED,
  SLIT_SCAN_MODE_DEFAULT,
  SMEAR_AMOUNT_DEFAULTS,
  SMEAR_WEIGHT_DEFAULTS,
} from "@/components/controls/defaults"
import {
  floatingCard,
  footerLink,
  footerText,
  pageTitle,
} from "@/components/controls/styles"
import { MAX_DECODE_EDGE, MAX_DECODE_PIXELS } from "@/lib/constants"
import { useAppWorkers } from "@/hooks/useAppWorkers"
import { cn } from "@/lib/utils"

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024

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
  weightThermal: { min: 0, max: 70, zeroChance: 0.5 },
  weightSlitScan: { min: 0, max: 70, zeroChance: 0.5 },
  slitScanAmount: { min: 20, max: 85 },
  slitScanFrequency: { min: 15, max: 75 },
  randomSampleChance: 0.35,
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

/** Horizontal / Vertical / Diagonal: signed amount, 0 is rest. */
function randomSignedSmearAmount() {
  const mag = randomSmearAmount()
  if (mag === 0) return 0
  return Math.random() < 0.5 ? -mag : mag
}

function defaultSmear(enabled: boolean, amount = 50): SmearStyleSettings {
  return { enabled, amount }
}

/** Soft cap — each entry is a tiny settings object (~1KB), not bitmaps. */
const MAX_AUTO_FILL_HISTORY = 40

/** Soft cap on saved thumbnails — each one embeds image data, so keep this small. */
const MAX_VISUAL_HISTORY = 10
const HISTORY_THUMBNAIL_WIDTH = 150

/**
 * Keep at most `MAX_VISUAL_HISTORY` snapshots, plus the one currently open in
 * the preview modal if it would otherwise fall off the list. The extra slot is
 * released when the modal closes (`pinnedId` omitted).
 */
function capVisualHistory(
  items: HistorySnapshot[],
  pinnedId?: string
): HistorySnapshot[] {
  const capped = items.slice(0, MAX_VISUAL_HISTORY)
  if (!pinnedId) return capped
  const pinned = items.find((snap) => snap.id === pinnedId)
  if (!pinned || capped.some((snap) => snap.id === pinned.id)) return capped
  return [...capped, pinned]
}

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

function cloneEffectSettings(settings: EffectSettings): EffectSettings {
  return {
    ...settings,
    smearVertical: { ...settings.smearVertical },
    smearHorizontal: { ...settings.smearHorizontal },
    smearDiagonal1: { ...settings.smearDiagonal1 },
    smearDiagonal2: { ...settings.smearDiagonal2 },
    smearRecursive: { ...settings.smearRecursive },
  }
}

function buildDefaultEffectSettings(): EffectSettings {
  return {
    seed: DEFAULT_SEED,
    weightDither: CONTROL_DEFAULTS.weightDither,
    weightInvert: CONTROL_DEFAULTS.weightInvert,
    weightSurreal: CONTROL_DEFAULTS.weightSurreal,
    weightPixelate: CONTROL_DEFAULTS.weightPixelate,
    weightOriginal: CONTROL_DEFAULTS.weightOriginal,
    randomSample: false,
    smearVertical: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.vertical),
    smearHorizontal: defaultSmear(true, SMEAR_AMOUNT_DEFAULTS.horizontal),
    smearDiagonal1: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.diagonal1),
    smearDiagonal2: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.diagonal2),
    smearRecursive: defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.recursive),
    verticalWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
    horizontalWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
    diagonal1Weight: SMEAR_WEIGHT_DEFAULTS.diagonal1,
    diagonal2Weight: SMEAR_WEIGHT_DEFAULTS.diagonal2,
    recursiveWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
    noiseScale: CONTROL_DEFAULTS.noiseScale,
    noiseSpread: CONTROL_DEFAULTS.noiseSpread,
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
    weightThermal: CONTROL_DEFAULTS.weightThermal,
    weightSlitScan: CONTROL_DEFAULTS.weightSlitScan,
    slitScanAmount: CONTROL_DEFAULTS.slitScanAmount,
    slitScanFrequency: CONTROL_DEFAULTS.slitScanFrequency,
    slitScanMode: SLIT_SCAN_MODE_DEFAULT,
    slitScanLuminanceMask: false,
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
 *   2. All eight effect weights (five + `halftoneAmount` + `weightThermal` +
 *      `weightSlitScan`) at 0 →
 *      `chooseEffect` has an empty pool; base-100 padding fall-through returns
 *      "original". `copyContinuousCellSample` then copies the original Color Master
 *      onto dest, which already holds that master at a matching origin, so pixels
 *      are unchanged.
 *   3. All smears `enabled: false` → `chooseSmear` / `chooseRecursiveSmear`
 *      skip and the smear step is a no-op.
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
    smearVertical: { enabled: false, amount: 0 },
    smearHorizontal: { enabled: false, amount: 0 },
    smearDiagonal1: { enabled: false, amount: 0 },
    smearDiagonal2: { enabled: false, amount: 0 },
    smearRecursive: { enabled: false, amount: 0 },
    // Smear Weights go back to their defaults rather than 0. At the default
    // of 50 they cover half the ON Cells when a style is switched on alone;
    // when several are on they still compete as shares of max(100, sum).
    // Inert while baking: no smear runs when every style is disabled.
    verticalWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
    horizontalWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
    diagonal1Weight: SMEAR_WEIGHT_DEFAULTS.diagonal1,
    diagonal2Weight: SMEAR_WEIGHT_DEFAULTS.diagonal2,
    recursiveWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
    // Noise Mask callout — carried over.
    noiseScale: current.noiseScale,
    noiseSpread: current.noiseSpread,
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
    weightThermal: 0,
    weightSlitScan: 0,
    // Shape params go back to their defaults rather than 0, same reasoning as
    // the Smear Weights above: they only shape Cells that rolled Slit Scan, and
    // at weight 0 none do. Zeroing slitScanAmount would also be a value the
    // Reset button can never produce.
    slitScanAmount: CONTROL_DEFAULTS.slitScanAmount,
    slitScanFrequency: CONTROL_DEFAULTS.slitScanFrequency,
    slitScanMode: SLIT_SCAN_MODE_DEFAULT,
    slitScanLuminanceMask: false,
  }
}

/**
 * Toolbar Reset: zero every effect, turn smears off, restore Cell Pattern / Noise Mask
 * defaults, and switch Random Sample off. Grain (and seed / Repeat) stay on the live
 * values.
 */
function buildToolbarResetSettings(current: EffectSettings): EffectSettings {
  return {
    ...current,
    weightDither: 0,
    weightInvert: 0,
    weightSurreal: 0,
    weightPixelate: 0,
    weightOriginal: 0,
    halftoneAmount: 0,
    weightThermal: 0,
    weightSlitScan: 0,
    slitScanAmount: CONTROL_DEFAULTS.slitScanAmount,
    slitScanFrequency: CONTROL_DEFAULTS.slitScanFrequency,
    slitScanMode: SLIT_SCAN_MODE_DEFAULT,
    slitScanLuminanceMask: false,
    randomSample: false,
    smearVertical: { enabled: false, amount: 0 },
    smearHorizontal: { enabled: false, amount: 0 },
    smearDiagonal1: { enabled: false, amount: 0 },
    smearDiagonal2: { enabled: false, amount: 0 },
    smearRecursive: { enabled: false, amount: 0 },
    verticalWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
    horizontalWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
    diagonal1Weight: SMEAR_WEIGHT_DEFAULTS.diagonal1,
    diagonal2Weight: SMEAR_WEIGHT_DEFAULTS.diagonal2,
    recursiveWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
    subdivisionLoops: CONTROL_DEFAULTS.subdivisionLoops,
    subdivisionMode: "frontier",
    subdivisionRate: CONTROL_DEFAULTS.subdivisionRate,
    noiseScale: CONTROL_DEFAULTS.noiseScale,
    noiseSpread: CONTROL_DEFAULTS.noiseSpread,
    showNoiseMap: false,
    showCellLayout: false,
  }
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
    "/images/Portrait_02.webp"
  )
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [bakeConfirmOpen, setBakeConfirmOpen] = useState(false)
  const [isBaking, setIsBaking] = useState(false)
  const [randomSample, setRandomSample] = useState(false)
  const [smearVertical, setSmearVertical] = useState(() =>
    defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.vertical)
  )
  const [smearHorizontal, setSmearHorizontal] = useState(() =>
    defaultSmear(true, SMEAR_AMOUNT_DEFAULTS.horizontal)
  )
  const [smearDiagonal1, setSmearDiagonal1] = useState(() =>
    defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.diagonal1)
  )
  const [smearDiagonal2, setSmearDiagonal2] = useState(() =>
    defaultSmear(false, SMEAR_AMOUNT_DEFAULTS.diagonal2)
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
  const [diagonal1Weight, setDiagonal1Weight] = useState<number>(
    SMEAR_WEIGHT_DEFAULTS.diagonal1
  )
  const [diagonal2Weight, setDiagonal2Weight] = useState<number>(
    SMEAR_WEIGHT_DEFAULTS.diagonal2
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
  const [weightThermal, setWeightThermal] = useState<number>(
    CONTROL_DEFAULTS.weightThermal
  )
  const [weightSlitScan, setWeightSlitScan] = useState<number>(
    CONTROL_DEFAULTS.weightSlitScan
  )
  const [slitScanAmount, setSlitScanAmount] = useState<number>(
    CONTROL_DEFAULTS.slitScanAmount
  )
  const [slitScanFrequency, setSlitScanFrequency] = useState<number>(
    CONTROL_DEFAULTS.slitScanFrequency
  )
  const [slitScanEnabled, setSlitScanEnabled] = useState(
    CONTROL_DEFAULTS.weightSlitScan > 0
  )
  const [slitScanMode, setSlitScanMode] = useState<SlitScanMode>(
    SLIT_SCAN_MODE_DEFAULT
  )
  const [slitScanLuminanceMask, setSlitScanLuminanceMask] = useState(false)
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
    const el = historyScrollRef.current
    if (!el) return
    const vertical = el.scrollHeight > el.clientHeight + 1
    el.scrollBy({
      top: vertical ? delta : 0,
      left: vertical ? 0 : delta,
      behavior: "smooth",
    })
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
    smearVertical,
    smearHorizontal,
    smearDiagonal1,
    smearDiagonal2,
    smearRecursive,
    verticalWeight,
    horizontalWeight,
    diagonal1Weight,
    diagonal2Weight,
    recursiveWeight,
    noiseScale,
    noiseSpread,
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
    weightThermal,
    weightSlitScan: slitScanEnabled ? weightSlitScan : 0,
    slitScanAmount,
    slitScanFrequency,
    slitScanMode,
    slitScanLuminanceMask,
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
    setSmearVertical({ ...next.smearVertical })
    setSmearHorizontal({ ...next.smearHorizontal })
    setSmearDiagonal1({ ...next.smearDiagonal1 })
    setSmearDiagonal2({ ...next.smearDiagonal2 })
    setSmearRecursive({ ...next.smearRecursive })
    setVerticalWeight(next.verticalWeight)
    setHorizontalWeight(next.horizontalWeight)
    setDiagonal1Weight(next.diagonal1Weight)
    setDiagonal2Weight(next.diagonal2Weight)
    setRecursiveWeight(next.recursiveWeight)
    setWeightOriginal(next.weightOriginal)
    setWeightDither(next.weightDither)
    setWeightInvert(next.weightInvert)
    setWeightSurreal(next.weightSurreal)
    setWeightPixelate(next.weightPixelate)
    setHalftoneAmount(next.halftoneAmount)
    setWeightThermal(next.weightThermal)
    setWeightSlitScan(next.weightSlitScan)
    setSlitScanEnabled(next.weightSlitScan > 0)
    setSlitScanAmount(next.slitScanAmount)
    setSlitScanFrequency(next.slitScanFrequency)
    setSlitScanMode(next.slitScanMode)
    setSlitScanLuminanceMask(next.slitScanLuminanceMask)
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

  /* Randomization is intentional here: this is only ever invoked from the Random
     button's click handler, never during render. */
  function buildRandomPhase12Settings(base: EffectSettings): EffectSettings {
    const verticalAmount = randomSignedSmearAmount()
    const horizontalAmount = randomSignedSmearAmount()
    const diagonal1Amount = randomSignedSmearAmount()
    const diagonal2Amount = randomSignedSmearAmount()
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
      smearVertical: {
        enabled: verticalAmount !== 0 || Math.random() < enableWhenZero,
        amount: verticalAmount,
      },
      smearHorizontal: {
        enabled: horizontalAmount !== 0 || Math.random() < enableWhenZero,
        amount: horizontalAmount,
      },
      smearDiagonal1: {
        enabled: diagonal1Amount !== 0 || Math.random() < enableWhenZero,
        amount: diagonal1Amount,
      },
      smearDiagonal2: {
        enabled: diagonal2Amount !== 0 || Math.random() < enableWhenZero,
        amount: diagonal2Amount,
      },
      smearRecursive: {
        enabled: recursiveAmount > 0 || Math.random() < enableWhenZero,
        amount: recursiveAmount,
      },
      verticalWeight: randInt(R.smearWeight.min, R.smearWeight.max),
      horizontalWeight: randInt(R.smearWeight.min, R.smearWeight.max),
      diagonal1Weight: randInt(R.smearWeight.min, R.smearWeight.max),
      diagonal2Weight: randInt(R.smearWeight.min, R.smearWeight.max),
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
      weightThermal:
        Math.random() < R.weightThermal.zeroChance
          ? 0
          : randInt(R.weightThermal.min, R.weightThermal.max),
      weightSlitScan:
        Math.random() < R.weightSlitScan.zeroChance
          ? 0
          : randInt(R.weightSlitScan.min, R.weightSlitScan.max),
      slitScanAmount: randInt(R.slitScanAmount.min, R.slitScanAmount.max),
      slitScanFrequency: randInt(
        R.slitScanFrequency.min,
        R.slitScanFrequency.max
      ),
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
      setUploadError("Please upload a JPEG, PNG, WebP, or GIF image.")
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("File is too large. Please upload an image under 40MB.")
      return
    }

    void (async () => {
      try {
        const probe = await createImageBitmap(file)
        const edge = Math.max(probe.width, probe.height)
        const pixels = probe.width * probe.height
        probe.close()
        if (edge > MAX_DECODE_EDGE || pixels > MAX_DECODE_PIXELS) {
          setUploadError(
            "Image dimensions are too large. Please use an image under 8192px on the long edge."
          )
          return
        }

        const url = URL.createObjectURL(file)
        setUploadError(null)
        setImageSrc(url)
        seedRandomHistory(effectSettings)
      } catch {
        setUploadError("Could not read that image. Please try another file.")
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
   * Append snapshots onto the Random undo stack, dropping any redo future and
   * capping length. Used by Random and Reset so Previous Random can walk back.
   */
  function commitAutoFillHistory(entries: EffectSettings[]) {
    const truncated = autoFillHistory.slice(0, Math.max(0, historyIndex + 1))
    let nextHistory = [...truncated, ...entries]
    if (nextHistory.length > MAX_AUTO_FILL_HISTORY) {
      nextHistory = nextHistory.slice(nextHistory.length - MAX_AUTO_FILL_HISTORY)
    }
    setAutoFillHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
  }

  /**
   * Randomize Phase 1 + Phase 2 only.
   * Phase 3 (textureEnabled / textureOpacity) and debug overlays are preserved.
   * Pushes onto the Random history stack (truncating any redo future).
   */
  function handleAutoFill() {
    const newSettings = cloneEffectSettings(buildRandomPhase12Settings(effectSettings))
    commitAutoFillHistory([newSettings])
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
      setVisualHistory((prev) => capVisualHistory([snapshot, ...prev], previewedId))
    }, "image/png")
  }

  /** Instantly remove one History thumbnail and free its blobs if nothing else needs them. */
  function handleDeleteHistory(id: string, event: React.MouseEvent) {
    event.stopPropagation()
    // Deleting the snapshot on screen would leave the modal showing a revoked URL.
    // Dismiss it the same way Cancel does, so the controls rewind instead of being
    // stranded on the deleted snapshot's settings.
    if (previewItem?.id === id) cancelPreview()
    // Pure updater: the blobs this drops are freed by the release effect below,
    // which runs once on the list that actually committed.
    setVisualHistory((prev) => {
      const survivors = prev.filter((snap) => snap.id !== id)
      // Recap in case the list was holding an extra pinned preview slot.
      const stillPreviewing =
        previewItem?.id === id ? undefined : previewItem?.id
      return capVisualHistory(survivors, stillPreviewing)
    })
  }

  /**
   * Open the preview modal, or switch it to a different snapshot.
   *
   * The live controls jump to the snapshot's settings so the sidebar reads out the exact
   * parameters behind the image on screen. The pre-preview state is stashed once, on the
   * way in, and `previewing` is what gates that — see `backupSettings`.
   *
   * The single entry point into previewing: `handleRestore` relies on the settings
   * already being live, so nothing else may call `setPreviewItem` with a snapshot.
   */
  function openPreview(snapshot: HistorySnapshot) {
    if (!previewing) {
      setBackupSettings(cloneEffectSettings(effectSettings))
    }
    applyFullEffectSettings(snapshot.effectSettings)
    setPreviewItem(snapshot)
    // Switching the pin from A to B must evict A if it was only kept as the extra slot.
    setVisualHistory((prev) => capVisualHistory(prev, snapshot.id))
  }

  /** Restore the previewed snapshot: load its image as the live working state. */
  function handleRestore() {
    if (!previewItem) return
    const { imageSrc: restoredSrc } = previewItem
    setVisualHistory((prev) => capVisualHistory(prev, undefined))
    setImageSrc(restoredSrc)
    // The snapshot's settings went live back in `openPreview`, so restoring them is just a
    // matter of dropping the backup — re-applying here would only churn the smear object
    // identities `useAppWorkers` watches and cost a redundant worker render.
    setBackupSettings(null)
    setPreviewItem(null)
  }

  /**
   * Toolbar Reset: effects and smears off, Cell Pattern / Noise Mask at defaults,
   * Random Sample off. Grain is left on the live settings.
   * Pushes the pre-reset state then the reset state onto the Random stack so
   * Previous Random undoes an accidental click.
   */
  function resetGenerationParameters() {
    const before = cloneEffectSettings(effectSettings)
    const after = cloneEffectSettings(buildToolbarResetSettings(effectSettings))
    commitAutoFillHistory([before, after])
    applyFullEffectSettings(after)
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
      setImageSrc(url)
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

  /** Mirrors for reads from blob helpers, which must see committed state, not a stale closure. */
  const imageSrcRef = useRef(imageSrc)
  const visualHistoryRef = useRef(visualHistory)
  useEffect(() => {
    imageSrcRef.current = imageSrc
    visualHistoryRef.current = visualHistory
  }, [imageSrc, visualHistory])

  /**
   * Blob URLs are freed here, never inside the state updaters that drop them.
   * React treats an updater as pure and is free to replay or discard one; a
   * discarded replay that had already revoked would leave the state that
   * actually committed pointing at a dead URL, which shows up as a broken
   * thumbnail rather than an error. An effect runs once, after commit, over the
   * values that won.
   *
   * Both holders are still checked through `releaseSourceBlob`, since one source
   * blob can back the live image and any number of snapshots at once.
   */
  const releasedImageSrcRef = useRef(imageSrc)
  const releasedHistoryRef = useRef(visualHistory)
  useEffect(() => {
    const previousSrc = releasedImageSrcRef.current
    const previousHistory = releasedHistoryRef.current
    releasedImageSrcRef.current = imageSrc
    releasedHistoryRef.current = visualHistory

    if (previousSrc && previousSrc !== imageSrc) {
      releaseSourceBlob(previousSrc, {
        liveImageSrc: imageSrc,
        history: visualHistory,
      })
    }

    if (previousHistory === visualHistory) return
    const liveIds = new Set(visualHistory.map((snap) => snap.id))
    for (const gone of previousHistory) {
      if (liveIds.has(gone.id)) continue
      releaseSourceBlob(gone.imageSrc, {
        liveImageSrc: imageSrc,
        history: visualHistory,
      })
      // Each `previewSrc` belongs to exactly one snapshot, so it only needs
      // guarding against the copy the modal is currently showing.
      if (gone.previewSrc && gone.id !== previewItem?.id) {
        URL.revokeObjectURL(gone.previewSrc)
      }
    }
  }, [imageSrc, visualHistory, previewItem])

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

  /** Dismiss the preview without restoring it: rewind the controls to the stashed state. */
  const cancelPreview = useCallback(() => {
    if (backupSettings) {
      applyFullEffectSettings(backupSettings)
    }
    setBackupSettings(null)
    setPreviewItem(null)
    setVisualHistory((prev) => capVisualHistory(prev, undefined))
  }, [backupSettings, applyFullEffectSettings])

  /**
   * Escape dismisses the History preview modal, same as the backdrop or Cancel.
   * Goes through `cancelPreview` so a snapshot that was only kept as the extra
   * pinned slot is evicted and its blobs are revoked.
   */
  useEffect(() => {
    if (!previewing) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      cancelPreview()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [previewing, cancelPreview])

  /**
   * Escape dismisses the Bake confirm dialog, same as Cancel / backdrop.
   * Ignored while a bake is in flight so the dialog cannot vanish mid-job.
   */
  useEffect(() => {
    if (!bakeConfirmOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (!isBaking) setBakeConfirmOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [bakeConfirmOpen, isBaking])

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
    if (!file) return
    processFile(file)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-slate-900 via-[#08080a] to-black font-body text-[#f5f5f7]">
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

        <RepeatSection
          passes={passes}
          passesDrag={passesDrag}
          rate={rate}
          setPasses={setPasses}
          setPassesDrag={setPassesDrag}
          setRate={setRate}
        />

        <LayoutSection
          showCellLayout={showCellLayout}
          handleShowCellLayoutChange={handleShowCellLayoutChange}
          subdivisionLoops={subdivisionLoops}
          setSubdivisionLoops={setSubdivisionLoops}
          subdivisionMode={subdivisionMode}
          setSubdivisionMode={setSubdivisionMode}
          subdivisionRate={subdivisionRate}
          setSubdivisionRate={setSubdivisionRate}
        />

        <NoiseMaskSection
          showNoiseMap={showNoiseMap}
          handleShowNoiseMapChange={handleShowNoiseMapChange}
          noiseScale={noiseScale}
          setNoiseScale={setNoiseScale}
          noiseSpread={noiseSpread}
          setNoiseSpread={setNoiseSpread}
        />

        <BaseEffectsSection
          randomSample={randomSample}
          setRandomSample={setRandomSample}
          weightDither={weightDither}
          setWeightDither={setWeightDither}
          weightInvert={weightInvert}
          setWeightInvert={setWeightInvert}
          weightSurreal={weightSurreal}
          setWeightSurreal={setWeightSurreal}
          weightPixelate={weightPixelate}
          setWeightPixelate={setWeightPixelate}
          halftoneAmount={halftoneAmount}
          setHalftoneAmount={setHalftoneAmount}
          weightThermal={weightThermal}
          setWeightThermal={setWeightThermal}
          weightOriginal={weightOriginal}
          setWeightOriginal={setWeightOriginal}
          slitScanEnabled={slitScanEnabled}
          setSlitScanEnabled={setSlitScanEnabled}
          slitScanMode={slitScanMode}
          setSlitScanMode={setSlitScanMode}
          slitScanLuminanceMask={slitScanLuminanceMask}
          setSlitScanLuminanceMask={setSlitScanLuminanceMask}
          weightSlitScan={weightSlitScan}
          setWeightSlitScan={setWeightSlitScan}
          slitScanAmount={slitScanAmount}
          setSlitScanAmount={setSlitScanAmount}
          slitScanFrequency={slitScanFrequency}
          setSlitScanFrequency={setSlitScanFrequency}
        />

        <SmearsSection
          smearVertical={smearVertical}
          setSmearVertical={setSmearVertical}
          smearHorizontal={smearHorizontal}
          setSmearHorizontal={setSmearHorizontal}
          smearDiagonal1={smearDiagonal1}
          setSmearDiagonal1={setSmearDiagonal1}
          smearDiagonal2={smearDiagonal2}
          setSmearDiagonal2={setSmearDiagonal2}
          smearRecursive={smearRecursive}
          setSmearRecursive={setSmearRecursive}
          verticalWeight={verticalWeight}
          setVerticalWeight={setVerticalWeight}
          horizontalWeight={horizontalWeight}
          setHorizontalWeight={setHorizontalWeight}
          diagonal1Weight={diagonal1Weight}
          setDiagonal1Weight={setDiagonal1Weight}
          diagonal2Weight={diagonal2Weight}
          setDiagonal2Weight={setDiagonal2Weight}
          recursiveWeight={recursiveWeight}
          setRecursiveWeight={setRecursiveWeight}
        />

        <PostProcessingSection
          textureEnabled={textureEnabled}
          setTextureEnabled={setTextureEnabled}
          textureOpacity={textureOpacity}
          setTextureOpacity={setTextureOpacity}
        />
        <p className={cn("px-1 pb-2 text-center text-slate-600 lg:hidden", footerText)}>
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

      {/*
        One breakpoint (`lg` / 1024px), mobile-first:
        - Below lg: canvas stack is a bounded-height row (never 50vh+), history is a
          horizontal strip, controls take leftover height and always scroll.
        - lg+: three columns — controls | canvas | history.
        `min-w-0` lets the canvas column shrink instead of overflowing the history rail.
      */}
      <div className="order-1 flex min-h-0 min-w-0 w-full max-lg:h-[min(58dvh,36rem)] max-lg:shrink-0 flex-col lg:order-2 lg:h-full lg:flex-1 lg:flex-row lg:gap-6">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-3 pt-0 lg:overflow-hidden lg:p-6">
        <div
          className={cn(
            floatingCard,
            "flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0"
          )}
        >
          <CanvasViewport
            imageSrc={imageSrc}
            liveCanvasRef={liveCanvasRef}
            fileInputRef={fileInputRef}
            handleDragOver={handleDragOver}
            handleDragEnter={handleDragEnter}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            isDragging={isDragging}
            uploadError={uploadError}
            previewItem={previewItem}
            cancelPreview={cancelPreview}
          />
          <HeaderControls
            previewing={previewing}
            handleRestore={handleRestore}
            cancelPreview={cancelPreview}
            seed={seed}
            setSeed={setSeed}
            autoFillHistory={autoFillHistory}
            historyIndex={historyIndex}
            handleAutoFill={handleAutoFill}
            handleAutoFillBack={handleAutoFillBack}
            handleAutoFillForward={handleAutoFillForward}
            imageSrc={imageSrc}
            fileInputRef={fileInputRef}
            isExportingPng={isExportingPng}
            exportHighResImage={exportHighResImage}
            handleBakeClick={handleBakeClick}
            isBaking={isBaking}
            resetGenerationParameters={resetGenerationParameters}
            handleCapture={handleCapture}
          />
        </div>
      </main>

      {visualHistory.length > 0 && (
        <HistoryFilmstrip
          visualHistory={visualHistory}
          historyScrollRef={historyScrollRef}
          scrollHistory={scrollHistory}
          openPreview={openPreview}
          handleDeleteHistory={handleDeleteHistory}
        />
      )}
      </div>
      </div>
      <footer className={cn("hidden w-full shrink-0 border-t border-white/10 py-3 text-center lg:block", footerText)}>
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

      <BakeDialog
        bakeConfirmOpen={bakeConfirmOpen}
        setBakeConfirmOpen={setBakeConfirmOpen}
        isBaking={isBaking}
        confirmBake={confirmBake}
      />

    </div>
  )
}
