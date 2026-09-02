"use client"

import { useEffect, useRef, useState } from "react"
import type {
  ComponentProps,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react"
import { ChevronLeft, ChevronRight, Pause, Play, Spline } from "lucide-react"
import type { EffectSettings, SpeedRampPoint } from "@/lib/effect-types"
import { Button } from "@/components/ui/button"
import { LIVE_PLAY_SPEED } from "@/components/controls/defaults"
import { SpeedRampCurve } from "@/components/controls/SpeedRampCurve"
import {
  sliderValueReadout,
  toolbarActionButton,
} from "@/components/controls/styles"
import { cn } from "@/lib/utils"

/** Same touch-scroll lock as `components/ui/slider.tsx` — React pointer events are non-passive. */
function preventTouchScroll(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") {
    event.preventDefault()
  }
}

type HeaderControlsProps = {
  previewing: boolean
  handleRestore: () => void
  cancelPreview: () => void
  seed: number
  setSeed: Dispatch<SetStateAction<number>>
  autoFillHistory: EffectSettings[]
  historyIndex: number
  handleAutoFill: () => void
  handleAutoFillBack: () => void
  handleAutoFillForward: () => void
  imageSrc: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  isExportingPng: boolean
  exportHighResImage: () => void
  handleBakeClick: () => void
  isBaking: boolean
  resetGenerationParameters: () => void
  handleCapture: () => void
  /** Live Play state — the animation toggle. */
  isPlaying: boolean
  togglePlaying: () => void
  /** Pixels of scroll per rendered frame. */
  livePlaySpeed: number
  setLivePlaySpeed: (speed: number) => void
  /** Per-Cell speed curve — see `components/controls/SpeedRampCurve.tsx`. */
  speedRamp: SpeedRampPoint[]
  setSpeedRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
}

/**
 * Play / Load / Bake / Reset / Capture / Save share one outer width: the word
 * "Capture" (the longest label) plus `toolbarActionButton`'s padding, which
 * already steps down on small screens. An invisible "Capture" holds the width
 * in-flow; the real label is overlaid and centered so shorter words don't
 * shrink the pill and Capture never overflows it.
 */
function EqualToolbarButton({
  children,
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      size="sm"
      className={cn(toolbarActionButton, "relative overflow-hidden", className)}
      {...props}
    >
      <span className="invisible select-none" aria-hidden="true">
        Capture
      </span>
      <span className="absolute inset-0 flex items-center justify-center gap-1 whitespace-nowrap">
        {children}
      </span>
    </Button>
  )
}

/**
 * The action bar under the canvas: Seed and Random on the first row, Live Play
 * (play, speed) on the next, then Upload, Save, Bake, Reset and Capture — plus
 * the Restore/Cancel pair that covers them all while a History snapshot is
 * previewed.
 */
