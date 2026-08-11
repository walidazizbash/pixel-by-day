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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Pixel By Day — Generative Pixel Art & Image Effects",
    template: "%s · Pixel By Day",
  },
  description:
    "Pixel By Day is a browser-based generative art tool for applying real-time pixel tile effects to images. Explore dithering, color inversion, surreal remapping, smear distortions, and noise-driven tile layouts — all rendered on HTML5 Canvas.",
  keywords: [
    "Generative Art",
    "Pixel Art",
    "Image Manipulation",
    "HTML5 Canvas",
    "Digital Collage",
    "Dithering",
    "Pixel Effects",
    "Tile Art",
    "Creative Coding",
    "Photo Distortion",
  ],
  authors: [{ name: "Walid Aziz Basharyar" }],
  creator: "Walid Aziz Basharyar",
  publisher: "Walid Aziz Basharyar",
  applicationName: "Pixel By Day",
  category: "design",
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
    title: "Pixel By Day — Generative Pixel Art & Image Effects",
    description:
      "Apply real-time generative pixel tile effects to any image directly in your browser.",
    type: "website",
    locale: "en_US",
    siteName: "Pixel By Day",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pixel By Day — Generative Pixel Art & Image Effects",
    description:
      "Apply real-time generative pixel tile effects to any image directly in your browser.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full font-sans antialiased`}
    >
      <body className="h-full overflow-hidden font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
