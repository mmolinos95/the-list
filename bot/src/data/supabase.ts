import { createClient } from "@supabase/supabase-js";
import { PRACTICE_SELECT, shapePractice, type Data, type RawEvent } from "./types";

// Data over supabase-js with the secret key, the same way the app's server
// does it: rules run in the existing Postgres functions via rpc().

export function supabaseData(url: string, secretKey: string): Data {
  const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  function check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }

  return {
    async upcoming(now, days = 14) {
      const rows = check(
        await db
          .from("events")
          .select(PRACTICE_SELECT)
          .gt("ends_at", now.toISOString())
          .lt("starts_at", new Date(now.getTime() + days * 86_400_000).toISOString())
          .order("starts_at"),
      );
      return (rows as unknown as RawEvent[]).map((r) => shapePractice(r, now));
    },
    async practice(eventId, now) {
      const row = check(await db.from("events").select(PRACTICE_SELECT).eq("id", eventId).maybeSingle());
      return row ? shapePractice(row as unknown as RawEvent, now) : null;
    },
    async memberByEmail(email) {
      return check(await db.from("members").select("id, email, name, phone").eq("email", email.trim().toLowerCase()).maybeSingle());
    },
    async memberByPhone(phone) {
      const rows = check(
        await db.from("members").select("id, email, name, phone").eq("phone", phone).not("email", "is", null).order("updated_at", { ascending: false }).limit(1),
      );
      return rows?.[0] ?? null;
    },
    async boardMember(email) {
      return check(await db.from("board_members").select("id, email, name, role").eq("email", email.trim().toLowerCase()).maybeSingle());
    },

    signUp: (eventId, listIds, name, email, phone) => rpc("sign_up", { p_event: eventId, p_lists: listIds, p_name: name, p_email: email, p_phone: phone }),
    drop: (eventId, memberId, listIds) => rpc("drop_signups", { p_event: eventId, p_member: memberId, p_lists: listIds }),
    openEvent: (eventId) => rpc("open_event", { p_event: eventId }),
    cancelEvent: (eventId, reason, by) => rpc("cancel_event", { p_event: eventId, p_reason: reason, p_by: by }),
    addSignup: (listId, name, spot, by) => rpc("add_signup", { p_list: listId, p_name: name, p_email: null, p_phone: null, p_spot: spot, p_by: by }),
    shuffleTeams: (eventId) => rpc("shuffle_teams", { p_event: eventId }),

    async sentSince(iso) {
      const { count, error } = await db.from("emails").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", iso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    claimEmails: (limit) => rpc("claim_emails", { p_limit: limit }),
    async markSent(id) {
      check(await db.from("emails").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", id));
    },
    async markFailed(id, error) {
      check(await db.from("emails").update({ status: "failed", last_error: error.slice(0, 500), claimed_at: null }).eq("id", id));
    },
  };
}
