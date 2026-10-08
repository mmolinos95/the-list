import "server-only";
import { listTime } from "@/components/practice";
import { getAdminPractices, type AdminPractice } from "./admin-data";
import type { BoardDailyPayload } from "./notify/templates";
import { shareFor } from "./share";
import { db } from "./supabase";
import { toLocalInputs } from "./time";
import type { EventRow } from "./types";

// The board's morning email, queued by the daily job (6 AM New York). It goes
// out on days with a practice (today's counts, with a one-tap cancel) and on
// days sign-ups open (the WhatsApp post, ready to share). Other days, nothing.

const day = (iso: string | Date) => toLocalInputs(typeof iso === "string" ? iso : iso.toISOString()).date;

const eventJson = (e: EventRow) => ({
  id: e.id,
  title: e.title,
  location: e.location,
  slug: e.slug,
  starts_at: e.starts_at,
  ends_at: e.ends_at,
  locks_at: e.locks_at,
});

export function buildBoardDaily(practices: AdminPractice[], now: Date): BoardDailyPayload {
  const today = day(now);
  return {
    today: practices
      .filter((p) => p.stage !== "cancelled" && p.stage !== "past" && day(p.event.starts_at) === today)
      .map(({ event, lists }) => ({
        event: eventJson(event),
        lists: lists.map((l) => ({ name: l.name, cap: l.cap, main: l.main.length, waitlist: l.waitlist.length, time: listTime(l, event) })),
      })),
    opening: practices
      .filter((p) => p.stage === "soon" && p.event.opens_at && day(p.event.opens_at) === today)
      .map(({ event, lists }) => {
        const { post, whatsapp } = shareFor(event, lists);
        return { event: eventJson(event), opens_at: event.opens_at!, post, whatsapp };
      }),
  };
}

/** Queues today's email for every board member. Returns how many were queued. */
export async function queueBoardDaily(now = new Date()) {
  const supabase = db();
  // Once a day, even if the job is run again by hand.
  const since = new Date(now.getTime() - 20 * 3_600_000).toISOString();
  const { count } = await supabase.from("emails").select("id", { count: "exact", head: true }).eq("kind", "board_daily").gte("created_at", since);
  if (count) return 0;

  const payload = buildBoardDaily(await getAdminPractices(), now);
  if (payload.today.length === 0 && payload.opening.length === 0) return 0;

  const { data: board, error } = await supabase.from("board_members").select("email");
  if (error) throw error;
  const rows = (board ?? []).map((b) => ({ kind: "board_daily", to_address: b.email, payload }));
  if (rows.length === 0) return 0;
  const { error: insertError } = await supabase.from("emails").insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}
