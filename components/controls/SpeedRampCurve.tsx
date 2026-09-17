"use client"

import { useCallback, useRef, useState } from "react"
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react"
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

export type RampAxisLabels = {
  yTop: ReactNode
  yBottom: ReactNode
  xLeft?: string
  xRight?: string
  xCenter?: string
}

export type SpeedRampCurveProps = {
  speedRamp: SpeedRampPoint[]
  setSpeedRamp: Dispatch<SetStateAction<SpeedRampPoint[]>>
  /** Optional label sharing the reset button's row — the caller's section heading. */
  title?: string
  /** Inclusive Y range of the plot. Defaults to the Live Play speed ramp (0–2). */
  yMin?: number
  yMax?: number
  defaultRamp?: readonly SpeedRampPoint[]
  labels?: RampAxisLabels
  /** Draw a dashed horizontal guide at this Y, or hide it with `false`. */
  baselineY?: number | false
  ariaLabel?: string
  resetAriaLabel?: string
}

const DEFAULT_LABELS: RampAxisLabels = {
  yTop: "2x",
  yBottom: "0x",
  xCenter: "% of Cells",
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

/**
 * Live Play / dither ramp editor — a Houdini Attribute-Randomize-style curve.
 * Drag a point to reshape, drag empty space to add one. Endpoints stay pinned
 * to x = 0 / x = 1. Just the widget — no section chrome.
 */
export function SpeedRampCurve({
  speedRamp,
  setSpeedRamp,
  title,
  yMin = SPEED_RAMP_Y_MIN,
  yMax = SPEED_RAMP_Y_MAX,
  defaultRamp = DEFAULT_SPEED_RAMP,
  labels = DEFAULT_LABELS,
  baselineY = SPEED_RAMP_Y_NEUTRAL,
  ariaLabel = "Speed ramp curve editor",
  resetAriaLabel = "Reset speed ramp to default linear curve",
}: SpeedRampCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const ySpan = yMax - yMin

  const rampXToSvg = useCallback((x: number) => PAD_X + x * PLOT_WIDTH, [])
  const rampYToSvg = useCallback(
    (y: number) => {
      const t = ySpan === 0 ? 0 : (y - yMin) / ySpan
      return PAD_Y + (1 - t) * PLOT_HEIGHT
    },
    [yMin, ySpan]
  )
  const svgToRampX = useCallback((svgX: number) => {
    return Math.min(
      SPEED_RAMP_X_MAX,
      Math.max(SPEED_RAMP_X_MIN, (svgX - PAD_X) / PLOT_WIDTH)
    )
  }, [])
  const svgToRampY = useCallback(
    (svgY: number) => {
      const t = 1 - (svgY - PAD_Y) / PLOT_HEIGHT
      return Math.min(yMax, Math.max(yMin, yMin + t * ySpan))
    },
    [yMin, yMax, ySpan]
  )

  const curvePath = useCallback(
    (points: readonly SpeedRampPoint[]) => {
      const parts: string[] = []
      for (let i = 0; i <= CURVE_SAMPLES; i++) {
        const x = i / CURVE_SAMPLES
        const y = evaluateSpeedRamp(points, x)
        parts.push(
          `${i === 0 ? "M" : "L"}${rampXToSvg(x).toFixed(2)} ${rampYToSvg(y).toFixed(2)}`
        )
      }
      return parts.join(" ")
    },
    [rampXToSvg, rampYToSvg]
  )

  const toRampPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      const ctm = svg?.getScreenCTM()
      if (!svg || !ctm) return null
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const local = pt.matrixTransform(ctm.inverse())
      return { x: svgToRampX(local.x), y: svgToRampY(local.y) }
    },
    [svgToRampX, svgToRampY]
  )

  const movePointTo = useCallback(
    (index: number, target: { x: number; y: number }) => {
      setSpeedRamp((prev) => {
        if (index < 0 || index >= prev.length) return prev
        const isEndpoint = index === 0 || index === prev.length - 1
        const lo = isEndpoint ? prev[index]!.x : prev[index - 1]!.x
        const hi = isEndpoint ? prev[index]!.x : prev[index + 1]!.x
        const x = isEndpoint ? prev[index]!.x : Math.min(hi, Math.max(lo, target.x))
        const y = Math.min(yMax, Math.max(yMin, target.y))
        const next = [...prev]
        next[index] = { x, y }
        return next
      })
    },
    [setSpeedRamp, yMin, yMax]
  )

  const handlePointDown = useCallback(
    (index: number) => (event: ReactPointerEvent<SVGCircleElement>) => {
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
    setSpeedRamp([...defaultRamp])
    setSelectedIndex(null)
  }, [setSpeedRamp, defaultRamp])

  const canDelete =
    selectedIndex !== null &&
    selectedIndex > 0 &&
    selectedIndex < speedRamp.length - 1

  const hasXEnds = Boolean(labels.xLeft || labels.xRight)
  const yTopHint = typeof labels.yTop === "string" ? labels.yTop.length : 0
  const yBottomHint =
    typeof labels.yBottom === "string" ? labels.yBottom.length : 0
  const yGutterWide = yTopHint > 4 || yBottomHint > 4

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center", title ? "justify-between" : "justify-end")}>
        {title && (
          <span className="font-heading text-xs font-medium uppercase tracking-[0.12em] text-ink">
            {title}
          </span>
        )}
        <button
          type="button"
          aria-label={resetAriaLabel}
          onClick={resetRamp}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-1.5">
        <div
          className={cn(
            helperText,
            "relative shrink-0",
            yGutterWide ? "w-[4.75rem]" : "w-4"
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              "absolute left-0 -translate-y-1/2",
              yGutterWide && "max-w-[4.75rem] leading-tight"
            )}
            style={{ top: `${(PAD_Y / VIEW_HEIGHT) * 100}%` }}
          >
            {labels.yTop}
          </span>
          <span
            className={cn(
              "absolute left-0 translate-y-1/2",
              yGutterWide && "max-w-[4.75rem] leading-tight"
            )}
            style={{ bottom: `${(PAD_Y / VIEW_HEIGHT) * 100}%` }}
          >
            {labels.yBottom}
          </span>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full touch-none select-none rounded-lg border border-ink/15 bg-surface-strong"
          style={{ touchAction: "none" }}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label={ariaLabel}
        >
          {baselineY !== false && (
            <line
              x1={PAD_X}
              x2={VIEW_WIDTH - PAD_X}
              y1={rampYToSvg(baselineY)}
              y2={rampYToSvg(baselineY)}
              stroke="currentColor"
              className="pointer-events-none text-ink/20"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

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
            className="pointer-events-none text-ink/70"
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
                  "cursor-grab stroke-surface transition-[fill] active:cursor-grabbing",
                  isActive ? "fill-accent" : "fill-ink"
                )}
                strokeWidth={3}
                onPointerDown={handlePointDown(index)}
                onDoubleClick={isEndpoint ? undefined : removePoint(index)}
              />
            )
          })}
        </svg>
      </div>

      {hasXEnds && (
        <div
          className={cn(
            helperText,
            "flex items-center justify-between",
            yGutterWide && "pl-[5.15rem]"
          )}
        >
          <span>{labels.xLeft}</span>
          <span>{labels.xRight}</span>
        </div>
      )}

      <div className={cn(helperText, "flex items-center justify-between")}>
        <span className="size-7 shrink-0" aria-hidden="true" />
        <span>{labels.xCenter ?? ""}</span>
        <button
          type="button"
          aria-label="Delete selected point"
          disabled={!canDelete}
          onClick={deleteSelected}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40",
            canDelete
              ? "text-ink-muted hover:bg-red-500/10 hover:text-red-400"
              : "cursor-not-allowed text-ink/20"
          )}
        >
          <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </div>
      </div>
    </div>
  )
}
