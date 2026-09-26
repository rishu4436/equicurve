import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { ClusterBanner } from "@/components/ClusterBanner";
import { GlobalEligibility } from "@/components/gate/GlobalEligibility";
import { Providers } from "@/components/Providers";
import "./globals.css";

const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const TITLE = "EquiCurve — issuer-controlled launch & price discovery on Solana";
const DESCRIPTION =
  "An issuer-controlled launch and price-discovery interface for equity-inspired and RWA-related tokens, built on Meteora Dynamic Bonding Curve with graduation to DAMM v2. Does not create shareholder rights.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "EquiCurve",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable} font-sans`}>
        <Providers>
          <GlobalEligibility>
            <div className="flex min-h-screen flex-col">
              <AppHeader />
              <ClusterBanner />
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
                {children}
              </main>
              <AppFooter />
            </div>
          </GlobalEligibility>
          <Toaster theme="dark" richColors position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
