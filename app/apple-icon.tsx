import { ImageResponse } from "next/og"

export const runtime = "nodejs"
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

/** Home-screen icon for iOS “Add to Home Screen”. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(ellipse at top left, #1e293b 0%, #08080a 55%, #000000 100%)",
          color: "#f5f5f7",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: -2,
        }}
      >
        Pb
      </div>
    ),
    { ...size }
  )
}
