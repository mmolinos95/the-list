"use server";

import { verifyBoardAction } from "@/lib/board-action";
import { flushOutboxSoon } from "@/lib/notify/outbox";
import { db } from "@/lib/supabase";
import type { BoardMember } from "@/lib/types";

// The buttons on the one-tap pages (/admin/act/<token>). No login: the signed
// link is the permission, checked again here along with board membership.

export type ActResult = { ok: true; message: string } | { ok: false; error: string };

const FRIENDLY: [string, string][] = [
  ["auto_promotion_active", "The list hasn't locked yet, so the waitlist still moves up on its own."],
  ["not_on_waitlist", "They're no longer on the waitlist. Reload the page to see who's next."],
  ["already_cancelled", "This practice was already cancelled."],
  ["event_cancelled", "This practice was cancelled."],
];

async function boardMemberFor(token: string, kind: "promote" | "cancel") {
  const v = verifyBoardAction(token);
  if (!v.ok) throw new Error(v.reason === "expired" ? "This link has expired." : "This link doesn't work.");
  if (v.action.a !== kind) throw new Error("This link doesn't work.");
  const { data } = await db().from("board_members").select("*").eq("email", v.action.to.toLowerCase()).maybeSingle();
  if (!data) throw new Error("You're no longer on the board.");
  return { action: v.action, me: data as BoardMember };
}

async function run(fn: () => Promise<string>): Promise<ActResult> {
  try {
    const message = await fn();
    flushOutboxSoon();
    return { ok: true, message };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const known = FRIENDLY.find(([code]) => text.includes(code));
    if (known) return { ok: false, error: known[1] };
    if (/^(This link|You're no longer)/.test(text)) return { ok: false, error: text };
    console.error("Email action failed", err);
    return { ok: false, error: "Something went wrong. Open the practice in the app instead." };
  }
}

export async function actPromote(token: string, signupId: string) {
  return run(async () => {
    const { action, me } = await boardMemberFor(token, "promote");
    // The person shown on the page must be on this practice's list.
    const { data: signup } = await db()
      .from("signups")
      .select("id, member:members(name), list:event_lists!inner(name, event_id)")
      .eq("id", signupId)
      .eq("list.event_id", action.e)
      .maybeSingle();
    if (!signup) throw new Error("This link doesn't work.");
    const { error } = await db().rpc("promote_signup", { p_signup: signupId, p_by: me.id });
    if (error) throw new Error(error.message);
    const name = (signup.member as unknown as { name: string } | null)?.name ?? "They";
    return `${name} is in. They'll get an email.`;
  });
}

export async function actCancel(token: string, reason: string) {
  return run(async () => {
    const { action, me } = await boardMemberFor(token, "cancel");
    const { data, error } = await db().rpc("cancel_event", { p_event: action.e, p_reason: reason.trim().slice(0, 300), p_by: me.id });
    if (error) throw new Error(error.message);
    const n = Number(data ?? 0);
    return n ? `Practice cancelled. We're emailing ${n} ${n === 1 ? "player" : "players"}.` : "Practice cancelled. Nobody was signed up, so no emails went out.";
  });
}
