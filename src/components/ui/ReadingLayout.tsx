"use client";

import { useEffect, useRef, useState } from "react";

export function ReadingLayout({ children }: { children: React.ReactNode }) {
  const article = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<{ id: string; title: string }[]>([]);
  const [active, setActive] = useState("");
  useEffect(() => {
    const nodes = [...(article.current?.querySelectorAll("h2") ?? [])];
    nodes.forEach((node, index) => { if (!node.id) node.id = `section-${index + 1}`; });
    setHeadings(nodes.map(node => ({ id: node.id, title: node.textContent ?? "" })));
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-100px 0px -60% 0px" });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  const links = headings.map(heading => <a key={heading.id} href={`#${heading.id}`} aria-current={active === heading.id ? "location" : undefined} className={`block rounded-lg px-3 py-2.5 text-xs leading-relaxed transition-colors ${active === heading.id ? "bg-accent/10 text-accent" : "text-fg-muted hover:bg-subtle hover:text-fg-primary"}`}>{heading.title}</a>);
  return <div className="grid items-start gap-10 lg:grid-cols-[200px_minmax(0,1fr)]"><aside className="lg:sticky lg:top-28"><nav aria-label="On this page" className="hidden lg:block"><p className="mb-3 px-3 text-xs font-medium uppercase tracking-wider text-fg-secondary">On this page</p>{links}</nav><details className="rounded-xl border border-line p-4 lg:hidden"><summary className="text-sm text-fg-secondary">On this page</summary><nav aria-label="Page contents" className="mt-3">{links}</nav></details></aside><div ref={article} className="min-w-0 space-y-8 [&_h2]:text-lg [&_h2]:tracking-tight">{children}</div></div>;
}
