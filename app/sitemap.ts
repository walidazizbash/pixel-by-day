import type { MetadataRoute } from "next"

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://pixelbyday.com"

/** Stable last-mod for crawlers (bump when shipping material site changes). */
const SITE_LAST_MODIFIED = new Date("2026-08-11T00:00:00.000Z")

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: SITE_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
  ]
}
