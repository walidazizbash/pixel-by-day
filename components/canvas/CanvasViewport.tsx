"use client"

import type { DragEvent, RefObject } from "react"
import type { HistorySnapshot } from "@/components/history/types"
import { bodyText, canvasBoxClass, helperText } from "@/components/controls/styles"
import { cn } from "@/lib/utils"

type CanvasViewportProps = {
  imageSrc: string | null
  liveCanvasRef: RefObject<HTMLCanvasElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  handleDragOver: (event: DragEvent<HTMLElement>) => void
  handleDragEnter: (event: DragEvent<HTMLElement>) => void
  handleDragLeave: (event: DragEvent<HTMLElement>) => void
  handleDrop: (event: DragEvent<HTMLElement>) => void
  isDragging: boolean
  uploadError: string | null
  previewItem: HistorySnapshot | null
  cancelPreview: () => void
}

/**
 * The canvas stage: the live preview canvas, the empty-state dropzone, the upload
 * error banner, and the History preview image that covers the canvas while previewing.
 */
export function CanvasViewport({
  imageSrc,
  liveCanvasRef,
  fileInputRef,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  isDragging,
  uploadError,
  previewItem,
  cancelPreview,
}: CanvasViewportProps) {
  return (
    <div className="relative flex min-h-0 w-full flex-1 touch-manipulation items-center justify-center overflow-hidden p-2 text-slate-400 sm:p-4 md:p-6">
      {imageSrc ? (
        <div className={cn(canvasBoxClass, "touch-manipulation")}>
          {/* Fills the reserved box at every viewport size, so the first frame
              (and every later one) swaps the drawing buffer without resizing
              the element. `object-scale-down` letterboxes any aspect ratio and
              never upscales past 1:1. */}
          <canvas
            ref={liveCanvasRef}
            role="img"
            aria-label="Generated mosaic preview"
            className="block size-full object-scale-down touch-manipulation"
          />
        </div>
      ) : (
        <button
          type="button"
          aria-label="Upload image"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="absolute inset-0 z-0 flex touch-auto flex-col items-center justify-center gap-1.5 px-6 text-center"
        >
          <span className="pointer-events-none flex size-9 items-center justify-center rounded-lg border border-white/10 bg-transparent text-sm font-medium leading-none text-slate-300 sm:size-[4.5rem] sm:rounded-xl sm:text-2xl">
            +
          </span>
          <span className={cn("pointer-events-none", bodyText)}>
            {isDragging ? "Drop image here" : "Drag and drop an image"}
          </span>
          {!isDragging && (
            <span className={cn("pointer-events-none", helperText)}>
              or click to upload
            </span>
          )}
        </button>
      )}
      {uploadError && (
        <p
          role="alert"
          className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-red-500/40 bg-red-950/90 px-3 py-2 text-center text-xs leading-relaxed text-red-100 shadow-lg sm:inset-x-4 sm:bottom-4"
        >
          {uploadError}
        </p>
      )}
      {previewItem && (
        /* `inset-0` spans this pane's padding box, so repeating its padding here is
           what makes the preview land on exactly the canvas's box — not double-inset.
           Restore/Cancel live down in the toolbar, leaving the image full size here. */
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Saved result preview"
          className="absolute inset-0 z-40 flex items-center justify-center bg-[#08080a] p-2 sm:p-4 md:p-6"
          onClick={cancelPreview}
        >
          <div className={canvasBoxClass}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL of the captured canvas, not an optimizable remote asset */}
            <img
              src={previewItem.previewSrc ?? previewItem.thumbnail}
              alt="Previewed saved result"
              className="max-h-full max-w-full object-contain"
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  )
}
