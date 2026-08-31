"use client"

import { RotateCcw } from "lucide-react"

/** The small circular-arrow button beside a slider that returns it to its default. */
export function ResetAmountButton({
  label,
  defaultValue,
  onReset,
}: {
  label: string
  defaultValue: number
  onReset: () => void
}) {
  return (
    <button
      type="button"
      aria-label={`Reset ${label} to ${defaultValue}`}
      title="Reset to default"
      onClick={onReset}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
    >
      <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
    </button>
  )
}
