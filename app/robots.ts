import type { MetadataRoute } from "next"
import { getSiteUrl, isSearchIndexable } from "@/lib/site"

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl()

  // Preview / non-prod Vercel deployments must not be indexed.
  if (!isSearchIndexable()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    }
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
