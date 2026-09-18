"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react"
import { createPortal } from "react-dom"
import { Contrast, Spline } from "lucide-react"
import type { SlitScanMode, SpeedRampPoint } from "@/lib/effect-types"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { SlitScanSection } from "@/components/controls/SlitScanSection"
import {
  SpeedRampCurve,
  type RampAxisLabels,
} from "@/components/controls/SpeedRampCurve"
import { CONTROL_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import {
  DEFAULT_DITHER_RAMP,
  DEFAULT_HALFTONE_RAMP,
  DEFAULT_INVERT_RAMP,
  DITHER_RAMP_Y_MAX,
  DITHER_RAMP_Y_MIN,
  DITHER_RAMP_Y_NEUTRAL,
  INVERT_RAMP_Y_MAX,
  INVERT_RAMP_Y_MIN,
  INVERT_RAMP_Y_NEUTRAL,
} from "@/lib/dither-ramp"
import { controlField, controlLabel, floatingCard, sectionTitle, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

function preventTouchScroll(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") event.preventDefault()
}

function InvertYMark({ filled }: { filled: boolean }) {
  return (
    <span
      className={cn(
        "block size-2.5 rounded-full border-[1.5px] border-current",
        filled ? "bg-current" : "bg-transparent"
      )}
    />
  )
}

function TextureRampButton({
  title,
  hint,
  ramp,
  setRamp,
  defaultRamp,
  icon,
  labels,
  yMin,
  yMax,
  baselineY,
}: {
  title: string
  hint: string
  ramp: SpeedRampPoint[]
  setRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  defaultRamp: readonly SpeedRampPoint[]
  icon: ReactNode
  labels: RampAxisLabels
  yMin: number
  yMax: number
  baselineY: number | false
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const width = 288
    const gap = 8
    const margin = 8
    // Same breakpoint as the page layout (`lg` / 1024px): desktop rail sits
    // on the right, so the graph opens to the left of the button. Below that
    // the controls are full-width — center the panel in the viewport.
    const desktop = window.innerWidth >= 1024
    const left = desktop
      ? Math.max(margin, r.left - width - gap)
      : Math.max(
          margin,
          Math.min(
            (window.innerWidth - width) / 2,
            window.innerWidth - width - margin
          )
        )
    // Fallback so the first paint is already vertically centered — the panel
    // is not in the DOM yet on the opening `place()` call (~195px measured).
    const height = panelRef.current?.offsetHeight || 195
    let top = r.top + r.height / 2 - height / 2
    top = Math.min(top, window.innerHeight - height - margin)
    top = Math.max(margin, top)
    setPos((prev) =>
      prev && prev.top === top && prev.left === left ? prev : { top, left }
    )
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open || !pos) return
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [open, pos, place])

  return (
    <div className="relative" ref={anchorRef}>
      <button
        type="button"
        aria-label={open ? `Close ${title} editor` : `Open ${title} editor`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 text-ink-muted transition-colors hover:text-ink",
          open ? "bg-ink/10 text-ink" : "bg-transparent"
        )}
      >
        {icon}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 w-72 touch-none rounded-xl border border-ink/15 bg-surface-card px-4 py-3 text-ink shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            style={{
              top: pos.top,
              left: pos.left,
              touchAction: "none",
            }}
            onPointerDown={preventTouchScroll}
          >
            <SpeedRampCurve
              title={title}
              speedRamp={ramp}
              setSpeedRamp={setRamp}
              yMin={yMin}
              yMax={yMax}
              defaultRamp={defaultRamp}
              baselineY={baselineY}
              ariaLabel={`${title} — ${hint}`}
              resetAriaLabel={`Reset ${title} to default curve`}
              labels={labels}
            />
          </div>,
          document.body
        )}
    </div>
  )
}

const INVERT_RAMP_LABELS: RampAxisLabels = {
  yTop: <InvertYMark filled={false} />,
  yBottom: <InvertYMark filled />,
  xCenter: "% of Cells",
}

type BaseEffectsSectionProps = {
  randomSample: boolean
  setRandomSample: Dispatch<SetStateAction<boolean>>
  weightDither: number
  setWeightDither: Dispatch<SetStateAction<number>>
  ditherRamp: SpeedRampPoint[]
  setDitherRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  ditherInvertRamp: SpeedRampPoint[]
  setDitherInvertRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  halftoneRamp: SpeedRampPoint[]
  setHalftoneRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  halftoneInvertRamp: SpeedRampPoint[]
  setHalftoneInvertRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  weightInvert: number
  setWeightInvert: Dispatch<SetStateAction<number>>
  weightSurreal: number
  setWeightSurreal: Dispatch<SetStateAction<number>>
  weightPixelate: number
  setWeightPixelate: Dispatch<SetStateAction<number>>
  halftoneAmount: number
  setHalftoneAmount: Dispatch<SetStateAction<number>>
  weightThermal: number
  setWeightThermal: Dispatch<SetStateAction<number>>
  weightOriginal: number
  setWeightOriginal: Dispatch<SetStateAction<number>>
  slitScanEnabled: boolean
  setSlitScanEnabled: Dispatch<SetStateAction<boolean>>
  slitScanMode: SlitScanMode
  setSlitScanMode: Dispatch<SetStateAction<SlitScanMode>>
  slitScanLuminanceMask: boolean
  setSlitScanLuminanceMask: Dispatch<SetStateAction<boolean>>
  weightSlitScan: number
  setWeightSlitScan: Dispatch<SetStateAction<number>>
  slitScanAmount: number
  setSlitScanAmount: Dispatch<SetStateAction<number>>
  slitScanFrequency: number
  setSlitScanFrequency: Dispatch<SetStateAction<number>>
}

