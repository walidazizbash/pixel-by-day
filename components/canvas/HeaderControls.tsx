"use client"

import type { Dispatch, RefObject, SetStateAction } from "react"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import type { EffectSettings, LivePlayMode } from "@/lib/effect-types"
import { Button } from "@/components/ui/button"
import { LIVE_PLAY_SPEED } from "@/components/controls/defaults"
import {
  sliderValueReadout,
  toolbarActionButton,
} from "@/components/controls/styles"
import { cn } from "@/lib/utils"

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
  /** Live Play state — the animation toggle and which behavior it runs. */
  isPlaying: boolean
  togglePlaying: () => void
  livePlayMode: LivePlayMode
  setLivePlayMode: (mode: LivePlayMode) => void
  /** Pixels of scroll per rendered frame. */
  livePlaySpeed: number
  setLivePlaySpeed: (speed: number) => void
}

const LIVE_PLAY_MODES: Array<{
  value: LivePlayMode
  label: string
  title: string
}> = [
  {
    value: "fixed",
    label: "Fixed",
    title: "Fixed: the pixels scroll and the smear slides with them, seamlessly",
  },
  {
    value: "dynamic",
    label: "Dynamic",
    title: "Dynamic: the pixels scroll while the effects re-form every frame",
  },
]

/**
 * The action bar under the canvas: Seed, Random with its undo/redo arrows, Live Play
 * with its motion toggle and speed, Upload, Save, Bake, Reset and Capture — plus the
 * Restore/Cancel pair that covers them all while a History snapshot is previewed.
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
  livePlayMode,
  setLivePlayMode,
  livePlaySpeed,
  setLivePlaySpeed,
}: HeaderControlsProps) {
  /** Filled fraction of the speed track, mirroring the Slider's Indicator. */
  const speedPercent =
    ((livePlaySpeed - LIVE_PLAY_SPEED.min) /
      (LIVE_PLAY_SPEED.max - LIVE_PLAY_SPEED.min)) *
    100

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

        <button
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
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-35 md:px-3",
            isPlaying
              ? "bg-white/10 text-slate-100"
              : "bg-transparent text-slate-300 hover:text-slate-100"
          )}
        >
          {isPlaying ? (
            <Pause className="size-4" strokeWidth={2} />
          ) : (
            <Play className="size-4" strokeWidth={2} />
          )}
          {isPlaying ? "Pause" : "Play"}
        </button>

        {/* Segmented control: which motion Live Play runs. Switching repaints at
            the offset already on screen, so it swaps without jumping. */}
        <div
          role="group"
          aria-label="Live Play motion"
          className="flex h-8 shrink-0 items-center rounded-lg border border-white/10 p-0.5"
        >
          {LIVE_PLAY_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={livePlayMode === option.value}
              title={option.title}
              disabled={!imageSrc}
              onClick={() => setLivePlayMode(option.value)}
              className={cn(
                "inline-flex h-full items-center rounded-md px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-35",
                livePlayMode === option.value
                  ? "bg-white/10 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

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
          className="flex h-8 shrink-0 items-center gap-2.5 rounded-lg border border-white/10 px-3"
          title="Live Play speed — pixels of scroll per rendered frame"
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
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--color-slate-500), var(--color-slate-300), var(--color-slate-200))," +
                "linear-gradient(to right, color-mix(in oklab, var(--color-slate-700) 50%, transparent), color-mix(in oklab, var(--color-slate-700) 50%, transparent))",
              backgroundSize: `${speedPercent}% 3px, 100% 3px`,
              backgroundPosition: "left center",
              backgroundRepeat: "no-repeat",
            }}
            className={cn(
              "h-3.5 w-24 min-w-0 cursor-pointer appearance-none bg-transparent outline-none md:w-28",
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
      </div>

      <div
        className={cn(
          "hide-scrollbar flex w-full max-w-full flex-row flex-nowrap items-center justify-center-safe gap-1 overflow-x-auto transition-opacity duration-300 lg:max-w-none lg:gap-3 lg:overflow-visible lg:flex-wrap lg:justify-center",
          previewing && "invisible"
        )}
      >
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
            title="Zero effects and smears; restore Cell Pattern and Noise Mask defaults (keeps grain)"
            onClick={resetGenerationParameters}
          >
            Reset
          </Button>
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
  )
}
