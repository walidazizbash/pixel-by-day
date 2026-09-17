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
        "size-3 shrink-0 text-ink-muted transition-transform duration-200",
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
          "group relative flex h-11 w-full items-center justify-between bg-surface-strong px-5 font-heading transition-colors hover:bg-ink/5",
          open
            ? "rounded-t-xl border-b border-ink/5"
            : "rounded-xl border-b border-transparent"
        )}
      >
        <span className={cn("relative z-10 block truncate pr-28", titleClassName)}>
          {title}
        </span>
        <span className="absolute top-1/2 right-5 z-10 flex -translate-y-1/2 items-center gap-3">
          {enabled && (
            <span className="text-[10px] font-normal uppercase leading-none tracking-[0.16em] text-accent-strong">
              {enabledLabel}
            </span>
          )}
          <CollapseChevron open={open} />
        </span>
      </button>
      {open && (
        <CardContent className="flex flex-col gap-6 overflow-visible px-6 pb-7 pt-5">
          {children}
        </CardContent>
      )}
    </Card>
  )
}
