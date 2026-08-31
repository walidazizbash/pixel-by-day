"use client"

import type { Dispatch, SetStateAction } from "react"
import type { SmearStyleSettings } from "@/lib/effect-types"
import { CollapsibleCallout } from "@/components/collapsible-callout"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ResetAmountButton } from "@/components/controls/ResetAmountButton"
import { SMEAR_AMOUNT_DEFAULTS, SMEAR_WEIGHT_DEFAULTS, sliderValue } from "@/components/controls/defaults"
import { controlField, controlLabel, floatingCard, helperText, sectionTitle, sliderRow, sliderTrackClass, sliderValueReadout } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

type SmearsSectionProps = {
  smearVertical: SmearStyleSettings
  setSmearVertical: Dispatch<SetStateAction<SmearStyleSettings>>
  smearHorizontal: SmearStyleSettings
  setSmearHorizontal: Dispatch<SetStateAction<SmearStyleSettings>>
  smearDiagonal1: SmearStyleSettings
  setSmearDiagonal1: Dispatch<SetStateAction<SmearStyleSettings>>
  smearDiagonal2: SmearStyleSettings
  setSmearDiagonal2: Dispatch<SetStateAction<SmearStyleSettings>>
  smearRecursive: SmearStyleSettings
  setSmearRecursive: Dispatch<SetStateAction<SmearStyleSettings>>
  verticalWeight: number
  setVerticalWeight: Dispatch<SetStateAction<number>>
  horizontalWeight: number
  setHorizontalWeight: Dispatch<SetStateAction<number>>
  diagonal1Weight: number
  setDiagonal1Weight: Dispatch<SetStateAction<number>>
  diagonal2Weight: number
  setDiagonal2Weight: Dispatch<SetStateAction<number>>
  recursiveWeight: number
  setRecursiveWeight: Dispatch<SetStateAction<number>>
}

/**
 * Smear: the five directional styles, their signed amounts and their coverage weights.
 */
