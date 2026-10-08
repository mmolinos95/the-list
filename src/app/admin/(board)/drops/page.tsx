import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip } from "@/components/ui";
import { getLateDrops } from "@/lib/admin-data";
import { requireBoard } from "@/lib/auth";
import { clock, dayDate, duration, monthDay, weekdayShort } from "@/lib/time";

// B8: people who dropped after the list locked. Newest first.

export const metadata: Metadata = { title: "Late drops" };

export default function DropsPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Late drops</h1>
      <p className="mb-4 mt-1 text-[15px] text-muted">People who dropped out after their list locked (2 hours before kickoff). Each one emailed the board.</p>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white/70" />}>
        <Drops />
      </Suspense>
    </>
  );
}

async function Drops() {
  await requireBoard();
  const drops = await getLateDrops();
  if (drops.length === 0) {
    return (
      <Card className="text-center">
        <p className="font-display text-3xl">No late drops 🙌</p>
        <p className="mt-2 text-muted">When someone drops after the lock, they show up here.</p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <ul>
        {drops.map((d) => {
          const n = d.recent;
          const before = Date.parse(d.list.event.starts_at) - Date.parse(d.dropped_at);
          return (
            <li key={d.id} className="border-t border-line/60 px-5 py-3 first:border-t-0">
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span>
                    <span className="font-semibold">{d.member.name}</span>
                    <span className="block text-sm text-muted">
                      {weekdayShort(d.list.event.starts_at)} {monthDay(d.list.event.starts_at)} {d.list.name} · dropped{" "}
                      {before > 0 ? `${duration(before)} before kickoff` : "after kickoff"}
                    </span>
                  </span>
                  {n > 1 && <Chip kind="red">{n} this semester</Chip>}
                </summary>
                <div className="mt-2 space-y-1 text-sm text-muted">
                  <p>
                    Dropped {dayDate(d.dropped_at)} at {clock(d.dropped_at)}.
                  </p>
                  <p>
                    {n} late {n === 1 ? "drop" : "drops"} in the last 4 months.
                    {d.member.email && (
                      <>
                        {" "}
                        <a href={`mailto:${d.member.email}`} className="text-core underline">
                          {d.member.email}
                        </a>
                      </>
                    )}
                  </p>
                  <Link href={`/admin/p/${d.list.event.slug}`} className="font-semibold text-core hover:underline">
                    Open the practice →
                  </Link>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
