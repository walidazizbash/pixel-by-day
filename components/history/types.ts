import type { EffectSettings } from "@/lib/effect-types"

/** A user-captured snapshot of the current result, shown in the History sidebar. */
export interface HistorySnapshot {
  id: string
  /** Small JPEG data URL used as the sidebar thumbnail. */
  thumbnail: string
  /**
   * Full-resolution PNG blob URL of the canvas at capture time — what the preview modal
   * displays. Never show `thumbnail` there; it's a 150px JPEG and looks awful scaled up.
   */
  previewSrc: string | null
  imageSrc: string | null
  /** Carries `seed` too — never store it separately or the two can drift. */
  effectSettings: EffectSettings
}
