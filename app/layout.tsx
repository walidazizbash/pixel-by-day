import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import {
  getSiteUrl,
  isSearchIndexable,
  SITE_TAGLINE,
  SITE_TITLE,
} from "@/lib/site"
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
const searchIndexable = isSearchIndexable()

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Explicitly allow pinch / accessibility zoom (never set maximumScale or userScalable: false).
  userScalable: true,
  themeColor: "#0a0a0d",
  viewportFit: "cover",
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: SITE_TITLE,
    template: "%s · Pixel By Day",
  },
  description: SITE_TAGLINE,
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
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Pixel By Day",
    statusBarStyle: "black-translucent",
  },
  robots: searchIndexable
    ? {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
          "max-video-preview": -1,
        },
      }
    : {
        index: false,
        follow: false,
        googleBot: {
          index: false,
          follow: false,
          noimageindex: true,
        },
      },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_TAGLINE,
    type: "website",
    locale: "en_US",
    siteName: "Pixel By Day",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_TAGLINE,
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
  description: SITE_TAGLINE,
  url: siteUrl,
  applicationCategory: "DesignApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires HTML5 Canvas and Web Workers",
  image: `${siteUrl}/opengraph-image`,
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
