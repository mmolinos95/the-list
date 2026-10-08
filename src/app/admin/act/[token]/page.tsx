import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { Lockup } from "@/components/brand";
import { ButtonLink, Card } from "@/components/ui";
import { getAdminPracticeById, type AdminPractice } from "@/lib/admin-data";
import { verifyBoardAction } from "@/lib/board-action";
import { db } from "@/lib/supabase";
import { clock, dayDate, timeRange, weekdayLong } from "@/lib/time";
import { recipients } from "../../(board)/summary";
import { CancelForm, PromoteForm } from "./act-form";

// One-tap actions from board emails (late drop → promote next; morning email →
// cancel). No login: the signed link is the permission. Opening the page never
// changes anything; the button does.

export const metadata: Metadata = { title: "Board", robots: { index: false } };

export default function ActPage({ params }: PageProps<"/admin/act/[token]">) {
  return (
    <main className="flex-1">
      <header className="bg-columbia px-4 py-6">
        <div className="mx-auto max-w-xl">
          <Lockup size="sm" />
        </div>
      </header>
      <div className="mx-auto max-w-xl px-4 py-6">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white/70" />}>
          <Act params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Act({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const v = verifyBoardAction(token);
  if (!v.ok) return <Note title={v.reason === "expired" ? "This link has expired" : "This link doesn't work"}>Open the practice in the app instead.</Note>;
  const { action } = v;

  const { data: member } = await db().from("board_members").select("id").eq("email", action.to.toLowerCase()).maybeSingle();
  if (!member) return <Note title="You're no longer on the board">Ask a president to add you back if that&apos;s a mistake.</Note>;

  const practice = await getAdminPracticeById(action.e);
  if (!practice) return <Note title="This practice is gone">It was removed from the schedule.</Note>;
  const { event, stage } = practice;
  const title = `${weekdayLong(event.starts_at)} practice`;
  const when = `${dayDate(event.starts_at)} · ${timeRange(event.starts_at, event.ends_at)} · ${event.location}`;
  const open = <OpenPractice practice={practice} />;

  if (stage === "cancelled") return <Note title={`${title} is off`} footer={open}>{event.cancel_reason ? `Cancelled: ${event.cancel_reason}.` : "It was already cancelled."}</Note>;
  if (stage === "past") return <Note title={`${title} is over`} footer={open}>{when}</Note>;

  if (action.a === "cancel") {
    if (hasStarted(event.starts_at)) return <Note title={`${title} has started`} footer={open}>It can&apos;t be cancelled from here anymore.</Note>;
    return <CancelForm token={token} title={title} when={when} emailCount={recipients(practice.lists, true)} practiceHref={`/admin/p/${event.slug}`} />;
  }

  const list = practice.lists.find((l) => l.name === action.l);
  if (!list) return <Note title="That list is gone" footer={open}>The practice&apos;s lists were changed.</Note>;
  if (stage === "open" || stage === "soon" || stage === "waiting") {
    return (
      <Note title="Nothing to do yet" footer={open}>
        The {list.name} list locks at {clock(event.locks_at)}. Until then, the waitlist moves up on its own.
      </Note>
    );
  }
  const next = list.waitlist[0];
  if (!next) {
    return (
      <Note title={`Nobody's waiting for ${list.name}`} footer={open}>
        The waitlist is empty, so there&apos;s nobody to move up. You can add a walk-in from the practice page.
      </Note>
    );
  }
  return (
    <PromoteForm
      token={token}
      signupId={next.id}
      name={next.member.name}
      list={list.name}
      count={`${list.main.length}/${list.cap}`}
      waiting={list.waitlist.length}
      title={title}
      when={when}
      practiceHref={`/admin/p/${event.slug}`}
    />
  );
}

// Request-time check; the page is rendered per request (connection() above).
const hasStarted = (startsAt: string) => Date.parse(startsAt) <= Date.now();

function OpenPractice({ practice }: { practice: AdminPractice }) {
  return (
    <ButtonLink href={`/admin/p/${practice.event.slug}`} kind="outline" className="mt-5">
      Open the practice
    </ButtonLink>
  );
}

function Note({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <p className="font-display text-4xl leading-none">{title}</p>
      <p className="mt-3 text-muted">{children}</p>
      {footer}
    </Card>
  );
}