/**
 * Effects: the per-Cell effect weights (Dither, Invert, Surreal, Pixelate, Halftone,
 * Thermal, Original) plus the Slit Scan sub-panel and the Random Sample switch.
 */
export const BaseEffectsSection = memo(function BaseEffectsSection({
  randomSample,
  setRandomSample,
  weightDither,
  setWeightDither,
  ditherRamp,
  setDitherRamp,
  ditherInvertRamp,
  setDitherInvertRamp,
  halftoneRamp,
  setHalftoneRamp,
  halftoneInvertRamp,
  setHalftoneInvertRamp,
  weightInvert,
  setWeightInvert,
  weightSurreal,
  setWeightSurreal,
  weightPixelate,
  setWeightPixelate,
  halftoneAmount,
  setHalftoneAmount,
  weightThermal,
  setWeightThermal,
  weightOriginal,
  setWeightOriginal,
  slitScanEnabled,
  setSlitScanEnabled,
  slitScanMode,
  setSlitScanMode,
  slitScanLuminanceMask,
  setSlitScanLuminanceMask,
  weightSlitScan,
  setWeightSlitScan,
  slitScanAmount,
  setSlitScanAmount,
  slitScanFrequency,
  setSlitScanFrequency,
}: BaseEffectsSectionProps) {
  return (
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
        halftoneAmount > 0 ||
        weightThermal > 0 ||
        slitScanEnabled
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
            <TextureRampButton
              title="Dither Scale"
              hint="shape how pattern size varies across Cells"
              ramp={ditherRamp}
              setRamp={setDitherRamp}
              defaultRamp={DEFAULT_DITHER_RAMP}
              icon={<Spline className="size-4" strokeWidth={2} aria-hidden />}
              yMin={DITHER_RAMP_Y_MIN}
              yMax={DITHER_RAMP_Y_MAX}
              baselineY={DITHER_RAMP_Y_NEUTRAL}
              labels={{
                yTop: "8x",
                yBottom: "1x",
                xCenter: "% of Cells",
              }}
            />
            <TextureRampButton
              title="Dither Invert"
              hint="shape how many Cells swap ink and paper"
              ramp={ditherInvertRamp}
              setRamp={setDitherInvertRamp}
              defaultRamp={DEFAULT_INVERT_RAMP}
              icon={<Contrast className="size-4" strokeWidth={2} aria-hidden />}
              yMin={INVERT_RAMP_Y_MIN}
              yMax={INVERT_RAMP_Y_MAX}
              baselineY={INVERT_RAMP_Y_NEUTRAL}
              labels={INVERT_RAMP_LABELS}
            />
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
            <TextureRampButton
              title="Halftone Scale"
              hint="shape how pattern size varies across Cells"
              ramp={halftoneRamp}
              setRamp={setHalftoneRamp}
              defaultRamp={DEFAULT_HALFTONE_RAMP}
              icon={<Spline className="size-4" strokeWidth={2} aria-hidden />}
              yMin={DITHER_RAMP_Y_MIN}
              yMax={DITHER_RAMP_Y_MAX}
              baselineY={DITHER_RAMP_Y_NEUTRAL}
              labels={{
                yTop: "6x",
                yBottom: "1x",
                xCenter: "% of Cells",
              }}
            />
            <TextureRampButton
              title="Halftone Invert"
              hint="shape how many Cells swap ink and paper"
              ramp={halftoneInvertRamp}
              setRamp={setHalftoneInvertRamp}
              defaultRamp={DEFAULT_INVERT_RAMP}
              icon={<Contrast className="size-4" strokeWidth={2} aria-hidden />}
              yMin={INVERT_RAMP_Y_MIN}
              yMax={INVERT_RAMP_Y_MAX}
              baselineY={INVERT_RAMP_Y_NEUTRAL}
              labels={INVERT_RAMP_LABELS}
            />
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
            <label htmlFor="weight-thermal" className={controlLabel}>
              Thermal
            </label>
          </div>
          <div className={sliderRow}>
            <Slider
              id="weight-thermal"
              aria-label="Thermal"
              className={sliderTrackClass}
              value={[weightThermal]}
              min={0}
              max={100}
              step={1}
              onValueChange={(value) =>
                setWeightThermal(
                  sliderValue(value, CONTROL_DEFAULTS.weightThermal)
                )
              }
            />
            <div className="flex shrink-0 items-center gap-0.5">
              <span className={sliderValueReadout} aria-hidden="true">
                {weightThermal}
              </span>
              <ResetAmountButton
                label="Thermal"
                defaultValue={CONTROL_DEFAULTS.weightThermal}
                onReset={() =>
                  setWeightThermal(CONTROL_DEFAULTS.weightThermal)
                }
              />
            </div>
          </div>
        </div>

        <SlitScanSection
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
  )
})
