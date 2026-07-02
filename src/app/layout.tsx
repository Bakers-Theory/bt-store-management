import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreHydrator } from "@/components/system/StoreHydrator";
import { ToastHost } from "@/components/system/ToastHost";
import { OwnerAuthHost } from "@/components/system/OwnerAuthHost";
import { PrintHost } from "@/components/system/PrintHost";

export const metadata: Metadata = {
  title: "Bakers Theory",
  description: "Bakers Theory — inventory, billing & analytics for your bakery",
  manifest: "/manifest.json",
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
    <html lang="en">
      <body>
        {children}
        <StoreHydrator />
        <ToastHost />
        <OwnerAuthHost />
        <PrintHost />
      </body>
    </html>
  );
}
