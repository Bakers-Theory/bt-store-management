import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Figtree, Newsreader } from "next/font/google";
import { AuthProvider } from "@/components/system/AuthProvider";
import { StoreHydrator } from "@/components/system/StoreHydrator";
import { ToastHost } from "@/components/system/ToastHost";
import { OwnerAuthHost } from "@/components/system/OwnerAuthHost";
import { PrintHost } from "@/components/system/PrintHost";
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Analytics } from "@vercel/analytics/next"

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-figtree",
  display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["italic", "normal"],
  weight: ["400", "500"],
  variable: "--font-newsreader",
  display: "swap",
  // Next.js has no fallback metrics for Newsreader; skip the size-adjust
  // fallback (and its build warning). Provide an explicit serif fallback.
  adjustFontFallback: false,
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: "Bakers Theory",
  description: "Bakers Theory — inventory, billing & analytics for your bakery",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Bakers Theory" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#7c4a1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${newsreader.variable}`}>
      <body>
        <AuthProvider>
          {children}
          <StoreHydrator />
          <ToastHost />
          <OwnerAuthHost />
          <PrintHost />
        </AuthProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
