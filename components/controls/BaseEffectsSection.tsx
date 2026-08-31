"use client"

import type { Dispatch, SetStateAction } from "react"
import type { SlitScanMode } from "@/lib/effect-types"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { SlitScanSection } from "@/components/controls/SlitScanSection"
import { CONTROL_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, floatingCard, sectionTitle, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"

type BaseEffectsSectionProps = {
  randomSample: boolean
  setRandomSample: Dispatch<SetStateAction<boolean>>
  weightDither: number
  setWeightDither: Dispatch<SetStateAction<number>>
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
export function BaseEffectsSection({
  randomSample,
  setRandomSample,
  weightDither,
  setWeightDither,
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
}
