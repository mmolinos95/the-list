import { stageOf } from "../../src/lib/stage";
import type { ListInfo, Practice, SignupRow } from "../src/data/types";

// Hand-built practices for pure tests (no database).

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

export function signup(name: string, over: Partial<SignupRow> = {}): SignupRow {
  return {
    id: id(),
    member_id: id(),
    spot: "main",
    status: "active",
    created_at: "2026-10-20T12:00:00Z",
    promoted_at: null,
    team: null,
    team_sent: null,
    name,
    ...over,
  };
}

export function fakePractice(
  startsAt: string,
  opts: {
    hours?: number;
    lists?: Partial<ListInfo>[];
    opensAt?: string | null;
    cancelled?: string | null;
    reason?: string | null;
    now?: Date;
    slug?: string;
  } = {},
): Practice {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + (opts.hours ?? 2) * 3_600_000);
  const eventId = id();
  const event = {
    id: eventId,
    template_id: null,
    title: "Practice",
    location: "Riverside Park",
    slug: opts.slug ?? `slug-${eventId}`,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    opens_at: opts.opensAt === undefined ? new Date(start.getTime() - 86_400_000).toISOString() : opts.opensAt,
    locks_at: new Date(start.getTime() - 7_200_000).toISOString(),
    edited_at: null,
    cancelled_at: opts.cancelled ?? null,
    cancel_reason: opts.reason ?? null,
  };
  const lists: ListInfo[] = (opts.lists ?? [{ name: "Games" }]).map((l, i) => ({
    id: id(),
    event_id: eventId,
    name: "Games",
    cap: 40,
    makes_teams: false,
    position: i,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    teams_sent_at: null,
    main: [],
    waitlist: [],
    ...l,
  }));
  return { event, lists, stage: stageOf(event, lists, opts.now ?? new Date(start.getTime() - 3 * 86_400_000)) };
}
