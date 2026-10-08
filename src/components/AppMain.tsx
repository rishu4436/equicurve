"use client";

import { usePathname } from "next/navigation";

export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const variant = pathname === "/" ? " ec-main-home" : ["/docs", "/trust", "/settings"].includes(pathname) ? " ec-main-reading" : "";
  return <main id="main-content" className={`ec-main${variant}`}>{children}</main>;
}
