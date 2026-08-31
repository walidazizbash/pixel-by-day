"use client"

import type { Dispatch, SetStateAction } from "react"
import { memo } from "react"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { CONTROL_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, floatingCard, sectionTitle, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"

type PostProcessingSectionProps = {
  textureEnabled: boolean
  setTextureEnabled: Dispatch<SetStateAction<boolean>>
  textureOpacity: number
  setTextureOpacity: Dispatch<SetStateAction<number>>
}

/**
 * Post-Process: the Phase 3 grain pass, which runs in its own worker.
 */
export const PostProcessingSection = memo(function PostProcessingSection({
  textureEnabled,
  setTextureEnabled,
  textureOpacity,
  setTextureOpacity,
}: PostProcessingSectionProps) {
  return (
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
  )
})
