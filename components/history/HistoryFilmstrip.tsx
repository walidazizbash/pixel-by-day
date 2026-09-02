"use client"

import type { RefObject } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from "lucide-react"
import type { HistorySnapshot } from "@/components/history/types"

/** Pixels the History column scrolls per chevron press. */
const HISTORY_SCROLL_STEP = 200

type HistoryFilmstripProps = {
  visualHistory: HistorySnapshot[]
  historyScrollRef: RefObject<HTMLDivElement | null>
  scrollHistory: (delta: number) => void
  openPreview: (snapshot: HistorySnapshot) => void
  handleDeleteHistory: (id: string, event: React.MouseEvent) => void
  handleClearAllHistory: () => void
}

/**
 * The History rail: captured snapshots as thumbnails, with scroll chevrons, a delete
 * button per item, click-to-preview, and Clear All to free every capture at once.
 * The preview image itself renders over the canvas in CanvasViewport, so it lands
 * on exactly the canvas footprint.
 */
export function HistoryFilmstrip({
  visualHistory,
  historyScrollRef,
  scrollHistory,
  openPreview,
  handleDeleteHistory,
  handleClearAllHistory,
}: HistoryFilmstripProps) {
  return (
    <aside
      aria-label="Saved results"
      className="flex w-full shrink-0 flex-row items-center gap-2 px-3 py-2 lg:h-full lg:w-28 lg:flex-col lg:px-0 lg:py-3 lg:pl-1 lg:pr-3"
    >
      <button
        type="button"
        aria-label="Scroll history backward"
        onClick={() => scrollHistory(-HISTORY_SCROLL_STEP)}
        className="flex shrink-0 cursor-pointer items-center justify-center p-1 text-gray-300 hover:text-white lg:w-full"
      >
        <ChevronLeft className="h-4 w-4 lg:hidden" />
        <ChevronUp className="hidden h-4 w-4 lg:block" />
      </button>
      <div
        ref={historyScrollRef}
        className="hide-scrollbar flex min-h-0 w-full flex-1 flex-row items-center gap-2 overflow-x-auto pt-1.5 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pt-0"
      >
        {visualHistory.map((snapshot) => (
            <div
              key={snapshot.id}
              className="group relative flex shrink-0 items-center rounded-lg lg:gap-2"
            >
              <button
                type="button"
                aria-label="Preview this saved result"
                title="Preview this saved result"
                onClick={() => openPreview(snapshot)}
                className="aspect-square w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/10 transition-colors hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small local data URL thumbnail, not an optimizable remote asset */}
                <img
                  src={snapshot.thumbnail}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
                />
              </button>
              <button
                type="button"
                aria-label="Delete this saved result"
                title="Delete"
                onClick={(event) => handleDeleteHistory(snapshot.id, event)}
                className="absolute -top-1.5 -right-1.5 z-10 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-red-700 text-white shadow-sm hover:bg-red-800 lg:static lg:top-auto lg:right-auto lg:z-auto"
              >
                <X className="size-4" />
              </button>
            </div>
        ))}
      </div>
      <button
        type="button"
        aria-label="Scroll history forward"
        onClick={() => scrollHistory(HISTORY_SCROLL_STEP)}
        className="flex shrink-0 cursor-pointer items-center justify-center p-1 text-gray-300 hover:text-white lg:w-full"
      >
        <ChevronRight className="h-4 w-4 lg:hidden" />
        <ChevronDown className="hidden h-4 w-4 lg:block" />
      </button>
      <button
        type="button"
        aria-label="Clear all saved results"
        title="Clear all saved results and free memory"
        onClick={handleClearAllHistory}
        className="shrink-0 px-1.5 py-1 font-footer text-[10px] uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-200 lg:w-full lg:px-0 lg:pt-1"
      >
        Clear all
      </button>
    </aside>
  )
}
