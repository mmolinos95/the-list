import { listTime } from "@/components/practice";
import { Chip } from "@/components/ui";
import type { AdminList, AdminPractice } from "@/lib/admin-data";
import { relativeDay } from "@/lib/time";

/** "Games 12/40 + 3 waiting", with the list's own time ("Skills 10–11 AM 12/40") when it has one. */
export function countLine(l: Pick<AdminList, "name" | "cap" | "main" | "waitlist" | "starts_at" | "ends_at">, event: AdminPractice["event"]) {
  const time = listTime(l, event);
  return `${l.name}${time ? ` ${time}` : ""} ${l.main.length}/${l.cap}${l.waitlist.length ? ` + ${l.waitlist.length} waiting` : ""}`;
}

/** How many people an email to this practice reaches (each person once, walk-ins without an email skipped). */
export function recipients(lists: Pick<AdminList, "main" | "waitlist">[], includeWaitlist: boolean) {
  const ids = new Set<string>();
  for (const l of lists) for (const s of [...l.main, ...(includeWaitlist ? l.waitlist : [])]) if (s.member.email) ids.add(s.member.id);
  return ids.size;
}

export const needsTeams = (p: AdminPractice) =>
  (p.stage === "locked" || p.stage === "open") && p.lists.some((l) => l.makes_teams && !l.teams_sent_at && l.main.length > 0);

/** Status chip for the board, which adds a few states members don't see. */
export function AdminStageChip({ practice }: { practice: AdminPractice }) {
  const { event, stage } = practice;
  switch (stage) {
    case "cancelled":
      return <Chip kind="red">Cancelled</Chip>;
    case "past":
      return <Chip>Done</Chip>;
    case "teams":
      return <Chip kind="dark">Teams sent</Chip>;
    case "locked":
      return needsTeams(practice) ? <Chip kind="gold">Needs teams</Chip> : <Chip kind="red">Locked</Chip>;
    case "open":
      return <Chip kind="core">Open</Chip>;
    case "soon":
      return <Chip>Opens {relativeDay(event.opens_at!)}</Chip>;
    case "waiting":
      return <Chip kind="gold">Not open yet</Chip>;
  }
}
