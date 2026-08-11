import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://pixelbyday.com"

const title = "Pixel By Day — Generative Pixel Art & Image Effects"
const description =
  "Pixel By Day is a browser-based generative art studio for turning photos into Cell-based mosaics with noise masks, smear styles, effects, and 35mm film grain — rendered live on HTML5 Canvas."

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · Pixel By Day",
  },
  description,
  keywords: [
    "Generative Art",
    "Pixel Art",
    "Pixel By Day",
    "Image Manipulation",
    "HTML5 Canvas",
    "Digital Collage",
    "Dithering",
    "Film Grain",
    "35mm Texture",
    "Mosaic Generator",
    "Creative Coding",
    "Photo Distortion",
  ],
  authors: [{ name: "Walid Aziz Basharyar" }],
  creator: "Walid Aziz Basharyar",
  publisher: "Walid Aziz Basharyar",
  applicationName: "Pixel By Day",
  category: "design",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description:
      "Turn any photo into a generative Cell mosaic with noise, smears, effects, and 35mm grain — entirely in your browser.",
    type: "website",
    locale: "en_US",
    siteName: "Pixel By Day",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description:
      "Turn any photo into a generative Cell mosaic with noise, smears, effects, and 35mm grain — entirely in your browser.",
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full font-body antialiased`}
    >
      <body className="h-full overflow-hidden font-body antialiased">
        {children}
      </body>
    </html>
  )
}
