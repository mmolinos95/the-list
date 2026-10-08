import Link from "next/link";
import { Suspense } from "react";
import { Lockup } from "@/components/brand";
import { AutoRefresh } from "@/components/live";
import { MyBadge } from "@/components/my-badge";
import { listSummary, StageChip } from "@/components/practice";
import { getUpcomingPractices } from "@/lib/data";
import { monthDay, timeRange, weekdayLong } from "@/lib/time";

// M1: the permanent link pinned in the WhatsApp group.

export default function Home() {
  return (
    <main className="flex-1">
      <header className="bg-columbia px-4 pb-8 pt-8">
        <div className="mx-auto max-w-xl">
          <Lockup />
          <h1 className="mt-6 font-display text-6xl leading-[0.9]">Your spot,<br />sorted.</h1>
          <p className="mt-3 text-[15px]">The practice sign-up list for CBS FC. 40 spots per list, first come, first served.</p>
        </div>
      </header>
      <section className="mx-auto max-w-xl px-4 py-6">
        <h2 className="mb-3 font-display text-3xl">This week</h2>
        <Suspense fallback={<CardsSkeleton />}>
          <Practices />
        </Suspense>
      </section>
    </main>
  );
}

async function Practices() {
  const practices = await getUpcomingPractices();
  if (practices.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">
        No practices scheduled right now. Check the WhatsApp group for news.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      <AutoRefresh seconds={30} />
      {practices.map((p) => (
        <li key={p.event.id}>
          <Link
            href={`/p/${p.event.slug}`}
            className="block rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(17_20_24/0.06)] transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-core"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-3xl leading-none">{weekdayLong(p.event.starts_at)}</p>
                <p className="mt-1 text-sm text-muted">
                  {monthDay(p.event.starts_at)} · {timeRange(p.event.starts_at, p.event.ends_at)} · {p.event.location}
                </p>
              </div>
              <StageChip practice={p} />
            </div>
            {p.stage !== "cancelled" && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {p.lists.map((l) => (
                  <span key={l.id}>
                    <span className="font-display text-lg">{l.name}</span> <span className="text-muted">{listSummary(l)}</span>
                  </span>
                ))}
                <MyBadge eventId={p.event.id} />
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CardsSkeleton() {
  return (
    <ul className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="h-32 animate-pulse rounded-2xl bg-white/70" />
      ))}
    </ul>
  );
}
