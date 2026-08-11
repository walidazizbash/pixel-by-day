"use client"

import type { PointerEvent as ReactPointerEvent } from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function preventTouchScroll(event: ReactPointerEvent<HTMLElement>) {
  // React's onPointerDown is non-passive, so preventDefault stops the scrollable
  // sidebar/page from hijacking the gesture on iOS Safari / Chrome Android.
  if (event.pointerType === "touch") {
    event.preventDefault()
  }
}

function capturePointer(event: ReactPointerEvent<HTMLElement>) {
  preventTouchScroll(event)
  event.currentTarget.setPointerCapture(event.pointerId)
}

function releasePointer(event: ReactPointerEvent<HTMLElement>) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onPointerDown,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn(
        "touch-none data-horizontal:w-full data-vertical:h-full",
        className
      )}
      style={{ touchAction: "none" }}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      onPointerDown={onPointerDown}
      {...props}
    >
      <SliderPrimitive.Control
        className="relative flex w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col"
        style={{ touchAction: "none" }}
        onPointerDown={preventTouchScroll}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow touch-none overflow-hidden rounded-full border-0 bg-slate-700/50 shadow-none select-none data-horizontal:h-[3px] data-horizontal:w-full data-vertical:h-full data-vertical:w-[3px]"
          style={{ touchAction: "none" }}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-gradient-to-r from-slate-500 via-slate-300 to-slate-200 touch-none select-none data-horizontal:h-full data-vertical:w-full"
            style={{ touchAction: "none" }}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-3.5 shrink-0 cursor-pointer touch-none rounded-full border-0 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 shadow-none transition-[box-shadow,transform] select-none after:absolute after:-inset-2 hover:shadow-[0_0_12px_rgba(255,255,255,0.25)] focus-visible:shadow-[0_0_0_2px_rgba(255,255,255,0.35)] focus-visible:outline-hidden active:cursor-grabbing active:scale-95 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50"
            style={{ touchAction: "none" }}
            onPointerDown={capturePointer}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
