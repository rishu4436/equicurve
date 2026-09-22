"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getCluster } from "@/lib/constants";
import { clsx } from "clsx";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/presets", label: "Presets" },
  { href: "/trust", label: "Trust" },
];

export function AppHeader() {
  const pathname = usePathname();
  const cluster = getCluster();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-accent/40 bg-elevated">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path
                  d="M3 18 C8 17, 12 12, 16 8 L21 8"
                  fill="none"
                  stroke="#2DD4BF"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M16 8 H21"
                  stroke="#A78BFA"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="font-semibold tracking-tight text-fg-primary">
              Equi<span className="text-accent">Curve</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-pill px-3 py-1.5 text-sm transition",
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-fg-secondary hover:text-fg-primary",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/portfolio"
            className="hidden text-sm text-fg-secondary transition hover:text-fg-primary lg:inline"
          >
            Portfolio
          </Link>
          <Link
            href="/issuer"
            className="hidden text-sm text-fg-secondary transition hover:text-fg-primary lg:inline"
          >
            Issuer
          </Link>
          <Link
            href="/docs"
            className="hidden text-sm text-fg-secondary transition hover:text-fg-primary sm:inline"
          >
            Docs
          </Link>
          <span
            className={clsx(
              "hidden rounded-pill border px-2.5 py-1 text-xs sm:inline",
              cluster === "devnet"
                ? "border-signal-warn/40 bg-signal-warn/10 text-signal-warn"
                : "border-line text-fg-muted",
            )}
          >
            {cluster}
          </span>
          <WalletMultiButton />
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "whitespace-nowrap rounded-pill px-3 py-1 text-xs",
                active ? "bg-accent/15 text-accent" : "text-fg-secondary",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
