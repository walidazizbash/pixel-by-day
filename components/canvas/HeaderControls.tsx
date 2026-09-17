"use client"

import { useEffect, useRef, useState } from "react"
import type {
  ComponentProps,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react"
import { Camera, ChevronLeft, ChevronRight, Download, Folder, Move, Pause, Play, RotateCcw, Shuffle, Sparkles, Spline } from "lucide-react"
import type {
  DirectionWeights,
  EffectSettings,
  SpeedRampPoint,
} from "@/lib/effect-types"
import { Button } from "@/components/ui/button"
import { LIVE_PLAY_SPEED } from "@/components/controls/defaults"
import { SpeedRampCurve } from "@/components/controls/SpeedRampCurve"
import {
  controlField,
  controlLabel,
  sliderValueReadout,
  toolbarActionButton,
  toolbarPrimaryButton,
} from "@/components/controls/styles"
import { cn } from "@/lib/utils"

/** Same touch-scroll lock as `components/ui/slider.tsx` — React pointer events are non-passive. */
function preventTouchScroll(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") {
    event.preventDefault()
  }
}

/**
 * A native `<input type="range">` styled to match the sidebar's `<Slider>`
 * (`components/ui/slider.tsx`) — same reason the Speed control above uses one
 * instead of the Base UI primitive directly: that control never resolved its
 * measurement pass inside this toolbar's popovers and rendered as an invisible
 * 3px line. Reused for the four Direction weight sliders below.
 */
function ToolbarSlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const percent = Math.min(100, Math.max(0, value))
  return (
    <div className={controlField}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className={controlLabel}>
          {label}
        </label>
        <span className={sliderValueReadout} aria-hidden="true">
          {Math.round(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        aria-label={label}
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) =>
          onChange(Number.parseFloat(event.currentTarget.value))
        }
        onPointerDown={preventTouchScroll}
        style={{
          touchAction: "none",
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--color-ink) 45%, transparent), color-mix(in oklab, var(--color-ink) 45%, transparent))," +
            "linear-gradient(to right, color-mix(in oklab, var(--color-ink) 10%, transparent), color-mix(in oklab, var(--color-ink) 10%, transparent))",
          backgroundSize: `${percent}% 3px, 100% 3px`,
          backgroundPosition: "left center",
          backgroundRepeat: "no-repeat",
        }}
        className={cn(
          "h-3.5 w-full min-w-0 touch-none cursor-pointer appearance-none bg-transparent outline-none",
          "[&::-webkit-slider-runnable-track]:h-3.5 [&::-webkit-slider-runnable-track]:bg-transparent",
          "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-[var(--color-ink)] [&::-webkit-slider-thumb]:transition-shadow",
          "[&:hover::-webkit-slider-thumb]:shadow-[0_0_0_5px_rgba(73,53,240,0.22)] [&:focus-visible::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-accent)]",
          "[&::-moz-range-track]:h-[3px] [&::-moz-range-track]:bg-transparent",
          "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--color-ink)]"
        )}
      />
    </div>
  )
}

type HeaderControlsProps = {
  previewing: boolean
  handleRestore: () => void
  cancelPreview: () => void
  imageSrc: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  /** Seed readout and stepper — same handlers `SeedSection` used before this moved back into the toolbar. */
  seed: number
  setSeed: Dispatch<SetStateAction<number>>
  autoFillHistory: EffectSettings[]
  historyIndex: number
  handleAutoFill: () => void
  handleAutoFillBack: () => void
  handleAutoFillForward: () => void
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
  /** Per-Cell scroll direction weights — see `lib/direction-weights.ts`. */
  directionWeights: DirectionWeights
  setDirectionWeights: Dispatch<SetStateAction<DirectionWeights>>
}

