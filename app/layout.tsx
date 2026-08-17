import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: "MyInsuranceBro",
  description: "Client and lead management for insurance brokers.",
  applicationName: "MyInsuranceBro",
}

export const viewport: Viewport = {
  themeColor: "#1E4E9C",
  width: "device-width",
  initialScale: 1,
  // The app runs inside a Capacitor WebView (Phase 4). viewportFit=cover is what makes the
  // env(safe-area-inset-*) values in broker-theme.css report real numbers on a notched
  // device instead of zero.
  viewportFit: "cover",
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
