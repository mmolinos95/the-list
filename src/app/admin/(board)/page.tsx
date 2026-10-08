import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Card, Chip, TextLink } from "@/components/ui";
import { getAdminPractices, getFailedEmailCount, getTemplates } from "@/lib/admin-data";
import { requireBoard } from "@/lib/auth";
import { shareFor } from "@/lib/share";
import { monthDay, timeRange, weekdayLong } from "@/lib/time";
import { CopyButton, OpenSignupsButton, RetryEmailsButton } from "./buttons";
import { AdminStageChip, countLine, needsTeams } from "./summary";

// B1: a to-do list, not a dashboard. Each practice shows the one thing it needs next.

export default function BoardHome() {
  return (
    <>
      <h1 className="mb-4 font-display text-4xl">Practices</h1>
      <Suspense fallback={<Skeleton />}>
        <Practices />
      </Suspense>
      <p className="mt-8 text-center text-sm">
        New on the board? <TextLink href="/admin/help">How this works</TextLink>
      </p>
    </>
  );
}

async function Practices() {
  const me = await requireBoard();
  const [practices, failed] = await Promise.all([getAdminPractices(), getFailedEmailCount()]);

  if (practices.length === 0) {
    const templates = await getTemplates();
    return (
      <Card className="text-center">
        <p className="font-display text-3xl">No practices yet</p>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          {templates.length === 0
            ? "Set up your weekly schedule and practices will appear here automatically, two weeks ahead."
            : "Every practice in the weekly schedule is paused, so none are coming up."}
        </p>
        <ButtonLink href="/admin/schedule" className="mt-5">
          {templates.length === 0 ? "Set up schedule" : "Open schedule"}
        </ButtonLink>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {me.name === "" && (
        <div className="rounded-xl bg-columbia-50 p-4 text-sm">
          Welcome to the board! <TextLink href="/admin/board">Add your name</TextLink> so members know who&apos;s messaging them.
        </div>
      )}
      {failed > 0 && <RetryEmailsButton count={failed} />}
      <ul className="space-y-3">
        {practices.map((p) => {
          const href = `/admin/p/${p.event.slug}`;
          const live = p.stage !== "cancelled" && p.stage !== "past";
          return (
            <li key={p.event.id}>
              <Card>
                <Link href={href} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-3xl leading-none">{weekdayLong(p.event.starts_at)}</p>
                      <p className="mt-1 text-sm text-muted">
                        {monthDay(p.event.starts_at)} · {timeRange(p.event.starts_at, p.event.ends_at)} · {p.event.location}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <AdminStageChip practice={p} />
                      {p.lateDrops > 0 && (
                        <Chip kind="red">
                          {p.lateDrops} late {p.lateDrops === 1 ? "drop" : "drops"}
                        </Chip>
                      )}
                    </div>
                  </div>
                  {p.stage !== "cancelled" && <p className="mt-3 text-sm">{p.lists.map((l) => countLine(l, p.event)).join(" · ")}</p>}
                </Link>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {p.stage === "waiting" ? (
                    <OpenSignupsButton eventId={p.event.id} />
                  ) : needsTeams(p) && p.stage === "locked" ? (
                    <ButtonLink href={`${href}/teams`}>Build teams</ButtonLink>
                  ) : p.stage === "teams" ? (
                    <>
                      <span className="text-sm font-semibold">Teams sent ✓</span>
                      <ButtonLink href={href} kind="outline" className="ml-auto">
                        View
                      </ButtonLink>
                    </>
                  ) : (
                    <ButtonLink href={href} kind="outline">
                      View
                    </ButtonLink>
                  )}
                  {live && <CopyButton text={shareFor(p.event, p.lists).post} label="Copy post" kind="ghost" />}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/70" />
      ))}
    </div>
  );
}
