"use client"

import type { Dispatch, SetStateAction } from "react"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { CONTROL_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, floatingCard, sectionTitle, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"

type NoiseMaskSectionProps = {
  showNoiseMap: boolean
  handleShowNoiseMapChange: (checked: boolean) => void
  noiseScale: number
  setNoiseScale: Dispatch<SetStateAction<number>>
  noiseSpread: number
  setNoiseSpread: Dispatch<SetStateAction<number>>
}

/**
 * Noise Mask: which Cells switch ON, plus the mask debug overlay.
 */
export function NoiseMaskSection({
  showNoiseMap,
  handleShowNoiseMapChange,
  noiseScale,
  setNoiseScale,
  noiseSpread,
  setNoiseSpread,
}: NoiseMaskSectionProps) {
  return (
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
  )
}
