import type { Data, Practice, Spot, SignUpResult, DropResult } from "./data/types";

// Notifications are WhatsApp only for anything the bot does. The database
// functions queue emails in the same call as the change; right after each bot
// write we delete exactly those emails (same event, kind and member, created
// by that call) and the bot tells people in the group instead. Emails queued
// by the website or the board's app are never touched.

/** Someone moved up from the waitlist by the bot's write. Their name is already public on the list. */
export type Promotion = { memberId: string; email: string; name: string; list: string; position: number; cap: number };

const memberIds = (p: Practice | null, which: "main" | "all") =>
  [...new Set((p?.lists ?? []).flatMap((l) => (which === "main" ? l.main : [...l.main, ...l.waitlist]).map((s) => s.member_id)))];

function promotions(rows: { member_id: string | null; to_address: string; payload: Record<string, unknown> }[]): Promotion[] {
  return rows.map((r) => ({
    memberId: r.member_id!,
    email: r.to_address,
    name: String(r.payload.name ?? ""),
    list: String(r.payload.list ?? ""),
    position: Number(r.payload.position ?? 0),
    cap: Number(r.payload.cap ?? 0),
  }));
}

export async function signUpQuietly(data: Data, eventId: string, listIds: string[], name: string, email: string, phone: string | null): Promise<SignUpResult> {
  const r = await data.signUp(eventId, listIds, name, email, phone);
  const at = await data.lastSignupAt(r.member_id);
  if (at) await data.takeEmails({ eventId, kind: "signup", at, memberIds: [r.member_id] });
  return r;
}

/** drop_signups, without its emails: the promotion emails and the late-drop heads-up to the board. */
export async function dropQuietly(data: Data, eventId: string, memberId: string, listIds: string[], now: Date): Promise<DropResult & { promoted: Promotion[] }> {
  const r = await data.drop(eventId, memberId, listIds);
  const at = r.dropped.length ? await data.lastDroppedAt(eventId, memberId) : null;
  if (!at) return { ...r, promoted: [] };
  // Whoever moved up is on a main list now.
  const after = await data.practice(eventId, now);
  const promoted = await data.takeEmails({ eventId, kind: "promoted", at, memberIds: memberIds(after, "main") });
  await data.takeEmails({ eventId, kind: "late_drop", at, memberIds: null });
  return { ...r, promoted: promotions(promoted) };
}

/** cancel_event, without the email to everyone on the list. Returns how many were on it. */
export async function cancelQuietly(data: Data, eventId: string, reason: string, by: string, now: Date): Promise<number> {
  const n = await data.cancelEvent(eventId, reason, by);
  const at = await data.cancelledAt(eventId);
  if (at) await data.takeEmails({ eventId, kind: "cancelled", at, memberIds: memberIds(await data.practice(eventId, now), "all") });
  return n;
}

/** add_signup for a walk-in (no email, so no confirmation), without any promotion emails it caused. */
export async function addQuietly(data: Data, eventId: string, listId: string, name: string, spot: Spot, by: string, now: Date) {
  const r = await data.addSignup(listId, name, spot, by);
  const at = await data.addedAt(r.signup_id);
  if (!at) return { ...r, promoted: [] as Promotion[] };
  const ids = memberIds(await data.practice(eventId, now), "all");
  await data.takeEmails({ eventId, kind: "signup", at, memberIds: ids });
  const promoted = await data.takeEmails({ eventId, kind: "promoted", at, memberIds: ids });
  return { ...r, promoted: promotions(promoted) };
}
