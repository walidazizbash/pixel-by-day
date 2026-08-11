"use client"

import { Plus } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type CollapsibleCalloutProps = {
  title: string
  className?: string
  titleClassName?: string
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleCallout({
  title,
  className,
  titleClassName,
  defaultOpen = false,
  children,
}: CollapsibleCalloutProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Card className={cn(className, "gap-0 overflow-visible p-0 ring-0")}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        className="flex h-10 w-full items-center justify-between overflow-hidden rounded-t-2xl border-b border-white/5 bg-slate-800/50 px-4"
      >
        <span className={cn("block", titleClassName)}>{title}</span>
        <Plus
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-slate-400 transition-transform duration-200",
            open && "rotate-45"
          )}
          strokeWidth={2}
        />
      </button>
      {open && (
        <CardContent className="flex flex-col gap-5 overflow-visible px-6 pb-6 pt-4">
          {children}
        </CardContent>
      )}
    </Card>
  )
}
