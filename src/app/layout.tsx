import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
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

export const metadata: Metadata = {
  title: "EquiCurve — Fair discovery for tokenized equity on Solana",
  description:
    "Launch tokenized equity / RWA offerings on Meteora Dynamic Bonding Curve. Graduate into DAMM v2 with Studio-class create UX and xStocks-grade trust.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable} font-sans`}>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <AppHeader />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
              {children}
            </main>
            <AppFooter />
          </div>
          <Toaster theme="dark" richColors position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
