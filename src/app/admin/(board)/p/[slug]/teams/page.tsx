import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { getAdminPractice } from "@/lib/admin-data";
import { requireBoard } from "@/lib/auth";
import { monthDay, weekdayLong } from "@/lib/time";
import { TeamBuilder } from "./team-builder";

// B6: split the main list of every "split into teams" list into four colors.

export const metadata: Metadata = { title: "Teams" };

export default function TeamsPage({ params }: PageProps<"/admin/p/[slug]/teams">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-white/70" />}>
      <Teams params={params} />
    </Suspense>
  );
}

async function Teams({ params }: { params: Promise<{ slug: string }> }) {
  await requireBoard();
  const { slug } = await params;
  const practice = await getAdminPractice(slug);
  if (!practice) notFound();
  const { event } = practice;
  const lists = practice.lists.filter((l) => l.makes_teams);

  return (
    <>
      <Link href={`/admin/p/${slug}`} className="text-sm font-semibold text-core hover:underline">
        ← {weekdayLong(event.starts_at)} practice
      </Link>
      <h1 className="mt-3 font-display text-5xl leading-none">Teams</h1>
      <p className="mt-1 text-[15px] text-muted">
        {weekdayLong(event.starts_at)}, {monthDay(event.starts_at)} · {lists.map((l) => l.name).join(", ") || "No lists make teams"}
      </p>
      {lists.length === 0 ? (
        <Card className="mt-5">
          <p>None of this practice&apos;s lists are set to split into teams. A president can turn that on in the weekly schedule.</p>
        </Card>
      ) : practice.stage === "cancelled" ? (
        <Card className="mt-5">This practice was cancelled.</Card>
      ) : (
        <TeamBuilder eventId={event.id} lists={lists} />
      )}
    </>
  );
}
