"use client"

import { useCallback, useRef, useState } from "react"
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react"
import { RotateCcw, Trash2 } from "lucide-react"
import { helperText } from "@/components/controls/styles"
import {
  DEFAULT_SPEED_RAMP,
  SPEED_RAMP_X_MAX,
  SPEED_RAMP_X_MIN,
  SPEED_RAMP_Y_MAX,
  SPEED_RAMP_Y_MIN,
  SPEED_RAMP_Y_NEUTRAL,
  evaluateSpeedRamp,
  type SpeedRampPoint,
} from "@/lib/speed-ramp"
import { cn } from "@/lib/utils"

export type SpeedRampCurveProps = {
  speedRamp: SpeedRampPoint[]
  setSpeedRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  /** Optional label sharing the reset button's row — the caller's section heading. */
  title?: string
}

/** ViewBox units — arbitrary but fixed; the SVG scales them to whatever width it renders at. */
const VIEW_WIDTH = 300
const VIEW_HEIGHT = 130
const PAD_X = 12
const PAD_Y = 12
const PLOT_WIDTH = VIEW_WIDTH - PAD_X * 2
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_Y * 2
const CURVE_SAMPLES = 48
/** Minimum X spacing a new point may land at — keeps a click from stacking on a neighbor. */
const MIN_POINT_GAP = 0.02

function rampXToSvg(x: number) {
  return PAD_X + x * PLOT_WIDTH
}
function rampYToSvg(y: number) {
  const t = (y - SPEED_RAMP_Y_MIN) / (SPEED_RAMP_Y_MAX - SPEED_RAMP_Y_MIN)
  return PAD_Y + (1 - t) * PLOT_HEIGHT
}
function svgToRampX(svgX: number) {
  return Math.min(
    SPEED_RAMP_X_MAX,
    Math.max(SPEED_RAMP_X_MIN, (svgX - PAD_X) / PLOT_WIDTH)
  )
}
function svgToRampY(svgY: number) {
  const t = 1 - (svgY - PAD_Y) / PLOT_HEIGHT
  return Math.min(
    SPEED_RAMP_Y_MAX,
    Math.max(SPEED_RAMP_Y_MIN, SPEED_RAMP_Y_MIN + t * (SPEED_RAMP_Y_MAX - SPEED_RAMP_Y_MIN))
  )
}

/** Densely sampled polyline approximating the linear curve `evaluateSpeedRamp` produces. */
function curvePath(points: readonly SpeedRampPoint[]) {
  const parts: string[] = []
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const x = i / CURVE_SAMPLES
    const y = evaluateSpeedRamp(points, x)
    parts.push(
      `${i === 0 ? "M" : "L"}${rampXToSvg(x).toFixed(2)} ${rampYToSvg(y).toFixed(2)}`
    )
  }
  return parts.join(" ")
}

/**
 * Live Play speed ramp editor — a Houdini Attribute-Randomize-style curve. The X
 * axis is each Cell's fixed position along a deterministic random ordering
 * (`cellRampPosition` in the effect worker); the Y axis is that Cell's speed
 * multiplier. Drag a point to reshape the curve, drag on empty curve space to
 * add one. Select a point (click it) to reveal a delete button below the graph,
 * or double-click it directly — either removes it. The two endpoints can move
 * vertically but never leave x = 0 / x = 1, and can't be deleted either way.
 *
 * Just the widget — no section chrome, so a caller (the toolbar's popover) can
 * drop it into whatever shell fits its layout.
 */
