"use client"

import type { Dispatch, SetStateAction } from "react"
import { memo } from "react"
import { Slider } from "@/components/ui/slider"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { CONTROL_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, floatingCard, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

type RepeatSectionProps = {
  passes: number
  passesDrag: number | null
  rate: number
  setPasses: Dispatch<SetStateAction<number>>
  setPassesDrag: Dispatch<SetStateAction<number | null>>
  setRate: Dispatch<SetStateAction<number>>
}

/**
 * Repeat pass count and per-pass decay. Lives above the collapsible sections.
 */
export const RepeatSection = memo(function RepeatSection({
  passes,
  passesDrag,
  rate,
  setPasses,
  setPassesDrag,
  setRate,
}: RepeatSectionProps) {
  return (
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
  )
})