export function HeaderControls({
  previewing,
  handleRestore,
  cancelPreview,
  seed,
  setSeed,
  autoFillHistory,
  historyIndex,
  handleAutoFill,
  handleAutoFillBack,
  handleAutoFillForward,
  imageSrc,
  fileInputRef,
  isExportingPng,
  exportHighResImage,
  handleBakeClick,
  isBaking,
  resetGenerationParameters,
  handleCapture,
  isPlaying,
  togglePlaying,
  livePlaySpeed,
  setLivePlaySpeed,
  speedRamp,
  setSpeedRamp,
}: HeaderControlsProps) {
  /** Filled fraction of the speed track, mirroring the Slider's Indicator. */
  const speedPercent =
    ((livePlaySpeed - LIVE_PLAY_SPEED.min) /
      (LIVE_PLAY_SPEED.max - LIVE_PLAY_SPEED.min)) *
    100
  const [rampOpen, setRampOpen] = useState(false)
  const rampContainerRef = useRef<HTMLDivElement>(null)

  /**
   * Click-outside / Escape to close, via a document listener rather than a
   * full-viewport backdrop element: this toolbar sits inside a
   * `backdrop-blur` card, and `backdrop-filter` establishes a containing
   * block for `position: fixed` descendants — a `fixed inset-0` backdrop
   * nested in here only covers that card's box, not the sidebar, so it
   * can never actually catch a click there. A listener has no such limit.
   */
  useEffect(() => {
    if (!rampOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (!rampContainerRef.current?.contains(event.target as Node)) {
        setRampOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setRampOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [rampOpen])

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-2 border-t border-white/10 px-3 py-2 md:gap-3 md:px-6 md:py-4">
      {/* Restore/Cancel sit on top of the hidden controls, so the toolbar keeps its
          exact height and the canvas above it never resizes. */}
      {previewing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-4">
          <Button
            type="button"
            size="sm"
            className={cn(toolbarActionButton, "h-8 rounded-full px-6")}
            onClick={handleRestore}
          >
            Restore
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
          "flex min-w-0 flex-col items-center gap-1.5 md:gap-3",
          previewing && "invisible"
        )}
        inert={previewing ? true : undefined}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 md:gap-3">
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

        <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 md:gap-3">
        <EqualToolbarButton
          type="button"
          aria-label={isPlaying ? "Pause Live Play" : "Start Live Play"}
          aria-pressed={isPlaying}
          title={
            isPlaying
              ? "Pause the scrolling Cells"
              : "Scroll the pixels inside each Cell; the grid stays put"
          }
          disabled={!imageSrc}
          onClick={togglePlaying}
        >
          {isPlaying ? (
            <Pause className="size-3.5" strokeWidth={2} />
          ) : (
            <Play className="size-3.5" strokeWidth={2} />
          )}
          {isPlaying ? "Pause" : "Play"}
        </EqualToolbarButton>

        {/* Speed.

            A bare <input type="range">, deliberately, rather than the app's
            <Slider>. Base UI's slider ships its thumb and fill with inline
            `visibility:hidden` and `--position:0%` and reveals them only once it
            has measured the control in the browser; in this toolbar that never
            resolved, so the control rendered as an invisible 3px line and read
            as a static readout. A native range input needs no measurement pass —
            it paints its own track and thumb — so it cannot fail that way.

            Styled to match components/ui/slider.tsx exactly: a 3px slate-700/50
            track, a slate-500 → slate-300 → slate-200 fill across the filled
            portion, and a 3.5 slate-300 → slate-500 thumb with the same hover
            glow. The colours come from the theme variables rather than hex, so
            they stay in step with the rest of the palette. The input itself is
            taller than the 3px band purely to give the thumb a grabbable area.

            Not gated on `imageSrc` either: it is a playback preference, not an
            image operation, and disabled opacity also made it look inert. */}
        <div
          className="flex h-8 shrink-0 touch-none items-center gap-2.5 rounded-lg border border-white/10 px-3"
          title="Live Play speed — pixels of scroll per rendered frame"
          style={{ touchAction: "none" }}
          onPointerDown={preventTouchScroll}
        >
          <span className="shrink-0 text-xs font-medium text-slate-400">
            Speed
          </span>
          <input
            type="range"
            aria-label="Live Play speed"
            min={LIVE_PLAY_SPEED.min}
            max={LIVE_PLAY_SPEED.max}
            step={LIVE_PLAY_SPEED.step}
            value={livePlaySpeed}
            onChange={(event) =>
              setLivePlaySpeed(Number.parseFloat(event.currentTarget.value))
            }
            onPointerDown={preventTouchScroll}
            style={{
              touchAction: "none",
              backgroundImage:
                "linear-gradient(to right, var(--color-slate-500), var(--color-slate-300), var(--color-slate-200))," +
                "linear-gradient(to right, color-mix(in oklab, var(--color-slate-700) 50%, transparent), color-mix(in oklab, var(--color-slate-700) 50%, transparent))",
              backgroundSize: `${speedPercent}% 3px, 100% 3px`,
              backgroundPosition: "left center",
              backgroundRepeat: "no-repeat",
            }}
            className={cn(
              "h-3.5 w-24 min-w-0 touch-none cursor-pointer appearance-none bg-transparent outline-none md:w-28",
              "[&::-webkit-slider-runnable-track]:h-3.5 [&::-webkit-slider-runnable-track]:bg-transparent",
              "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-[linear-gradient(to_bottom,var(--color-slate-300),var(--color-slate-400),var(--color-slate-500))] [&::-webkit-slider-thumb]:transition-shadow",
              "[&:hover::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(255,255,255,0.25)] [&:focus-visible::-webkit-slider-thumb]:shadow-[0_0_0_2px_rgba(255,255,255,0.35)]",
              "[&::-moz-range-track]:h-[3px] [&::-moz-range-track]:bg-transparent",
              "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[linear-gradient(to_bottom,var(--color-slate-300),var(--color-slate-400),var(--color-slate-500))]"
            )}
          />
          <span className={sliderValueReadout} aria-hidden="true">
            {livePlaySpeed.toFixed(1)}
          </span>
        </div>

        {/* Speed Ramp toggle, right next to Speed — the curve editor itself needs far
            more room than this toolbar strip has, so it opens as a popover anchored
            here instead of sitting inline. Closes on an outside click or Escape via
            the document listener above, not a backdrop element — see that comment. */}
        <div className="relative" ref={rampContainerRef}>
          <button
            type="button"
            aria-label={rampOpen ? "Close speed ramp editor" : "Open speed ramp editor"}
            aria-expanded={rampOpen}
            title="Speed ramp — shape how Live Play speed varies across Cells"
            onClick={() => setRampOpen((prev) => !prev)}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:text-slate-100",
              rampOpen ? "bg-white/10 text-slate-100" : "bg-transparent"
            )}
          >
            <Spline className="size-4" strokeWidth={2} aria-hidden />
          </button>

          {rampOpen && (
            <div
              className="absolute bottom-full right-0 z-40 mb-2 w-72 touch-none rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 text-[#f5f5f7] shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl"
              style={{ touchAction: "none" }}
              onPointerDown={preventTouchScroll}
            >
              <SpeedRampCurve
                title="Speed Ramp"
                speedRamp={speedRamp}
                setSpeedRamp={setSpeedRamp}
              />
            </div>
          )}
        </div>
        </div>
      </div>

      <div
        className={cn(
          "hide-scrollbar flex w-full max-w-full flex-row flex-nowrap items-center justify-center-safe gap-1 overflow-x-auto transition-opacity duration-300 lg:max-w-none lg:gap-3 lg:overflow-visible lg:flex-wrap lg:justify-center",
          previewing && "invisible"
        )}
        inert={previewing ? true : undefined}
      >
          <EqualToolbarButton
            type="button"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.value = ""
                fileInputRef.current.click()
              }
            }}
          >
            Load
          </EqualToolbarButton>
          <EqualToolbarButton
            type="button"
            disabled={!imageSrc || isBaking}
            title="Bake the current output as the next input image"
            onClick={handleBakeClick}
          >
            Bake
          </EqualToolbarButton>
          <EqualToolbarButton
            type="button"
            disabled={!imageSrc}
            title="Zero effects and smears; restore Cell Pattern and Noise Mask defaults (keeps grain)"
            onClick={resetGenerationParameters}
          >
            Reset
          </EqualToolbarButton>
          <EqualToolbarButton
            type="button"
            disabled={!imageSrc}
            title="Save a thumbnail of this result to History"
            onClick={handleCapture}
          >
            Capture
          </EqualToolbarButton>
          <EqualToolbarButton
            disabled={!imageSrc || isExportingPng}
            onClick={exportHighResImage}
          >
            Save
          </EqualToolbarButton>
      </div>
    </div>
  )
}
