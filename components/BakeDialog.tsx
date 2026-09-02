"use client"

import { useEffect, useId, useRef, type Dispatch, type SetStateAction } from "react"
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
 * Confirmation for Bake, which swaps the current output as the new source image.
 * Focus is trapped inside the dialog while open; Tab cycles Cancel ↔ Confirm.
 */
export function BakeDialog({
  bakeConfirmOpen,
  setBakeConfirmOpen,
  isBaking,
  confirmBake,
}: BakeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!bakeConfirmOpen) return

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const root = dialogRef.current
    if (!root) return

    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1)

    const initial = focusables()
    if (initial[0]) {
      initial[0].focus()
    } else {
      // Both actions may be disabled (e.g. mid-bake) — park focus on the dialog
      // itself so Tab cannot wander into the page behind aria-modal.
      root.focus()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return
      // Re-query each keypress so `disabled={isBaking}` is seen without
      // rebinding this effect (rebinding would restore page focus mid-bake).
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        root?.focus()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !root?.contains(active)) {
          event.preventDefault()
          last.focus()
        }
        return
      }
      if (active === last || !root?.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      previouslyFocusedRef.current?.focus?.()
      previouslyFocusedRef.current = null
    }
  }, [bakeConfirmOpen])

  // When Confirm disables both buttons mid-dialog, move focus onto the dialog
  // root so it isn't left on a now-disabled control (or pushed outside).
  useEffect(() => {
    if (!bakeConfirmOpen || !isBaking) return
    dialogRef.current?.focus()
  }, [bakeConfirmOpen, isBaking])

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
        tabIndex={-1}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => {
          if (!isBaking) setBakeConfirmOpen(false)
        }}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-[#f5f5f7] shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl outline-none"
      >
        <p
          id={titleId}
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
