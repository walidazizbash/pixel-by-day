import { ImageResponse } from "next/og"
import { SITE_TAGLINE, SITE_TITLE } from "@/lib/site"

export const runtime = "nodejs"
export const alt = SITE_TITLE
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background:
            "radial-gradient(ellipse at top left, #1c1c21 0%, #0a0a0d 45%, #0a0a0d 100%)",
          color: "#f7f7f8",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#8b8b93",
          }}
        >
          Generative Pixel Effects
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            Pixel By Day
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "#c4c4ca",
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            {SITE_TAGLINE}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#8b8b93" }}>
          pixelbyday.com
        </div>
      </div>
    ),
    { ...size }
  )
}