/**
 * Play / Load / Bake / Reset / Capture / Save all share the same outer width
 * per breakpoint: the word "Capture" (the longest label) plus one icon and the
 * button's own padding. An invisible "Capture" holds that width in-flow; the
 * real icon+label is overlaid and centered so shorter words don't shrink the
 * pill and Capture never overflows it.
 *
 * Load / Bake / Reset / Capture / Save (`tone="solid"`) render as one uniform
 * opaque blue set — none singled out as "the primary one," Bake included.
 * Play stays on the neutral border-and-wash treatment since it isn't part of
 * that action row.
 *
 * The label stays visible at every breakpoint — a first-time user reading
 * "Load" / "Reset" / "Save" is clearer than a bare icon, which is all that
 * showed below `sm` before. Only the icon drops below `sm`, so on narrow
 * screens the row shows five labeled buttons rather than five icons.
 */
function EqualToolbarButton({
  icon,
  label,
  className,
  tone = "wash",
  ...props
}: ComponentProps<typeof Button> & {
  icon: ReactNode
  label: string
  tone?: "wash" | "solid"
}) {
  return (
    <Button
      size="sm"
      aria-label={label}
      className={cn(
        tone === "solid" ? toolbarPrimaryButton : toolbarActionButton,
        "relative overflow-hidden",
        className
      )}
      {...props}
    >
      {/* Reserves the same width the real content below needs at each
          breakpoint (icon+"Capture" at `sm+`, "Capture" alone below it), so
          shorter labels don't shrink or shift the row and "Capture" never
          overflows it. */}
      <span className="invisible flex select-none items-center gap-1.5" aria-hidden="true">
        <Camera className="hidden size-3.5 sm:block" strokeWidth={2} />
        <span>Capture</span>
      </span>
      <span className="absolute inset-0 flex items-center justify-center gap-1.5 whitespace-nowrap">
        <span className="hidden sm:flex">{icon}</span>
        <span>{label}</span>
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
  imageSrc,
  fileInputRef,
  seed,
  setSeed,
  autoFillHistory,
  historyIndex,
  handleAutoFill,
  handleAutoFillBack,
  handleAutoFillForward,
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
  directionWeights,
  setDirectionWeights,
}: HeaderControlsProps) {
  /** Filled fraction of the speed track, mirroring the Slider's Indicator. */
  const speedPercent =
    ((livePlaySpeed - LIVE_PLAY_SPEED.min) /
      (LIVE_PLAY_SPEED.max - LIVE_PLAY_SPEED.min)) *
    100
  const [rampOpen, setRampOpen] = useState(false)
  const rampContainerRef = useRef<HTMLDivElement>(null)
  const [directionOpen, setDirectionOpen] = useState(false)
  const directionContainerRef = useRef<HTMLDivElement>(null)

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

  /** Same click-outside / Escape mechanics as the Speed Ramp popover above. */
  useEffect(() => {
    if (!directionOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (!directionContainerRef.current?.contains(event.target as Node)) {
        setDirectionOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDirectionOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [directionOpen])

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-2 border-t border-ink/10 px-3 py-2 md:gap-3 md:px-6 md:py-4">
      {/* Restore/Cancel sit on top of the hidden controls, so the toolbar keeps its
          exact height and the canvas above it never resizes. */}
      {previewing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-4">
          <Button
            type="button"
            size="sm"
            className={cn(toolbarPrimaryButton, "h-8 px-6")}
            onClick={handleRestore}
          >
            Restore
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn(toolbarActionButton, "h-8 px-6")}
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
        {/* Seed / Random, back on the toolbar's own line above Play/Speed —
            same handlers as before, styled to match the Speed control:
            a bordered pill with its label to the left of the control. */}
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 md:gap-3">
          <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-ink/15 px-3">
            <span className="shrink-0 text-xs font-medium text-ink">
              Seed
            </span>
            <button
              type="button"
              aria-label="Decrease seed"
              onClick={() => setSeed((prev) => Math.max(0, prev - 1))}
              className="inline-flex size-5 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Seed"
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
              className="w-12 shrink-0 bg-transparent text-center font-footer text-sm tabular-nums text-ink outline-none"
            />
            <button
              type="button"
              aria-label="Increase seed"
              onClick={() => setSeed((prev) => Math.min(99999, prev + 1))}
              className="inline-flex size-5 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink"
            >
              <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-ink/15 px-3">
            <span className="shrink-0 text-xs font-medium text-ink">
              Random
            </span>
            <button
              type="button"
              aria-label="Previous Random"
              disabled={!imageSrc || historyIndex <= 0}
              onClick={handleAutoFillBack}
              className="inline-flex size-5 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Generate Random"
              disabled={!imageSrc}
              onClick={handleAutoFill}
              className="inline-flex size-5 shrink-0 items-center justify-center text-accent-strong transition-colors hover:text-accent disabled:pointer-events-none disabled:opacity-35"
            >
              <Shuffle className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next Random"
              disabled={!imageSrc || historyIndex >= autoFillHistory.length - 1}
              onClick={handleAutoFillForward}
              className="inline-flex size-5 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 md:gap-3">
        <EqualToolbarButton
          type="button"
          aria-label={isPlaying ? "Pause Live Play" : "Start Live Play"}
          aria-pressed={isPlaying}
          disabled={!imageSrc}
          onClick={togglePlaying}
          icon={
            isPlaying ? (
              <Pause className="size-3.5" strokeWidth={2} aria-hidden />
            ) : (
              <Play className="size-3.5" strokeWidth={2} aria-hidden />
            )
          }
          label={isPlaying ? "Pause" : "Play"}
        />

        {/* Speed.

            A bare <input type="range">, deliberately, rather than the app's
            <Slider>. Base UI's slider ships its thumb and fill with inline
            `visibility:hidden` and `--position:0%` and reveals them only once it
            has measured the control in the browser; in this toolbar that never
            resolved, so the control rendered as an invisible 3px line and read
            as a static readout. A native range input needs no measurement pass —
            it paints its own track and thumb — so it cannot fail that way.

            Styled to match components/ui/slider.tsx exactly: a 3px ink/10
            track, an ink/45 fill across the filled portion, and a 3.5 solid
            ink thumb with the same blue hover/focus glow. The colours come
            from the theme variables rather than hex, so they stay in step
            with the rest of the palette. The input itself is taller than the
            3px band purely to give the thumb a grabbable area.

            Not gated on `imageSrc` either: it is a playback preference, not an
            image operation, and disabled opacity also made it look inert. */}
        <div
          className="flex h-8 shrink-0 touch-none items-center gap-2.5 rounded-lg border border-ink/15 px-3"
          style={{ touchAction: "none" }}
          onPointerDown={preventTouchScroll}
        >
          <span className="shrink-0 text-xs font-medium text-ink">
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
                "linear-gradient(to right, color-mix(in oklab, var(--color-ink) 45%, transparent), color-mix(in oklab, var(--color-ink) 45%, transparent))," +
                "linear-gradient(to right, color-mix(in oklab, var(--color-ink) 10%, transparent), color-mix(in oklab, var(--color-ink) 10%, transparent))",
              backgroundSize: `${speedPercent}% 3px, 100% 3px`,
              backgroundPosition: "left center",
              backgroundRepeat: "no-repeat",
            }}
            className={cn(
              "h-3.5 w-24 min-w-0 touch-none cursor-pointer appearance-none bg-transparent outline-none md:w-28",
              "[&::-webkit-slider-runnable-track]:h-3.5 [&::-webkit-slider-runnable-track]:bg-transparent",
              "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-[var(--color-ink)] [&::-webkit-slider-thumb]:transition-shadow",
              "[&:hover::-webkit-slider-thumb]:shadow-[0_0_0_5px_rgba(73,53,240,0.22)] [&:focus-visible::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-accent)]",
              "[&::-moz-range-track]:h-[3px] [&::-moz-range-track]:bg-transparent",
              "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--color-ink)]"
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
            onClick={() => setRampOpen((prev) => !prev)}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 text-ink-muted transition-colors hover:text-ink",
              rampOpen ? "bg-ink/10 text-ink" : "bg-transparent"
            )}
          >
            <Spline className="size-4" strokeWidth={2} aria-hidden />
          </button>

          {rampOpen && (
            <div
              className="absolute bottom-full right-0 z-40 mb-2 w-72 touch-none rounded-xl border border-ink/15 bg-surface-card px-4 py-3 text-ink shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
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

        {/* Direction toggle, same popover mechanics as Speed Ramp: each Cell rolls
            one of Up / Down / Left / Right for its Live Play scroll via the same
            base-100 weighted bucket logic as Effects and Smears (`chooseDirection`
            in the effect worker). Default Down:100 preserves the pre-existing
            all-down scroll exactly. */}
        <div className="relative" ref={directionContainerRef}>
          <button
            type="button"
            aria-label={directionOpen ? "Close direction editor" : "Open direction editor"}
            aria-expanded={directionOpen}
            onClick={() => setDirectionOpen((prev) => !prev)}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 text-ink-muted transition-colors hover:text-ink",
              directionOpen ? "bg-ink/10 text-ink" : "bg-transparent"
            )}
          >
            <Move className="size-4" strokeWidth={2} aria-hidden />
          </button>

          {directionOpen && (
            <div
              className="absolute bottom-full right-0 z-40 mb-2 w-64 touch-none rounded-xl border border-ink/15 bg-surface-card px-4 py-3 text-ink shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
              style={{ touchAction: "none" }}
              onPointerDown={preventTouchScroll}
            >
              <span className="font-heading text-xs font-medium uppercase tracking-[0.12em] text-ink">
                Direction
              </span>
              <div className="mt-3 flex flex-col gap-3">
                <ToolbarSlider
                  id="direction-up"
                  label="Up"
                  value={directionWeights.up}
                  onChange={(value) =>
                    setDirectionWeights((prev) => ({ ...prev, up: value }))
                  }
                />
                <ToolbarSlider
                  id="direction-down"
                  label="Down"
                  value={directionWeights.down}
                  onChange={(value) =>
                    setDirectionWeights((prev) => ({ ...prev, down: value }))
                  }
                />
                <ToolbarSlider
                  id="direction-left"
                  label="Left"
                  value={directionWeights.left}
                  onChange={(value) =>
                    setDirectionWeights((prev) => ({ ...prev, left: value }))
                  }
                />
                <ToolbarSlider
                  id="direction-right"
                  label="Right"
                  value={directionWeights.right}
                  onChange={(value) =>
                    setDirectionWeights((prev) => ({ ...prev, right: value }))
                  }
                />
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      <div
        className={cn(
          "flex w-full flex-wrap items-center justify-center gap-1.5 transition-opacity duration-300 lg:gap-3",
          previewing && "invisible"
        )}
        inert={previewing ? true : undefined}
      >
          <EqualToolbarButton
            type="button"
            tone="solid"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.value = ""
                fileInputRef.current.click()
              }
            }}
            icon={<Folder className="size-3.5" strokeWidth={2} aria-hidden />}
            label="Load"
          />
          <EqualToolbarButton
            type="button"
            tone="solid"
            disabled={!imageSrc || isBaking}
            onClick={handleBakeClick}
            icon={<Sparkles className="size-3.5" strokeWidth={2} aria-hidden />}
            label="Bake"
          />
          <EqualToolbarButton
            type="button"
            tone="solid"
            disabled={!imageSrc}
            onClick={resetGenerationParameters}
            icon={<RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />}
            label="Reset"
          />
          <EqualToolbarButton
            type="button"
            tone="solid"
            disabled={!imageSrc}
            onClick={handleCapture}
            icon={<Camera className="size-3.5" strokeWidth={2} aria-hidden />}
            label="Capture"
          />
          <EqualToolbarButton
            tone="solid"
            disabled={!imageSrc || isExportingPng}
            onClick={exportHighResImage}
            icon={<Download className="size-3.5" strokeWidth={2} aria-hidden />}
            label="Save"
          />
      </div>
    </div>
  )
}
