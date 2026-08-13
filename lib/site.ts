function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/\/$/, "")
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Canonical absolute origin for metadata, robots, and sitemap.
 *
 * Priority:
 * 1. NEXT_PUBLIC_SITE_URL (required for correct production SEO/social URLs)
 * 2. Vercel production host / deployment URL
 * 3. Hardcoded production fallback
 */
export function getSiteUrl(): string {
  const fromEnv = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  if (fromEnv) return fromEnv

  const vercelEnv = process.env.VERCEL_ENV
  const vercelProduction = normalizeOrigin(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined
  )
  if (vercelEnv === "production" && vercelProduction) {
    return vercelProduction
  }

  const vercelDeployment = normalizeOrigin(
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
  )
  if (vercelDeployment) return vercelDeployment

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[pixel-by-day] NEXT_PUBLIC_SITE_URL is unset; falling back to https://pixelbyday.com"
    )
  }

  return "https://pixelbyday.com"
}
