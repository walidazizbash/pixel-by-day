/**
 * Shared Tailwind class strings for the control column.
 *
 * These were locals inside the page component; hoisting them to module scope is
 * what lets each panel import the exact same strings instead of taking six
 * className props, and it stops the set being rebuilt on every render.
 */

import { cn } from "@/lib/utils"

export const floatingCard =
  "shrink-0 overflow-visible rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-[#f5f5f7] shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"
export const pageTitle =
  "font-heading text-sm font-semibold tracking-tight text-[#f5f5f7]"
export const sectionTitle =
  "font-heading text-xs font-medium uppercase tracking-[0.12em] text-slate-300"
export const controlLabel = "font-body text-sm text-slate-300"
/**
 * The small-screen `px-2.5` is a deliberate ceiling, not a guess. These sit in a
 * `flex-nowrap` / `overflow-x-auto` strip below `lg` and are `shrink-0`, so padding is
 * never compressed — it just pushes the five buttons into horizontal scrolling. 10px a
 * side is about the most that keeps them all on screen at ~360px.
 *
 * Kept to two steps on purpose: a `sm:` step would leak into the `cn(toolbarActionButton,
 * "... px-6")` call sites, since tailwind-merge only resolves conflicts within a matching
 * variant and an unprefixed override cannot cancel a prefixed one.
 */
export const toolbarActionButton =
  "h-7 shrink-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 px-2.5 text-xs font-semibold text-slate-950 shadow-none transition-[background,opacity,transform] hover:from-slate-200 hover:via-slate-300 hover:to-slate-400 lg:h-8 lg:px-6"
/**
 * The box the rendered image occupies. Shared by the live canvas pane and the preview
 * overlay so the preview lands on exactly the canvas's footprint — they must stay identical.
 * No viewport-height cap: a mid-size `max-h-[80vh]` made the image collapse between
 * mobile and desktop breakpoints, then jump back.
 */
export const canvasBoxClass =
  "flex size-full max-w-[1200px] items-center justify-center overflow-hidden"
export const helperText = "font-body text-xs text-slate-400"
export const bodyText = "font-body text-sm font-medium text-slate-200"
export const footerText = "font-footer text-xs text-slate-400"
export const footerLink =
  "font-footer text-slate-300 transition-colors hover:text-slate-100"
export const controlField = "flex flex-col gap-1.5"
export const sliderRow = "flex w-full min-w-0 items-center gap-1.5"
export const sliderTrackClass = "w-full min-w-0 flex-1"
export const sliderValueReadout = cn(
  footerText,
  "w-8 shrink-0 text-right tabular-nums"
)
