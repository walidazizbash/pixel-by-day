import type { MetadataRoute } from "next"
import { getSiteUrl } from "@/lib/site"

/** Stable last-mod for crawlers (bump when shipping material site changes). */
const SITE_LAST_MODIFIED = new Date("2026-09-01T00:00:00.000Z")

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${getSiteUrl()}/`,
      lastModified: SITE_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
  ]
}
