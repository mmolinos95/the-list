import type { Metadata } from "next";
import { Suspense } from "react";
import { Lockup } from "@/components/brand";
import { AutoRefresh, RefreshAt } from "@/components/live";
import { NoAccess } from "@/components/no-access";
import { Chip } from "@/components/ui";
import { getPractice } from "@/lib/data";
import { hasSignupAccess } from "@/lib/signup-link";
import { clock, monthDay, timeRange, weekdayLong } from "@/lib/time";
import { PracticeBody } from "./practice-body";

// M2: one practice, reached only through its sign-up link from WhatsApp
// (/p/<slug>?k=<key>). Without a valid, unexpired key it shows nothing.

export const metadata: Metadata = { title: "Practice" };

export default function PracticePage({ params, searchParams }: PageProps<"/p/[slug]">) {
  return (
    <Suspense fallback={<HeaderSkeleton />}>
      <Practice params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Practice({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, { k }] = await Promise.all([params, searchParams]);
  const practice = await getPractice(slug);
  if (!practice || !hasSignupAccess(practice.event, k)) return <NoAccess expired={!!practice && !!k} />;
  const { event, stage } = practice;

  const lockChip =
    stage === "cancelled" ? (
      <Chip kind="red">Cancelled</Chip>
    ) : stage === "past" ? (
      <Chip>Done</Chip>
    ) : stage === "locked" || stage === "teams" ? (
      <Chip kind="red">Locked at {clock(event.locks_at)}</Chip>
    ) : (
      <Chip kind="red">Locks at {clock(event.locks_at)}</Chip>
    );

  return (
    <main className="flex-1">
      <header className="bg-columbia px-4 pb-6 pt-6">
        <div className="mx-auto max-w-xl">
          <Lockup size="sm" />
          <h1 className="mt-5 font-display text-5xl leading-none">{weekdayLong(event.starts_at)} practice</h1>
          <p className="mt-2 text-[15px]">
            {monthDay(event.starts_at)} · {timeRange(event.starts_at, event.ends_at)} · {event.location}
          </p>
          <div className="mt-3">{lockChip}</div>
        </div>
      </header>

      {(stage === "open" || stage === "soon" || stage === "locked" || stage === "waiting") && <AutoRefresh seconds={stage === "open" ? 10 : 30} />}
      {event.opens_at && stage === "soon" && <RefreshAt at={event.opens_at} />}
      {stage === "open" && <RefreshAt at={event.locks_at} />}

      <PracticeBody practice={practice} signupKey={k as string} />
    </main>
  );
}

function HeaderSkeleton() {
  return (
    <main className="flex-1">
      <div className="h-52 bg-columbia" />
      <div className="mx-auto max-w-xl space-y-3 px-4 py-6" aria-busy="true">
        <div className="h-48 animate-pulse rounded-2xl bg-white/70" />
        <div className="h-64 animate-pulse rounded-2xl bg-white/70" />
      </div>
    </main>
  );
}
