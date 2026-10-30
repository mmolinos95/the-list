import { createClient } from "@supabase/supabase-js";
import { PRACTICE_SELECT, shapePractice, type Data, type EmailRow, type RawEvent } from "./types";

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
      // Newest first; PostgREST can't sort by "has an email", so that's done here.
      const rows = check(await db.from("members").select("id, email, name, phone").eq("phone", phone).order("updated_at", { ascending: false }).limit(20)) ?? [];
      return rows.find((m) => m.email) ?? rows[0] ?? null;
    },
    async membersById(ids) {
      if (ids.length === 0) return [];
      return check(await db.from("members").select("id, email, name, phone").in("id", ids)) ?? [];
    },
    async boardMember(email) {
      return check(await db.from("board_members").select("id, email, name, role").eq("email", email.trim().toLowerCase()).maybeSingle());
    },

    signUp: (eventId, listIds, name, email, phone) => rpc("sign_up", { p_event: eventId, p_lists: listIds, p_name: name, p_email: email, p_phone: phone }),
    signUpByPhone: (eventId, listIds, name, phone) => rpc("sign_up_by_phone", { p_event: eventId, p_lists: listIds, p_name: name, p_phone: phone }),
    drop: (eventId, memberId, listIds) => rpc("drop_signups", { p_event: eventId, p_member: memberId, p_lists: listIds }),
    openEvent: (eventId) => rpc("open_event", { p_event: eventId }),
    cancelEvent: (eventId, reason, by) => rpc("cancel_event", { p_event: eventId, p_reason: reason, p_by: by }),
    addSignup: (listId, name, spot, by) => rpc("add_signup", { p_list: listId, p_name: name, p_email: null, p_phone: null, p_spot: spot, p_by: by }),
    removeSignup: (signupId, by) => rpc("remove_signup", { p_signup: signupId, p_by: by }),
    shuffleTeams: (eventId) => rpc("shuffle_teams", { p_event: eventId }),
    async deleteMember(memberId) {
      check(await db.from("members").delete().eq("id", memberId));
    },

    async lastSignupAt(memberId) {
      return check(await db.from("members").select("last_signup_at").eq("id", memberId).maybeSingle())?.last_signup_at ?? null;
    },
    async lastDroppedAt(eventId, memberId) {
      const rows = check(
        await db
          .from("signups")
          .select("dropped_at, event_lists!inner(event_id)")
          .eq("member_id", memberId)
          .eq("status", "dropped")
          .eq("event_lists.event_id", eventId)
          .order("dropped_at", { ascending: false })
          .limit(1),
      );
      return (rows?.[0]?.dropped_at as string | undefined) ?? null;
    },
    async cancelledAt(eventId) {
      return check(await db.from("events").select("cancelled_at").eq("id", eventId).maybeSingle())?.cancelled_at ?? null;
    },
    async addedAt(signupId) {
      const row = check(await db.from("signups").select("members(created_at)").eq("id", signupId).maybeSingle());
      return (row?.members as unknown as { created_at: string } | null)?.created_at ?? null;
    },
    async removedAt(signupId) {
      return check(await db.from("signups").select("removed_at").eq("id", signupId).maybeSingle())?.removed_at ?? null;
    },
    async takeEmails({ eventId, kind, at, memberIds }) {
      if (memberIds && memberIds.length === 0) return [];
      // PostgREST returns full microseconds; "Z" keeps the value out of URL "+" trouble.
      const base = db.from("emails").delete().eq("event_id", eventId).eq("kind", kind).eq("created_at", at.replace(/\+00(:00)?$/, "Z")).neq("status", "sent");
      const filtered = memberIds ? base.in("member_id", memberIds) : base.is("member_id", null);
      return check(await filtered.select("id, kind, to_address, member_id, event_id, payload")) as EmailRow[];
    },
  };
}
