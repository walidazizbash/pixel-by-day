"use client"

import type { Dispatch, RefObject, SetStateAction } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { EffectSettings } from "@/lib/effect-types"
import { Button } from "@/components/ui/button"
import { toolbarActionButton } from "@/components/controls/styles"
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
}

/**
 * The action bar under the canvas: Seed, Random with its undo/redo arrows, Upload,
 * Save, Bake, Reset and Capture — plus the Restore/Cancel pair that covers them all
 * while a History snapshot is being previewed.
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
}: HeaderControlsProps) {
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