export function SpeedRampCurve({ speedRamp, setSpeedRamp, title }: SpeedRampCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const toRampPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const local = pt.matrixTransform(ctm.inverse())
    return { x: svgToRampX(local.x), y: svgToRampY(local.y) }
  }, [])

  const movePointTo = useCallback(
    (index: number, target: { x: number; y: number }) => {
      setSpeedRamp((prev) => {
        if (index < 0 || index >= prev.length) return prev
        const isEndpoint = index === 0 || index === prev.length - 1
        // Clamped between immediate neighbors so a drag can never reorder the
        // array — endpoints are locked to their fixed x entirely.
        const lo = isEndpoint ? prev[index]!.x : prev[index - 1]!.x
        const hi = isEndpoint ? prev[index]!.x : prev[index + 1]!.x
        const x = isEndpoint ? prev[index]!.x : Math.min(hi, Math.max(lo, target.x))
        const y = Math.min(SPEED_RAMP_Y_MAX, Math.max(SPEED_RAMP_Y_MIN, target.y))
        const next = [...prev]
        next[index] = { x, y }
        return next
      })
    },
    [setSpeedRamp]
  )

  const handlePointDown = useCallback(
    (index: number) => (event: ReactPointerEvent<SVGCircleElement>) => {
      // Same non-passive touch lock as sidebar Base UI sliders.
      if (event.pointerType === "touch") event.preventDefault()
      event.stopPropagation()
      setDragIndex(index)
      setSelectedIndex(index)
      svgRef.current?.setPointerCapture(event.pointerId)
    },
    []
  )

  const handleBackgroundDown = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.pointerType === "touch") event.preventDefault()
      const point = toRampPoint(event.clientX, event.clientY)
      if (!point) return
      if (speedRamp.some((p) => Math.abs(p.x - point.x) < MIN_POINT_GAP)) return

      const next = [...speedRamp, point].sort((a, b) => a.x - b.x)
      const newIndex = next.indexOf(point)
      setSpeedRamp(next)
      setDragIndex(newIndex)
      setSelectedIndex(newIndex)
      svgRef.current?.setPointerCapture(event.pointerId)
    },
    [speedRamp, setSpeedRamp, toRampPoint]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (dragIndex === null) return
      const point = toRampPoint(event.clientX, event.clientY)
      if (!point) return
      movePointTo(dragIndex, point)
    },
    [dragIndex, movePointTo, toRampPoint]
  )

  const endDrag = useCallback(() => setDragIndex(null), [])

  const deletePoint = useCallback(
    (index: number) => {
      setSpeedRamp((prev) => {
        if (index === 0 || index === prev.length - 1) return prev
        return prev.filter((_, i) => i !== index)
      })
      // Indices shift on removal, so any stale selection is cleared rather
      // than risk it pointing at the wrong point afterward.
      setSelectedIndex(null)
    },
    [setSpeedRamp]
  )

  const removePoint = useCallback(
    (index: number) => (event: { stopPropagation: () => void }) => {
      event.stopPropagation()
      deletePoint(index)
    },
    [deletePoint]
  )

  const deleteSelected = useCallback(() => {
    if (selectedIndex === null) return
    deletePoint(selectedIndex)
  }, [selectedIndex, deletePoint])

  const resetRamp = useCallback(() => {
    setSpeedRamp([...DEFAULT_SPEED_RAMP])
    setSelectedIndex(null)
  }, [setSpeedRamp])

  const canDelete =
    selectedIndex !== null &&
    selectedIndex > 0 &&
    selectedIndex < speedRamp.length - 1

  const baselineY = rampYToSvg(SPEED_RAMP_Y_NEUTRAL)

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center", title ? "justify-between" : "justify-end")}>
        {title && (
          <span className="font-heading text-xs font-medium uppercase tracking-[0.12em] text-slate-300">
            {title}
          </span>
        )}
        <button
          type="button"
          aria-label="Reset speed ramp to default linear curve"
          title="Reset to default (linear 0×→1×)"
          onClick={resetRamp}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-1.5">
        {/* Y-axis labels — positioned to line up with the plot's top/bottom edges
            (PAD_Y from the row's own edges), not the row's full height. */}
        <div
          className={cn(helperText, "relative w-4 shrink-0")}
          aria-hidden="true"
        >
          <span
            className="absolute left-0 -translate-y-1/2"
            style={{ top: `${(PAD_Y / VIEW_HEIGHT) * 100}%` }}
          >
            2x
          </span>
          <span
            className="absolute left-0 translate-y-1/2"
            style={{ bottom: `${(PAD_Y / VIEW_HEIGHT) * 100}%` }}
          >
            0x
          </span>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full touch-none select-none rounded-lg border border-white/10 bg-slate-950/40"
          style={{ touchAction: "none" }}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label="Speed ramp curve editor"
        >
          {/* 1x baseline — the shared, unmodified Live Play speed. */}
          <line
            x1={PAD_X}
            x2={VIEW_WIDTH - PAD_X}
            y1={baselineY}
            y2={baselineY}
            stroke="currentColor"
            className="pointer-events-none text-slate-600"
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* Transparent hit area: drag on empty curve space to add + immediately drag a point. */}
          <rect
            x={PAD_X}
            y={PAD_Y}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            fill="transparent"
            onPointerDown={handleBackgroundDown}
            className="cursor-crosshair"
          />

          <path
            d={curvePath(speedRamp)}
            fill="none"
            stroke="currentColor"
            className="pointer-events-none text-slate-300"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {speedRamp.map((point, index) => {
            const isEndpoint = index === 0 || index === speedRamp.length - 1
            const isActive = dragIndex === index || selectedIndex === index
            return (
              <circle
                key={index}
                cx={rampXToSvg(point.x)}
                cy={rampYToSvg(point.y)}
                r={10}
                className={cn(
                  "cursor-grab stroke-slate-950 transition-[fill] active:cursor-grabbing",
                  isActive ? "fill-sky-300" : "fill-slate-200"
                )}
                strokeWidth={3}
                onPointerDown={handlePointDown(index)}
                onDoubleClick={isEndpoint ? undefined : removePoint(index)}
              >
                <title>
                  {isEndpoint
                    ? `Fixed at x=${Math.round(point.x * 100)}% — drag vertically`
                    : `x=${Math.round(point.x * 100)}%, ${point.y.toFixed(2)}× — double-click or select + delete to remove`}
                </title>
              </circle>
            )
          })}
        </svg>
      </div>

      <div className={cn(helperText, "flex items-center justify-between")}>
        {/* Invisible spacer matching the trash button's width, so the centered
            label stays centered on the row instead of drifting left. */}
        <span className="size-7 shrink-0" aria-hidden="true" />
        <span>% of Cells</span>
        <button
          type="button"
          aria-label="Delete selected point"
          title={canDelete ? "Delete selected point" : "Select a point to delete it"}
          disabled={!canDelete}
          onClick={deleteSelected}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40",
            canDelete
              ? "text-slate-400 hover:bg-red-500/10 hover:text-red-400"
              : "cursor-not-allowed text-slate-700"
          )}
        >
          <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </div>
      </div>
    </div>
  )
}
