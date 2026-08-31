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
 * Cell Pattern: the Phase 1 layout controls plus the debug overlay switch.
 */
export const LayoutSection = memo(function LayoutSection({
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
  )
})
