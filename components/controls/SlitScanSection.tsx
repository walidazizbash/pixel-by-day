"use client"

import type { Dispatch, SetStateAction } from "react"
import { memo } from "react"
import type { SlitScanMode } from "@/lib/effect-types"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { CONTROL_DEFAULTS, SLIT_SCAN_MODES, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, helperText, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

type SlitScanSectionProps = {
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
 * Slit Scan: master switch, displacement mode, luminance mask, and its three sliders.
 * Rendered inside BaseEffectsSection, where the rest of the effect weights live.
 */
export const SlitScanSection = memo(function SlitScanSection({
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
}: SlitScanSectionProps) {
  return (
    <div className="border-y border-white/5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <label htmlFor="slit-scan-enabled" className={controlLabel}>
            Slit Scan
          </label>
        </div>
        <Switch
          id="slit-scan-enabled"
          checked={slitScanEnabled}
          onCheckedChange={setSlitScanEnabled}
        />
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          slitScanEnabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div
          className="min-h-0 overflow-hidden"
          aria-hidden={!slitScanEnabled}
          inert={!slitScanEnabled ? true : undefined}
        >

          <div className="flex flex-col gap-3 pt-3">

            <div className={controlField}>
              <span className={helperText}>Mode</span>
              <div
                role="group"
                aria-label="Slit Scan mode"
                className="grid w-full grid-cols-3 rounded-lg border border-white/10 bg-slate-950/40 p-0.5"
              >
                {SLIT_SCAN_MODES.map((option) => {
                  const active = slitScanMode === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      aria-label={option.title}
                      title={option.title}
                      onClick={() => setSlitScanMode(option.id)}
                      className={cn(
                        "rounded-md px-1.5 py-1 text-xs font-medium transition-colors",
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
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="slit-scan-luminance-mask"
                className={helperText}
              >
                Luminance Mask
              </label>
              <Switch
                id="slit-scan-luminance-mask"
                checked={slitScanLuminanceMask}
                onCheckedChange={setSlitScanLuminanceMask}
              />
            </div>
            <div className={controlField}>
              <span className={helperText}>Weight</span>
              <div className={sliderRow}>
                <Slider
                  id="weight-slit-scan"
                  aria-label="Slit Scan weight"
                  className={sliderTrackClass}
                  value={[weightSlitScan]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setWeightSlitScan(
                      sliderValue(
                        value,
                        CONTROL_DEFAULTS.weightSlitScan
                      )
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span
                    className={sliderValueReadout}
                    aria-hidden="true"
                  >
                    {weightSlitScan}
                  </span>
                  <ResetAmountButton
                    label="Slit Scan weight"
                    defaultValue={CONTROL_DEFAULTS.weightSlitScan}
                    onReset={() =>
                      setWeightSlitScan(
                        CONTROL_DEFAULTS.weightSlitScan
                      )
                    }
                  />
                </div>
              </div>
            </div>
            <div className={controlField}>
              <span className={helperText}>Amount</span>
              <div className={sliderRow}>
                <Slider
                  id="slit-scan-amount"
                  aria-label="Slit Scan amount"
                  className={sliderTrackClass}
                  value={[slitScanAmount]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setSlitScanAmount(
                      sliderValue(
                        value,
                        CONTROL_DEFAULTS.slitScanAmount
                      )
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span
                    className={sliderValueReadout}
                    aria-hidden="true"
                  >
                    {slitScanAmount}
                  </span>
                  <ResetAmountButton
                    label="Slit Scan amount"
                    defaultValue={CONTROL_DEFAULTS.slitScanAmount}
                    onReset={() =>
                      setSlitScanAmount(
                        CONTROL_DEFAULTS.slitScanAmount
                      )
                    }
                  />
                </div>
              </div>
            </div>
            <div className={controlField}>
              <span className={helperText}>Frequency</span>
              <div className={sliderRow}>
                <Slider
                  id="slit-scan-frequency"
                  aria-label="Slit Scan frequency"
                  className={sliderTrackClass}
                  value={[slitScanFrequency]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) =>
                    setSlitScanFrequency(
                      sliderValue(
                        value,
                        CONTROL_DEFAULTS.slitScanFrequency
                      )
                    )
                  }
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <span
                    className={sliderValueReadout}
                    aria-hidden="true"
                  >
                    {slitScanFrequency}
                  </span>
                  <ResetAmountButton
                    label="Slit Scan frequency"
                    defaultValue={CONTROL_DEFAULTS.slitScanFrequency}
                    onReset={() =>
                      setSlitScanFrequency(
                        CONTROL_DEFAULTS.slitScanFrequency
                      )
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
