"use client"

import type { Dispatch, SetStateAction } from "react"
import { memo } from "react"
import type { SubdivisionMode } from "@/lib/effect-types"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { CONTROL_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, floatingCard, sectionTitle, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

type LayoutSectionProps = {
  passes: number
  passesDrag: number | null
  rate: number
  setPasses: Dispatch<SetStateAction<number>>
  setPassesDrag: Dispatch<SetStateAction<number | null>>
  setRate: Dispatch<SetStateAction<number>>
  showCellLayout: boolean
  handleShowCellLayoutChange: (checked: boolean) => void
  subdivisionLoops: number
  setSubdivisionLoops: Dispatch<SetStateAction<number>>
  subdivisionMode: SubdivisionMode
  setSubdivisionMode: Dispatch<SetStateAction<SubdivisionMode>>
  subdivisionRate: number
  setSubdivisionRate: Dispatch<SetStateAction<number>>
}

/**
 * Pattern: Repeat pass count/decay plus the Phase 1 layout controls and the
 * debug overlay switch. Repeat lived in its own top-level card before this
 * redesign; merged here purely as a presentation/grouping change — no state
 * moved, no behavior changed.
 */
export const LayoutSection = memo(function LayoutSection({
  passes,
  passesDrag,
  rate,
  setPasses,
  setPassesDrag,
  setRate,
  showCellLayout,
  handleShowCellLayoutChange,
  subdivisionLoops,
  setSubdivisionLoops,
  subdivisionMode,
  setSubdivisionMode,
  subdivisionRate,
  setSubdivisionRate,
}: LayoutSectionProps) {
  return (
    <CollapsibleCallout
      title="Pattern"
      className={floatingCard}
      titleClassName={sectionTitle}
      enabled={showCellLayout}
      enabledLabel="Visualizing"
    >
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
                setPasses(Math.max(1, Math.min(3, Math.round(raw))))
              }}
              onValueCommitted={(value) => {
                const raw = sliderValue(value, CONTROL_DEFAULTS.passes)
                setPasses(Math.max(1, Math.min(3, Math.round(raw))))
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
                    "absolute top-0 h-1.5 w-px -translate-y-1/2 bg-ink/25",
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
          className="inline-flex rounded-lg border border-ink/15 bg-surface-strong p-0.5"
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
                  active ? "bg-accent text-ink" : "text-ink hover:bg-ink/10"
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
  )
})
