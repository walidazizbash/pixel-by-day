"use client"

import { useState, type ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

function CollapseChevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      fill="currentColor"
      className={cn(
        "size-3 shrink-0 text-slate-400 transition-transform duration-200",
        open && "rotate-180"
      )}
    >
      <path d="M2 4.5 6 9 10 4.5z" />
    </svg>
  )
}

type CollapsibleCalloutProps = {
  title: string
  className?: string
  titleClassName?: string
  defaultOpen?: boolean
  enabled?: boolean
  enabledLabel?: string
  children: ReactNode
}

export function CollapsibleCallout({
  title,
  className,
  titleClassName,
  defaultOpen = false,
  enabled = false,
  enabledLabel = "Enabled",
  children,
}: CollapsibleCalloutProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Card
      data-state={open ? "open" : "collapsed"}
      className={cn(
        className,
        "gap-0 p-0 ring-0",
        open ? "overflow-visible" : "overflow-hidden"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={
          open
            ? `Collapse ${title}${enabled ? ` (${enabledLabel.toLowerCase()})` : ""}`
            : `Expand ${title}${enabled ? ` (${enabledLabel.toLowerCase()})` : ""}`
        }
        className={cn(
          "group relative flex h-10 w-full items-center justify-between bg-slate-800/50 px-4 font-heading",
          open
            ? "rounded-t-2xl border-b border-white/5"
            : "rounded-2xl border-b border-transparent"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden",
            open ? "rounded-t-2xl" : "rounded-2xl"
          )}
        >
          <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(226,240,255,0.62)_0%,rgba(186,214,245,0.52)_10%,rgba(148,180,220,0.4)_25%,rgba(125,160,210,0.28)_45%,rgba(100,116,139,0.16)_70%,rgba(71,85,105,0.08)_100%)] opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100" />
        </span>
        <span className={cn("relative z-10 block truncate pr-28", titleClassName)}>
          {title}
        </span>
        <span className="absolute top-1/2 right-4 z-10 flex -translate-y-1/2 items-center gap-3">
          {enabled && (
            <span className="text-[10px] font-normal uppercase leading-none tracking-[0.16em] text-sky-700">
              {enabledLabel}
            </span>
          )}
          <CollapseChevron open={open} />
        </span>
      </button>
      {open && (
        <CardContent className="flex flex-col gap-5 overflow-visible px-6 pb-6 pt-4">
          {children}
        </CardContent>
      )}
    </Card>
  )
}
