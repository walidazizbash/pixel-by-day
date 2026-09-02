import type { EffectSettings, SpeedRampPoint } from "@/lib/effect-types"

/** A user-captured snapshot of the current result, shown in the History sidebar. */
export interface HistorySnapshot {
  id: string
  /** Small WebP data URL used as the sidebar thumbnail. */
  thumbnail: string
  /**
   * Preview-size WebP blob URL of the canvas at capture time — what the preview
   * modal displays. Never show `thumbnail` there; it's a 150px WebP and looks
   * awful scaled up.
   */
  previewSrc: string | null
  imageSrc: string | null
  /** Carries `seed` too — never store it separately or the two can drift. */
  effectSettings: EffectSettings
  /**
   * Live Play scroll offset at capture time, so Restore reproduces the exact
   * captured frame together with `speedRamp`.
   */
  offsetY: number
  /**
   * Per-Cell Live Play speed curve at capture time — sibling of `offsetY`, not
   * part of `EffectSettings`. Without it, Restore at a nonzero offset would
   * regenerate with whatever ramp is live now.
   */
  speedRamp: SpeedRampPoint[]
}
