"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-fetches the page's server data every few seconds while the tab is visible. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

/** Refreshes the page the moment a timestamp passes (a list opens or locks). */
export function RefreshAt({ at }: { at: string }) {
  const router = useRouter();
  useEffect(() => {
    const ms = Date.parse(at) - Date.now();
    if (ms <= 0 || ms > 2 ** 31 - 1) return;
    const id = setTimeout(() => router.refresh(), ms + 500);
    return () => clearTimeout(id);
  }, [at, router]);
  return null;
}

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Big scoreboard-style countdown. Switches the page to sign-up on its own at zero. */
export function Countdown({ to }: { to: string }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= Date.parse(to)) {
        clearInterval(id);
        router.refresh();
      }
    };
    const id = setInterval(tick, 250);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [to, router]);

  const p = parts(now === null ? 0 : Date.parse(to) - now);
  const cells = [
    ...(p.d > 0 ? [[p.d, "days"] as const] : []),
    [p.h, "hrs"] as const,
    [p.m, "min"] as const,
    [p.s, "sec"] as const,
  ];
  return (
    <div className="flex gap-2" aria-live="off">
      {cells.map(([v, label]) => (
        <div key={label} className="min-w-16 rounded-xl bg-ink px-3 py-2 text-center text-white">
          <div className="font-display text-4xl leading-none tabular-nums">{now === null ? "--" : String(v).padStart(2, "0")}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-columbia">{label}</div>
        </div>
      ))}
    </div>
  );
}
