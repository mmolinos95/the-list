import type { EventList, EventRow, Signup } from "./types";

/**
 * Where a practice is in its life. Computed from timestamps, never stored
 * (see DATA_MODEL.md, "Stage of a practice").
 */
export type Stage = "cancelled" | "past" | "teams" | "locked" | "open" | "soon" | "waiting";

export function stageOf(event: EventRow, lists: Pick<EventList, "makes_teams" | "teams_sent_at">[], now = new Date()): Stage {
  const t = now.getTime();
  if (event.cancelled_at) return "cancelled";
  if (t >= Date.parse(event.ends_at)) return "past";
  if (lists.some((l) => l.makes_teams && l.teams_sent_at)) return "teams";
  if (t >= Date.parse(event.locks_at)) return "locked";
  if (event.opens_at && t >= Date.parse(event.opens_at)) return "open";
  return event.opens_at ? "soon" : "waiting";
}

/** Signups that are still on a list. */
export const active = (s: Pick<Signup, "status">) => s.status === "active";

const mainKey = (s: Pick<Signup, "promoted_at" | "created_at">) => s.promoted_at ?? s.created_at;

/**
 * Splits a list's sign-ups into the main list and the waitlist, in display
 * order. Mirrors _position() in the database.
 */
export function splitList<T extends Pick<Signup, "id" | "spot" | "status" | "created_at" | "promoted_at">>(signups: T[]) {
  const live = signups.filter(active);
  const byKey = (key: (s: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id);
  return {
    main: live.filter((s) => s.spot === "main").sort(byKey(mainKey)),
    waitlist: live.filter((s) => s.spot === "waitlist").sort(byKey((s) => s.created_at)),
  };
}
