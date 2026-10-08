"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS = [
  { href: "/admin", label: "Practices", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/admin/schedule", label: "Schedule", icon: "M5 5h14v14H5zM5 9h14M9 3v4M15 3v4" },
  { href: "/admin/drops", label: "Late drops", icon: "M12 7v6m0 4h.01M4.9 19h14.2a1 1 0 0 0 .9-1.5L12.9 5a1 1 0 0 0-1.8 0L4 17.5a1 1 0 0 0 .9 1.5z" },
  { href: "/admin/board", label: "Board", icon: "M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1a3 3 0 0 0-2-2.8M16 4.2a3 3 0 0 1 0 5.6" },
];

/** Bottom tabs on phones, a row of links on desktop. */
export function BoardNav({ className = "" }: { className?: string }) {
  return <NavLinks className={className} path={usePathname()} />;
}

/** Without the current path (used while it streams in), nothing is highlighted. */
export function NavLinks({ className = "", path }: { className?: string; path: string }) {
  const active = (href: string) => (href === "/admin" ? path === "/admin" || path.startsWith("/admin/p/") : path.startsWith(href));
  return (
    <nav className={cx("gap-1", className)}>
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={active(it.href) ? "page" : undefined}
          className={cx(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold sm:flex-none sm:rounded-lg sm:px-3 sm:text-sm",
            active(it.href) ? "text-core sm:bg-white/70" : "text-muted hover:text-ink",
          )}
        >
          <svg viewBox="0 0 24 24" className="size-6 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={it.icon} />
          </svg>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
