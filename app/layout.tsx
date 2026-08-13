import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { getSiteUrl } from "@/lib/site"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const siteUrl = getSiteUrl()

const title = "Pixel By Day — Generative Pixel Art & Image Effects"
const description =
  "Pixel By Day is a browser-based generative art studio for turning photos into Cell-based mosaics with noise masks, smear styles, effects, and 35mm film grain — rendered live on HTML5 Canvas."
const socialDescription =
  "Turn any photo into a generative Cell mosaic with noise, smears, effects, and 35mm grain — entirely in your browser."

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08080a",
  viewportFit: "cover",
}

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
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Pixel By Day",
    statusBarStyle: "black-translucent",
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
    description: socialDescription,
    type: "website",
    locale: "en_US",
    siteName: "Pixel By Day",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: socialDescription,
    images: ["/twitter-image"],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Pixel By Day",
  description,
  url: siteUrl,
  applicationCategory: "DesignApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires HTML5 Canvas and Web Workers",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Person",
    name: "Walid Aziz Basharyar",
    url: "https://www.instagram.com/walidazizbash",
  },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full font-body antialiased`}
    >
      <body className="h-full overflow-hidden font-body antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  )
}
