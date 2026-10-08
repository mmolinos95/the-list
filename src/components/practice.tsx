import type { Practice, PublicList } from "@/lib/data";
import { relativeDay } from "@/lib/time";
import { Chip } from "./ui";

export function listSummary(l: Pick<PublicList, "name" | "cap" | "main" | "waitlist">) {
  const n = l.main.length;
  if (n >= l.cap) return l.waitlist.length ? `Full · ${l.waitlist.length} waiting` : "Full";
  return `${n}/${l.cap}`;
}

/** The one status label for a practice, as on the home cards and headers. */
export function StageChip({ practice }: { practice: Practice }) {
  const { event, lists, stage } = practice;
  switch (stage) {
    case "cancelled":
      return <Chip kind="red">Cancelled</Chip>;
    case "past":
      return <Chip>Done</Chip>;
    case "teams":
      return <Chip kind="dark">Teams are out</Chip>;
    case "locked":
      return <Chip kind="red">Locked</Chip>;
    case "waiting":
      return <Chip kind="neutral">Opens soon</Chip>;
    case "soon":
      return <Chip kind="neutral">Opens {relativeDay(event.opens_at!)}</Chip>;
    case "open": {
      const allFull = lists.every((l) => l.main.length >= l.cap);
      const waiting = lists.reduce((n, l) => n + l.waitlist.length, 0);
      if (allFull) return <Chip kind="gold">Full · {waiting} waiting</Chip>;
      return <Chip kind="core">Open</Chip>;
    }
  }
}
