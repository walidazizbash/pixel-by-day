"use client"

import type { Dispatch, SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { toolbarActionButton } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

type BakeDialogProps = {
  bakeConfirmOpen: boolean
  setBakeConfirmOpen: Dispatch<SetStateAction<boolean>>
  isBaking: boolean
  confirmBake: () => Promise<void>
}

/**
 * Confirmation for Bake, which swaps the current output in as the new source image.
 */
export function BakeDialog({
  bakeConfirmOpen,
  setBakeConfirmOpen,
  isBaking,
  confirmBake,
}: BakeDialogProps) {
  // Rendering nothing when closed keeps the mount/unmount behaviour the inline
  // {bakeConfirmOpen && ...} had at the call site.
  if (!bakeConfirmOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Dismiss dialog"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => {
          if (!isBaking) setBakeConfirmOpen(false)
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bake-confirm-title"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-[#f5f5f7] shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl"
      >
        <p
          id="bake-confirm-title"
          className="text-center font-body text-sm leading-relaxed text-slate-200"
        >
          This will replace your original image
          <br />
          and reset all parameters.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-2xl border-white/10 bg-transparent px-4 text-xs font-semibold text-slate-300 shadow-none hover:bg-white/5 hover:text-slate-100"
            disabled={isBaking}
            onClick={() => setBakeConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn(toolbarActionButton, "h-8 px-4")}
            disabled={isBaking}
            onClick={() => {
              void confirmBake()
            }}
          >
            {isBaking ? "Working…" : "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  )
}