export function SmearsSection({
  smearVertical,
  setSmearVertical,
  smearHorizontal,
  setSmearHorizontal,
  smearDiagonal1,
  setSmearDiagonal1,
  smearDiagonal2,
  setSmearDiagonal2,
  smearRecursive,
  setSmearRecursive,
  verticalWeight,
  setVerticalWeight,
  horizontalWeight,
  setHorizontalWeight,
  diagonal1Weight,
  setDiagonal1Weight,
  diagonal2Weight,
  setDiagonal2Weight,
  recursiveWeight,
  setRecursiveWeight,
}: SmearsSectionProps) {
  return (
    <CollapsibleCallout
      title="Smear"
      className={floatingCard}
      titleClassName={sectionTitle}
      enabled={
        smearVertical.enabled ||
        smearHorizontal.enabled ||
        smearDiagonal1.enabled ||
        smearDiagonal2.enabled ||
        smearRecursive.enabled
      }
    >
      {(
        [
          {
            id: "vertical",
            label: "Vertical",
            value: smearVertical,
            set: setSmearVertical,
            defaultAmount: SMEAR_AMOUNT_DEFAULTS.vertical,
            minAmount: -100,
            maxAmount: 100,
            weight: verticalWeight,
            setWeight: setVerticalWeight,
            defaultWeight: SMEAR_WEIGHT_DEFAULTS.vertical,
          },
          {
            id: "horizontal",
            label: "Horizontal",
            value: smearHorizontal,
            set: setSmearHorizontal,
            defaultAmount: SMEAR_AMOUNT_DEFAULTS.horizontal,
            minAmount: -100,
            maxAmount: 100,
            weight: horizontalWeight,
            setWeight: setHorizontalWeight,
            defaultWeight: SMEAR_WEIGHT_DEFAULTS.horizontal,
          },
          {
            id: "diagonal2",
            label: "Diagonal Up",
            value: smearDiagonal2,
            set: setSmearDiagonal2,
            defaultAmount: SMEAR_AMOUNT_DEFAULTS.diagonal2,
            minAmount: -100,
            maxAmount: 100,
            weight: diagonal2Weight,
            setWeight: setDiagonal2Weight,
            defaultWeight: SMEAR_WEIGHT_DEFAULTS.diagonal2,
          },
          {
            id: "diagonal1",
            label: "Diagonal Down",
            value: smearDiagonal1,
            set: setSmearDiagonal1,
            defaultAmount: SMEAR_AMOUNT_DEFAULTS.diagonal1,
            minAmount: -100,
            maxAmount: 100,
            weight: diagonal1Weight,
            setWeight: setDiagonal1Weight,
            defaultWeight: SMEAR_WEIGHT_DEFAULTS.diagonal1,
          },
          {
            id: "recursive",
            label: "Recursive",
            value: smearRecursive,
            set: setSmearRecursive,
            defaultAmount: SMEAR_AMOUNT_DEFAULTS.recursive,
            minAmount: 0,
            maxAmount: 100,
            weight: recursiveWeight,
            setWeight: setRecursiveWeight,
            defaultWeight: SMEAR_WEIGHT_DEFAULTS.recursive,
          },
        ] as const
      ).map((style) => (
        <div
          key={style.id}
          className="border-b border-white/5 pb-4 last:border-b-0 last:pb-0"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`smear-${style.id}`} className={controlLabel}>
                {style.label}
              </label>
            </div>
            <Switch
              id={`smear-${style.id}`}
              checked={style.value.enabled}
              onCheckedChange={(checked) =>
                style.set({ ...style.value, enabled: checked })
              }
            />
          </div>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out",
              style.value.enabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            )}
          >
            <div
              className="min-h-0 overflow-hidden"
              aria-hidden={!style.value.enabled}
              inert={!style.value.enabled ? true : undefined}
            >
              <div className="flex flex-col gap-3 pt-3">
                <div className={controlField}>
                  <span className={helperText}>Amount</span>
                  <div className={sliderRow}>
                    <div
                      className={cn(
                        sliderTrackClass,
                        "relative",
                        style.minAmount < 0 && "pb-3"
                      )}
                    >
                      <Slider
                        id={`smear-${style.id}-amount`}
                        aria-label={`${style.label} amount`}
                        className="relative z-10 w-full min-w-0"
                        value={[style.value.amount]}
                        min={style.minAmount}
                        max={style.maxAmount}
                        step={1}
                        onValueChange={(value) =>
                          style.set({
                            ...style.value,
                            amount: sliderValue(
                              value,
                              style.defaultAmount
                            ),
                          })
                        }
                      />
                      {style.minAmount < 0 ? (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 top-[7px] z-0 h-0"
                        >
                          <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-400" />
                          <span className="absolute left-1/2 top-[8px] -translate-x-1/2 font-footer text-[10px] leading-none tabular-nums text-slate-400">
                            0
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span
                        className={sliderValueReadout}
                        aria-hidden="true"
                      >
                        {style.value.amount}
                      </span>
                      <ResetAmountButton
                        label={`${style.label} amount`}
                        defaultValue={style.defaultAmount}
                        onReset={() =>
                          style.set({
                            ...style.value,
                            amount: style.defaultAmount,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className={controlField}>
                  <span className={helperText}>
                    {style.id === "recursive" ? "Coverage" : "Weight"}
                  </span>
                  <div className={sliderRow}>
                    <Slider
                      id={`smear-${style.id}-weight`}
                      aria-label={`${style.label} ${style.id === "recursive" ? "coverage" : "weight"}`}
                      className={sliderTrackClass}
                      value={[style.weight]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(value) =>
                        style.setWeight(
                          sliderValue(value, style.defaultWeight)
                        )
                      }
                    />
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span
                        className={sliderValueReadout}
                        aria-hidden="true"
                      >
                        {style.weight}
                      </span>
                      <ResetAmountButton
                        label={`${style.label} ${style.id === "recursive" ? "coverage" : "weight"}`}
                        defaultValue={style.defaultWeight}
                        onReset={() =>
                          style.setWeight(style.defaultWeight)
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </CollapsibleCallout>
  )
}
