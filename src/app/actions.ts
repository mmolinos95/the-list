"use server";

import type { CountryCode } from "libphonenumber-js";
import { getMySpots, type MySpot } from "@/lib/data";
import { dropToken, verifyDropToken } from "@/lib/drop-link";
import { flushOutboxSoon } from "@/lib/notify/outbox";
import { db, errorCode } from "@/lib/supabase";
import { emailSchema, nameSchema, normalizePhone } from "@/lib/validate";

// Member actions. No login: identity is the email for sign-ups and the
// signed personal link (token) for everything after that.

const FRIENDLY: Record<string, string> = {
  not_open: "Sign-ups aren't open yet. Hang tight.",
  locked: "Sorry, the list has locked. Sign-ups close 2 hours before kickoff.",
  event_cancelled: "This practice was cancelled.",
  event_over: "This practice is already over.",
  event_not_found: "We couldn't find that practice.",
  no_lists: "Pick at least one list.",
  bad_list: "Something's off with that list. Refresh the page and try again.",
};

function friendly(code: string | null) {
  if (!code) return "Something went wrong. Please try again.";
  const known = Object.keys(FRIENDLY).find((k) => code.includes(k));
  return known ? FRIENDLY[known] : "Something went wrong. Please try again.";
}

export type SignUpInput = {
  eventId: string;
  listIds: string[];
  name: string;
  email: string;
  phone: string;
  country: string;
};

export type SignUpResult =
  | { ok: true; token: string | null; created: boolean; spots: MySpot[]; name: string }
  | { ok: false; error: string; field?: "name" | "email" | "phone" };

export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: name.error.issues[0].message, field: "name" };
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return { ok: false, error: email.error.issues[0].message, field: "email" };
  const phone = normalizePhone(input.phone, (input.country || "US") as CountryCode);
  if (!phone) return { ok: false, error: "That phone number doesn't look right. Check the country code.", field: "phone" };
  if (input.listIds.length === 0) return { ok: false, error: FRIENDLY.no_lists };

  const { data, error } = await db().rpc("sign_up", {
    p_event: input.eventId,
    p_lists: input.listIds,
    p_name: name.data,
    p_email: email.data,
    p_phone: phone,
  });
  if (error) return { ok: false, error: friendly(errorCode(error)) };

  const result = data as { member_id: string; created: boolean };
  flushOutboxSoon();
  const { spots } = await getMySpots(input.eventId, result.member_id);
  return {
    ok: true,
    // Only hand out the personal link for spots this person just created, so
    // typing someone else's email can't be used to drop them.
    token: result.created ? dropToken(input.eventId, result.member_id) : null,
    created: result.created,
    spots,
    name: name.data,
  };
}

/** Current spots for whoever holds this personal link. */
export async function myStatus(token: string): Promise<{ name: string | null; spots: MySpot[] } | null> {
  const who = verifyDropToken(token);
  if (!who) return null;
  return getMySpots(who.eventId, who.memberId);
}

export type DropResult = { ok: true; late: boolean; dropped: string[] } | { ok: false; error: string };

export async function dropOut(token: string, listIds: string[]): Promise<DropResult> {
  const who = verifyDropToken(token);
  if (!who) return { ok: false, error: "This link isn't valid. Use the link from your latest email." };
  if (listIds.length === 0) return { ok: false, error: "Pick at least one list to drop." };

  const { data, error } = await db().rpc("drop_signups", { p_event: who.eventId, p_member: who.memberId, p_lists: listIds });
  if (error) return { ok: false, error: friendly(errorCode(error)) };
  flushOutboxSoon();

  const r = data as { dropped: { list: string; late: boolean }[]; locked: boolean };
  return { ok: true, late: r.dropped.some((d) => d.late), dropped: r.dropped.map((d) => d.list) };
}
