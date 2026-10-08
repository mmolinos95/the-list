import "server-only";
import { connection } from "next/server";
import { splitList, stageOf, type Stage } from "./stage";
import { db } from "./supabase";
import type { EventList, EventRow, Signup } from "./types";

// Public reads. Only names leave the server, never emails or phone numbers.
// `team` here is the team that was emailed (team_sent), never a draft.

export type PublicSignup = Pick<Signup, "id" | "spot" | "status" | "created_at" | "promoted_at" | "team"> & { name: string };
export type PublicList = EventList & { main: PublicSignup[]; waitlist: PublicSignup[] };
export type Practice = { event: EventRow; lists: PublicList[]; stage: Stage };

const PUBLIC_SELECT = "*, event_lists(*, signups(id, spot, status, created_at, promoted_at, team:team_sent, members(name)))";

type RawSignup = Omit<PublicSignup, "name"> & { members: { name: string } | null };
type RawEvent = EventRow & { event_lists: (EventList & { signups: RawSignup[] })[] };

function shape(raw: RawEvent, now: Date): Practice {
  const lists = [...raw.event_lists]
    .sort((a, b) => a.position - b.position)
    .map(({ signups, ...list }) => {
      const rows = signups.map(({ members, ...s }) => ({ ...s, name: members?.name ?? "" }));
      return { ...list, ...splitList(rows) };
    });
  const event: EventRow = { ...raw };
  delete (event as Partial<RawEvent>).event_lists;
  return { event, lists, stage: stageOf(event, lists, now) };
}

export async function getPractice(slug: string): Promise<Practice | null> {
  await connection();
  const { data, error } = await db().from("events").select(PUBLIC_SELECT).eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? shape(data as RawEvent, new Date()) : null;
}

export type MySpot = {
  signupId: string;
  listId: string;
  list: string;
  spot: "main" | "waitlist";
  position: number;
  cap: number;
  team: Signup["team"];
  teamsOut: boolean;
};

/** One member's current spots in a practice, with live positions. */
export async function getMySpots(eventId: string, memberId: string) {
  const supabase = db();
  const [{ data: member }, { data: lists, error }] = await Promise.all([
    supabase.from("members").select("name").eq("id", memberId).maybeSingle(),
    supabase.from("event_lists").select("*, signups(id, member_id, spot, status, created_at, promoted_at, team:team_sent)").eq("event_id", eventId).order("position"),
  ]);
  if (error) throw error;

  const spots: MySpot[] = [];
  for (const l of (lists ?? []) as (EventList & { signups: (Signup & { member_id: string })[] })[]) {
    const { main, waitlist } = splitList(l.signups);
    for (const [kind, arr] of [["main", main], ["waitlist", waitlist]] as const) {
      const i = arr.findIndex((s) => s.member_id === memberId);
      if (i >= 0) {
        spots.push({
          signupId: arr[i].id,
          listId: l.id,
          list: l.name,
          spot: kind,
          position: i + 1,
          cap: l.cap,
          team: kind === "main" && l.makes_teams && l.teams_sent_at ? arr[i].team : null,
          teamsOut: !!(l.makes_teams && l.teams_sent_at),
        });
      }
    }
  }
  return { name: member?.name ?? null, spots };
}
