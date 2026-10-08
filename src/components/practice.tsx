import type { PublicList } from "@/lib/data";
import { timeRange } from "@/lib/time";
import type { EventList, EventRow } from "@/lib/types";

export function listSummary(l: Pick<PublicList, "name" | "cap" | "main" | "waitlist">) {
  const n = l.main.length;
  if (n >= l.cap) return l.waitlist.length ? `Full · ${l.waitlist.length} waiting` : "Full";
  return `${n}/${l.cap}`;
}

/** A list's own time ("11 AM–12 PM"), or null when it runs for the whole practice. */
export function listTime(l: Pick<EventList, "starts_at" | "ends_at">, event: Pick<EventRow, "starts_at" | "ends_at">) {
  const same = Date.parse(l.starts_at) === Date.parse(event.starts_at) && Date.parse(l.ends_at) === Date.parse(event.ends_at);
  return same ? null : timeRange(l.starts_at, l.ends_at);
}
