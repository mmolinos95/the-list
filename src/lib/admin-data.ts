import "server-only";
import { splitList, stageOf, type Stage } from "./stage";
import { db } from "./supabase";
import type { BoardMember, EventList, EventRow, Member, Signup, Template } from "./types";

// Reads for the board screens. Callers must have checked requireBoard() first:
// these include emails and phone numbers.

export type AdminSignup = Signup & { member: Member };
export type AdminList = EventList & { main: AdminSignup[]; waitlist: AdminSignup[]; gone: AdminSignup[] };
export type AdminPractice = { event: EventRow; lists: AdminList[]; stage: Stage; lateDrops: number };

const ADMIN_SELECT = "*, event_lists(*, signups(*, member:members(id, email, name, phone)))";
type RawEvent = EventRow & { event_lists: (EventList & { signups: AdminSignup[] })[] };

function shape(raw: RawEvent, now: Date): AdminPractice {
  const lists = [...raw.event_lists]
    .sort((a, b) => a.position - b.position)
    .map(({ signups, ...list }) => ({
      ...list,
      ...splitList(signups),
      gone: signups
        .filter((s) => s.status !== "active")
        .sort((a, b) => (b.dropped_at ?? b.removed_at ?? "").localeCompare(a.dropped_at ?? a.removed_at ?? "")),
    }));
  const event: EventRow = { ...raw };
  delete (event as Partial<RawEvent>).event_lists;
  const lateDrops = lists.reduce((n, l) => n + l.gone.filter((s) => s.dropped_late).length, 0);
  return { event, lists, stage: stageOf(event, lists, now), lateDrops };
}

/** Practices that haven't finished, plus today's finished ones, for the next 15 days. */
export async function getAdminPractices(): Promise<AdminPractice[]> {
  const now = new Date();
  const { data, error } = await db()
    .from("events")
    .select(ADMIN_SELECT)
    .gt("ends_at", new Date(now.getTime() - 12 * 3_600_000).toISOString())
    .lt("starts_at", new Date(now.getTime() + 15 * 86_400_000).toISOString())
    .order("starts_at");
  if (error) throw error;
  return (data as RawEvent[]).map((e) => shape(e, now));
}

export async function getAdminPractice(slug: string): Promise<AdminPractice | null> {
  const { data, error } = await db().from("events").select(ADMIN_SELECT).eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? shape(data as RawEvent, new Date()) : null;
}

export async function getTemplates(): Promise<Template[]> {
  const { data, error } = await db().from("templates").select("*, template_lists(*)").order("weekday").order("start_time");
  if (error) throw error;
  return (data as Template[]).map((t) => ({ ...t, template_lists: [...t.template_lists].sort((a, b) => a.position - b.position) }));
}

export async function getBoardMembers(): Promise<BoardMember[]> {
  const { data, error } = await db().from("board_members").select("*").order("role", { ascending: false }).order("created_at");
  if (error) throw error;
  return data as BoardMember[];
}

export type LateDrop = {
  id: string;
  dropped_at: string;
  member: { id: string; name: string; email: string | null };
  list: { name: string; event: Pick<EventRow, "id" | "slug" | "starts_at" | "title"> };
};

export async function getLateDrops(): Promise<(LateDrop & { recent: number })[]> {
  const { data, error } = await db()
    .from("signups")
    .select("id, dropped_at, member:members(id, name, email), list:event_lists(name, event:events(id, slug, starts_at, title))")
    .eq("dropped_late", true)
    .order("dropped_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const drops = data as unknown as LateDrop[];
  // Late drops per person in the last 120 days (about a semester).
  const since = Date.now() - 120 * 86_400_000;
  const recent = new Map<string, number>();
  for (const d of drops) if (Date.parse(d.dropped_at) >= since) recent.set(d.member.id, (recent.get(d.member.id) ?? 0) + 1);
  return drops.map((d) => ({ ...d, recent: recent.get(d.member.id) ?? 0 }));
}

/** Emails that gave up after 5 tries, for the "Retry" banner. */
export async function getFailedEmailCount(): Promise<number> {
  const { count } = await db().from("emails").select("id", { count: "exact", head: true }).eq("status", "failed").gte("attempts", 5);
  return count ?? 0;
}

export async function getAdminPracticeById(id: string): Promise<AdminPractice | null> {
  const { data, error } = await db().from("events").select(ADMIN_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? shape(data as RawEvent, new Date()) : null;
}
