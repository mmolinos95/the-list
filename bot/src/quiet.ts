import type { Data, Practice, Spot, SignUpResult, DropResult } from "./data/types";

// Notifications are WhatsApp only for anything the bot does. The database
// functions queue emails in the same call as the change; right after each bot
// write we delete exactly those emails (same event, kind and member, created
// by that call) and the bot tells people in the group instead. Emails queued
// by the website or the board's app are never touched.

/** Someone moved up from the waitlist by the bot's write. Their name is already public on the list. */
export type Promotion = { memberId: string; email: string | null; phone: string | null; name: string; list: string; position: number; cap: number };

const memberIds = (p: Practice | null, which: "main" | "all") =>
  [...new Set((p?.lists ?? []).flatMap((l) => (which === "main" ? l.main : [...l.main, ...l.waitlist]).map((s) => s.member_id)))];

/**
 * Who moved up: on a waitlist before the write, on a main list after. Found from
 * the lists, not the promotion emails, since members without an email get none.
 */
async function promotions(data: Data, before: Practice | null, after: Practice | null): Promise<Promotion[]> {
  const waiting = new Set((before?.lists ?? []).flatMap((l) => l.waitlist.map((s) => s.id)));
  const moved = (after?.lists ?? []).flatMap((l) => l.main.flatMap((s, i) => (waiting.has(s.id) ? [{ s, l, position: i + 1 }] : [])));
  if (moved.length === 0) return [];
  const contacts = new Map((await data.membersById([...new Set(moved.map((x) => x.s.member_id))])).map((m) => [m.id, m]));
  return moved.map(({ s, l, position }) => ({
    memberId: s.member_id,
    email: contacts.get(s.member_id)?.email ?? null,
    phone: contacts.get(s.member_id)?.phone ?? null,
    name: s.name,
    list: l.name,
    position,
    cap: l.cap,
  }));
}

export async function signUpQuietly(data: Data, eventId: string, listIds: string[], name: string, email: string, phone: string | null): Promise<SignUpResult> {
  return quietSignup(data, eventId, await data.signUp(eventId, listIds, name, email, phone));
}

/** sign_up_by_phone: for members known by their WhatsApp phone. Website members with that phone keep their record. */
export async function signUpByPhoneQuietly(data: Data, eventId: string, listIds: string[], name: string | null, phone: string): Promise<SignUpResult> {
  return quietSignup(data, eventId, await data.signUpByPhone(eventId, listIds, name, phone));
}

/** Deletes the sign-up confirmation email the call queued, if the member has an email. */
async function quietSignup(data: Data, eventId: string, r: SignUpResult) {
  const at = await data.lastSignupAt(r.member_id);
  if (at) await data.takeEmails({ eventId, kind: "signup", at, memberIds: [r.member_id] });
  return r;
}

/** drop_signups, without its emails: the promotion emails and the late-drop heads-up to the board. */
export async function dropQuietly(data: Data, eventId: string, memberId: string, listIds: string[], now: Date): Promise<DropResult & { promoted: Promotion[] }> {
  const before = await data.practice(eventId, now);
  const r = await data.drop(eventId, memberId, listIds);
  const at = r.dropped.length ? await data.lastDroppedAt(eventId, memberId) : null;
  if (!at) return { ...r, promoted: [] };
  // Whoever moved up is on a main list now.
  const after = await data.practice(eventId, now);
  await data.takeEmails({ eventId, kind: "promoted", at, memberIds: memberIds(after, "main") });
  await data.takeEmails({ eventId, kind: "late_drop", at, memberIds: null });
  return { ...r, promoted: await promotions(data, before, after) };
}

/** cancel_event, without the email to everyone on the list. Returns how many were on it. */
export async function cancelQuietly(data: Data, eventId: string, reason: string, by: string, now: Date): Promise<number> {
  const n = await data.cancelEvent(eventId, reason, by);
  const at = await data.cancelledAt(eventId);
  if (at) await data.takeEmails({ eventId, kind: "cancelled", at, memberIds: memberIds(await data.practice(eventId, now), "all") });
  return n;
}

/** remove_signup for each of these sign-ups, without the promotion emails it caused. */
export async function removeQuietly(data: Data, eventId: string, signupIds: string[], by: string, now: Date) {
  const before = await data.practice(eventId, now);
  for (const id of signupIds) {
    await data.removeSignup(id, by);
    const at = await data.removedAt(id);
    if (at) await data.takeEmails({ eventId, kind: "promoted", at, memberIds: memberIds(await data.practice(eventId, now), "main") });
  }
  return promotions(data, before, await data.practice(eventId, now));
}

/** add_signup for a walk-in (no email, so no confirmation), without any promotion emails it caused. */
export async function addQuietly(data: Data, eventId: string, listId: string, name: string, spot: Spot, by: string, now: Date) {
  const before = await data.practice(eventId, now);
  const r = await data.addSignup(listId, name, spot, by);
  const at = await data.addedAt(r.signup_id);
  if (!at) return { ...r, promoted: [] as Promotion[] };
  const after = await data.practice(eventId, now);
  const ids = memberIds(after, "all");
  await data.takeEmails({ eventId, kind: "signup", at, memberIds: ids });
  await data.takeEmails({ eventId, kind: "promoted", at, memberIds: ids });
  return { ...r, promoted: await promotions(data, before, after) };
}
