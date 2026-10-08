import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Lockup } from "@/components/brand";
import { ButtonLink, Card } from "@/components/ui";
import { getMySpots } from "@/lib/data";
import { verifyDropToken } from "@/lib/drop-link";
import { stageOf } from "@/lib/stage";
import { db } from "@/lib/supabase";
import { clock, monthDay, timeRange, weekdayLong } from "@/lib/time";
import type { EventRow } from "@/lib/types";
import { DropForm } from "./drop-form";

// M3: drop out, from the email link or the practice page.

export const metadata: Metadata = { title: "Drop out", robots: { index: false } };

export default function DropPage({ params }: PageProps<"/drop/[token]">) {
  return (
    <main className="flex-1">
      <header className="bg-columbia px-4 py-6">
        <div className="mx-auto max-w-xl">
          <Link href="/" aria-label="All practices">
            <Lockup size="sm" />
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-xl px-4 py-6">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white/70" />}>
          <Drop params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Drop({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const who = verifyDropToken(token);
  if (!who) return <Invalid />;

  const { data: event } = await db().from("events").select("*, event_lists(makes_teams, teams_sent_at)").eq("id", who.eventId).maybeSingle();
  if (!event) return <Invalid />;
  const { event_lists, ...ev } = event as EventRow & { event_lists: { makes_teams: boolean; teams_sent_at: string | null }[] };
  const stage = stageOf(ev, event_lists);
  const { name, spots } = await getMySpots(who.eventId, who.memberId);
  const when = `${weekdayLong(ev.starts_at)}, ${monthDay(ev.starts_at)} · ${timeRange(ev.starts_at, ev.ends_at)}`;

  if (stage === "cancelled" || stage === "past") {
    return (
      <Card>
        <p className="font-display text-4xl">{stage === "cancelled" ? "Practice is off" : "This practice is over"}</p>
        <p className="mt-2 text-muted">{when}. There&apos;s nothing to drop.</p>
        <ButtonLink href="/" kind="outline" className="mt-5">
          See upcoming practices
        </ButtonLink>
      </Card>
    );
  }

  if (spots.length === 0) {
    return (
      <Card>
        <p className="font-display text-4xl">You&apos;re not on the list</p>
        <p className="mt-2 text-muted">
          You&apos;re not signed up for {weekdayLong(ev.starts_at)} practice ({when}) right now.
        </p>
        <ButtonLink href={`/p/${ev.slug}`} kind="outline" className="mt-5">
          Go to the practice
        </ButtonLink>
      </Card>
    );
  }

  return (
    <DropForm
      token={token}
      firstName={name?.split(" ")[0] ?? ""}
      title={`${weekdayLong(ev.starts_at)} practice`}
      when={when}
      slug={ev.slug}
      locked={stage === "locked" || stage === "teams"}
      lockTime={clock(ev.locks_at)}
      spots={spots}
    />
  );
}

function Invalid() {
  return (
    <Card>
      <p className="font-display text-4xl">This link doesn&apos;t work</p>
      <p className="mt-2 text-muted">It may be incomplete. Try the link from your latest email, or open the practice page.</p>
      <ButtonLink href="/" kind="outline" className="mt-5">
        See upcoming practices
      </ButtonLink>
    </Card>
  );
}
