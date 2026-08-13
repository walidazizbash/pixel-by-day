import { ImageResponse } from "next/og"

export const runtime = "nodejs"
export const alt = "Pixel By Day — Generative Pixel Art & Image Effects"
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
            "radial-gradient(ellipse at top left, #1e293b 0%, #08080a 45%, #000000 100%)",
          color: "#f5f5f7",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#94a3b8",
          }}
        >
          Generative Mosaic Studio
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
              color: "#cbd5e1",
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            Cell layouts, noise masks, smear styles, and 35mm grain — all in the
            browser.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#64748b" }}>
          pixelbyday.com
        </div>
      </div>
    ),
    { ...size }
  )
}
