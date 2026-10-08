"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/issuer", label: "Issuer" },
];
const RESOURCES = [
  { href: "/presets", label: "Curve library", description: "Find a starting point for your market" },
  { href: "/trust", label: "Trust Center", description: "Understand the rules and risks" },
  { href: "/docs", label: "Documentation", description: "Learn how EquiCurve works" },
  { href: "/trade", label: "Open a trade", description: "Look up a pool by address" },
  { href: "/graduate", label: "Graduation", description: "Inspect a pool’s migration" },
  { href: "/settings", label: "Settings", description: "Network and local data" },
];

export function AppHeader() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [resources, setResources] = useState(false);
  const resourceRef = useRef<HTMLDivElement>(null);
  const resourceButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenu(false); setResources(false); }, [pathname]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (resources) resourceButton.current?.focus();
        if (menu) menuButton.current?.focus();
        setMenu(false); setResources(false);
      }
    };
    const outside = (event: PointerEvent) => {
      if (!resourceRef.current?.contains(event.target as Node)) setResources(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", dismiss); document.removeEventListener("pointerdown", outside); };
  }, [menu, resources]);
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-base/90 backdrop-blur-xl">
      <a href="#main-content" className="sr-only z-50 rounded-input bg-accent p-3 text-base focus:not-sr-only focus:absolute">Skip to content</a>
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-3 px-5 sm:px-8">
        <Link href="/" aria-label="EquiCurve home" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-base">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true"><path d="M4 17c7 0 7-10 16-10M4 21c7 0 7-10 16-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </span>
          <span className="text-lg font-semibold tracking-[-0.04em]">EquiCurve<span className="text-accent">.</span></span>
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {NAV.map(item => <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined} className={clsx("rounded-input px-4 py-2.5 text-sm transition-colors", active(item.href) ? "bg-subtle text-fg-primary" : "text-fg-secondary hover:bg-subtle/60 hover:text-fg-primary")}>{item.label}</Link>)}
          <div ref={resourceRef} className="relative">
            <button ref={resourceButton} type="button" aria-expanded={resources} aria-controls="resource-menu" onClick={() => setResources(!resources)} className="flex items-center gap-2 rounded-input px-4 py-2.5 text-sm text-fg-secondary hover:bg-subtle/60">Resources <span aria-hidden="true" className={resources ? "rotate-180" : ""}>⌄</span></button>
            {resources && <div id="resource-menu" className="ec-card absolute right-0 top-12 w-80 p-2 shadow-2xl">{RESOURCES.map(item => <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2.5 hover:bg-subtle"><span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-fg-muted">{item.description}</span></Link>)}</div>}
          </div>
        </nav>
        <div className="flex items-center gap-2"><WalletMultiButton /><button ref={menuButton} type="button" onClick={() => setMenu(!menu)} aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu} aria-controls="mobile-navigation" className="flex h-11 w-11 items-center justify-center rounded-input border border-line lg:hidden"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={menu ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg></button></div>
      </div>
      {menu && <nav id="mobile-navigation" aria-label="Mobile navigation" className="max-h-[calc(100dvh-72px)] overflow-y-auto border-t border-line px-5 py-4 lg:hidden"><div className="grid grid-cols-2 gap-2">{[...NAV, ...RESOURCES].map(item => <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined} onClick={() => setMenu(false)} className={clsx("rounded-input px-4 py-3 text-sm", active(item.href) ? "bg-accent/10 text-accent" : "bg-elevated text-fg-secondary hover:bg-subtle")}>{item.label}</Link>)}</div></nav>}
    </header>
  );
}
