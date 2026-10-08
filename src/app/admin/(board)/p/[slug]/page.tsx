import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/live";
import { Card, Label } from "@/components/ui";
import { getAdminPractice } from "@/lib/admin-data";
import { requireBoard } from "@/lib/auth";
import { shareFor } from "@/lib/share";
import { clock, monthDay, timeRange, toLocalInputs, weekdayLong } from "@/lib/time";
import { CopyButton, WhatsAppButton } from "../../buttons";
import { AdminStageChip } from "../../summary";
import { PracticeAdmin } from "./practice-admin";

// B2: one practice, from the board's side.

export const metadata: Metadata = { title: "Practice" };

export default function PracticeAdminPage({ params }: PageProps<"/admin/p/[slug]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-white/70" />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: Promise<{ slug: string }> }) {
  await requireBoard();
  const { slug } = await params;
  const practice = await getAdminPractice(slug);
  if (!practice) notFound();
  const { event, stage } = practice;
  const form = {
    date: toLocalInputs(event.starts_at).date,
    location: event.location,
    lists: practice.lists.map((l) => ({ id: l.id, name: l.name, start: toLocalInputs(l.starts_at).time, end: toLocalInputs(l.ends_at).time, cap: String(l.cap) })),
  };
  const live = stage !== "past" && stage !== "cancelled";
  const share = live ? shareFor(event, practice.lists) : null;

  return (
    <>
      {live && <AutoRefresh seconds={20} />}
      <Link href="/admin" className="text-sm font-semibold text-core hover:underline">
        ← All practices
      </Link>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl leading-none">{weekdayLong(event.starts_at)} practice</h1>
          <p className="mt-1 text-[15px] text-muted">
            {monthDay(event.starts_at)} · {timeRange(event.starts_at, event.ends_at)} · {event.location}
          </p>
          <p className="mt-1 text-sm text-muted">
            {stage === "cancelled"
              ? `Cancelled${event.cancel_reason ? `: ${event.cancel_reason}` : ""}`
              : `Locks at ${clock(event.locks_at)}${event.opens_at ? ` · Opens ${weekdayLong(event.opens_at).slice(0, 3)} ${clock(event.opens_at)}` : " · Opens when you press the button"}`}
          </p>
        </div>
        <AdminStageChip practice={practice} />
      </div>
      {share && (
        <Card className="mt-5">
          <Label>Sign-up link</Label>
          <p className="mt-1 truncate text-sm text-muted">{share.url}</p>
          <p className="mt-1 text-xs text-muted">Only people with this link can sign up. It stops working when the practice ends.</p>
          <WhatsAppButton href={share.whatsapp} className="mt-3 w-full" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <CopyButton text={share.post} label="Copy post" />
            <CopyButton text={share.url} label="Copy link" />
          </div>
        </Card>
      )}
      <PracticeAdmin
        practice={practice}
        lockTime={clock(event.locks_at)}
        form={form}
      />
    </>
  );
}
