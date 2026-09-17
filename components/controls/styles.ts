/**
 * Shared Tailwind class strings for the control column.
 *
 * These were locals inside the page component; hoisting them to module scope is
 * what lets each panel import the exact same strings instead of taking six
 * className props, and it stops the set being rebuilt on every render.
 */

import { cn } from "@/lib/utils"

export const floatingCard =
  "shrink-0 overflow-visible rounded-xl border border-ink/10 bg-surface-card p-6 text-ink shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
export const pageTitle =
  "font-heading text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]"
export const sectionTitle =
  "font-heading text-xs font-medium uppercase tracking-[0.14em] text-white"
export const controlLabel = "font-body text-sm text-ink"
/**
 * Neutral border-and-wash button. Only used for Play (`EqualToolbarButton`'s
 * default "wash" tone) and Cancel (History preview) — the actions that
 * deliberately read as secondary next to the opaque blue ones below.
 * Below `sm`, `EqualToolbarButton` drops each button's text label (icon only)
 * so its row still fits without horizontal scrolling — see that component.
 */
export const toolbarActionButton =
  "h-7 shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-xs font-semibold text-ink shadow-none transition-colors hover:border-accent/60 hover:bg-accent/20 active:bg-accent/25 lg:h-8 lg:px-6"
/**
 * Opaque blue button — white text/icons for contrast against the solid fill.
 * Used for the canvas action toolbar (Load/Bake/Reset/Capture/Save, all five
 * identical, none singled out as "the primary one") via `EqualToolbarButton`'s
 * `tone="solid"`, plus Restore (History preview) and Confirm (Bake dialog).
 */
export const toolbarPrimaryButton =
  "h-7 shrink-0 rounded-lg border border-transparent bg-accent px-2.5 text-xs font-semibold text-ink shadow-none transition-colors hover:bg-accent-hover lg:h-8 lg:px-6"
/**
 * The box the rendered image occupies. Shared by the live canvas pane and the preview
 * overlay so the preview lands on exactly the canvas's footprint — they must stay identical.
 * No viewport-height cap: a mid-size `max-h-[80vh]` made the image collapse between
 * mobile and desktop breakpoints, then jump back. No width cap either — the artwork
 * is meant to dominate its column, and `object-scale-down` on the `<canvas>` itself
 * already prevents any upscaling past the rendered bitmap's own pixel size.
 */
export const canvasBoxClass =
  "flex size-full items-center justify-center overflow-hidden"
export const helperText = "font-body text-xs text-ink-muted"
export const bodyText = "font-body text-sm font-medium text-ink"
/** Footer credit — ~2× callout border (`border-ink/10` → 20% ink). */
export const footerText = "font-footer text-xs text-footer-credit"
export const footerLink =
  "font-footer text-footer-name transition-colors hover:text-footer-name-hover"
export const controlField = "flex flex-col gap-1.5"
export const sliderRow = "flex w-full min-w-0 items-center gap-1.5"
export const sliderTrackClass = "w-full min-w-0 flex-1"
export const sliderValueReadout = cn(
  "font-footer text-xs text-ink",
  "w-8 shrink-0 text-right tabular-nums"
)
