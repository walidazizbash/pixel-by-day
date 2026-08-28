import { ImageResponse } from "next/og"

export const runtime = "nodejs"
export const size = { width: 256, height: 256 }
export const contentType = "image/png"

/** Browser tab / Google search favicon. */
export default function Icon() {
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
          fontSize: 112,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        Pb
      </div>
    ),
    { ...size }
  )
}
