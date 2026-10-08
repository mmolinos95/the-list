"use server";

import type { CountryCode } from "libphonenumber-js";
import { refresh } from "next/cache";
import { boardOnly, NotAllowed, presidentOnly } from "@/lib/auth";
import { flushOutboxSoon } from "@/lib/notify/outbox";
import { db } from "@/lib/supabase";
import { fromLocalInputs } from "@/lib/time";
import type { BoardRole, Spot, TeamColor } from "@/lib/types";
import { emailSchema, nameSchema, normalizePhone } from "@/lib/validate";

// Board actions. Each one checks who is asking, calls one database function
// (where the rules live), then sends any queued emails after the response.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

class Problem extends Error {}

const FRIENDLY: [string, string][] = [
  ["last_president", "The club needs at least one president."],
  ["already_on_list", "They're already on that list."],
  ["auto_promotion_active", "Promotion is automatic until the list locks."],
  ["not_on_waitlist", "They're no longer on the waitlist. The page has been refreshed."],
  ["not_active", "They're no longer on the list. The page has been refreshed."],
  ["already_cancelled", "This practice was already cancelled."],
  ["event_cancelled", "This practice was cancelled."],
  ["board_members_email_key", "That email already has access."],
  ["end_time", "The end time has to be after the start time."],
  ["ends_at", "The end time has to be after the start time."],
  ["cap", "Caps have to be at least 1."],
];

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    flushOutboxSoon();
    refresh();
    return { ok: true, message: message || undefined };
  } catch (err) {
    if (err instanceof NotAllowed || err instanceof Problem) return { ok: false, error: err.message };
    const text = err instanceof Error ? err.message : String(err);
    const known = FRIENDLY.find(([code]) => text.includes(code));
    if (!known) console.error("Board action failed", err);
    refresh();
    return { ok: false, error: known ? known[1] : "Something went wrong. Refresh and try again." };
  }
}

async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const players = (n: number) => `${n} ${n === 1 ? "player" : "players"}`;

// Running a practice ------------------------------------------------------------

export async function openSignups(eventId: string) {
  return run(async () => {
    await boardOnly();
    await rpc("open_event", { p_event: eventId });
    return "Sign-ups are open. Post the link in WhatsApp!";
  });
}

export async function removeSignup(signupId: string) {
  return run(async () => {
    const me = await boardOnly();
    const r = await rpc<{ promoted: number }>("remove_signup", { p_signup: signupId, p_by: me.id });
    return r.promoted ? "Removed. The next person on the waitlist moved up and got an email." : "Removed from the list.";
  });
}

export async function promoteSignup(signupId: string) {
  return run(async () => {
    const me = await boardOnly();
    await rpc("promote_signup", { p_signup: signupId, p_by: me.id });
    return "Promoted. They'll get an email.";
  });
}

export type AddInput = { listId: string; name: string; email: string; phone: string; country: string; spot: Spot };

export async function addSignup(input: AddInput) {
  return run(async () => {
    const me = await boardOnly();
    const name = nameSchema.safeParse(input.name);
    if (!name.success) throw new Problem(name.error.issues[0].message);
    let email: string | null = null;
    if (input.email.trim()) {
      const e = emailSchema.safeParse(input.email);
      if (!e.success) throw new Problem("That email doesn't look right. Leave it empty if you don't know it.");
      email = e.data;
    }
    let phone: string | null = null;
    if (input.phone.trim()) {
      phone = normalizePhone(input.phone, (input.country || "US") as CountryCode);
      if (!phone) throw new Problem("That phone number doesn't look right. Leave it empty if you don't know it.");
    }
    const r = await rpc<{ spot: Spot }>("add_signup", {
      p_list: input.listId,
      p_name: name.data,
      p_email: email,
      p_phone: phone,
      p_spot: input.spot,
      p_by: me.id,
    });
    const where = r.spot === "main" ? "the main list" : "the waitlist";
    return email ? `Added to ${where}. They'll get a confirmation email.` : `Added to ${where}.`;
  });
}

export type EditInput = {
  eventId: string;
  date: string;
  location: string;
  lists: { listId: string; start: string; end: string; cap: number }[];
  notify: boolean;
  /** Also copy the place, list times and caps to the weekly schedule. */
  forFuture: boolean;
};

const HHMM = /^\d{2}:\d{2}$/;

export async function editPractice(input: EditInput) {
  return run(async () => {
    await boardOnly();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Problem("Pick a date.");
    if (input.lists.length === 0 || input.lists.some((l) => !HHMM.test(l.start) || !HHMM.test(l.end))) throw new Problem("Fill in every start and end time.");
    if (input.lists.some((l) => l.end <= l.start)) throw new Problem("The end time has to be after the start time.");
    if (!input.location.trim()) throw new Problem("Add a place.");
    if (input.lists.some((l) => !Number.isInteger(l.cap) || l.cap < 1 || l.cap > 500)) throw new Problem("Caps have to be between 1 and 500.");

    const supabase = db();
    const { data: event, error } = await supabase
      .from("events")
      .select("template_id, template:templates(weekday), event_lists(id, name, cap, position)")
      .eq("id", input.eventId)
      .single();
    if (error) throw new Error(error.message);
    const current = event.event_lists as { id: string; name: string; cap: number; position: number }[];
    const weekday = (event.template as unknown as { weekday: number } | null)?.weekday;
    if (input.forFuture && weekday !== new Date(`${input.date}T12:00:00Z`).getUTCDay()) {
      throw new Problem("This practice moved to another day, so it can't update the weekly schedule. Edit the schedule instead.");
    }

    const emailed = await rpc<number>("edit_event", {
      p_event: input.eventId,
      p_location: input.location.trim(),
      p_lists: input.lists.map((l) => ({
        id: l.listId,
        starts_at: fromLocalInputs(input.date, l.start),
        ends_at: fromLocalInputs(input.date, l.end),
      })),
      p_notify: input.notify,
    });
    let promoted = 0;
    for (const c of input.lists) {
      const list = current.find((l) => l.id === c.listId);
      if (list && list.cap !== c.cap) promoted += await rpc<number>("set_list_cap", { p_list: c.listId, p_cap: c.cap });
    }
    const parts = ["Saved."];
    if (emailed) parts.push(`Emailed ${players(emailed)}.`);
    if (promoted) parts.push(`${players(promoted)} moved up from the waitlist.`);
    if (input.forFuture && event.template_id) parts.push(await copyToTemplate(event.template_id, input, current));
    return parts.join(" ");
  });
}

/** "Also use for future <weekday>s": lists are matched to the schedule's by position and name. */
async function copyToTemplate(templateId: string, input: EditInput, lists: { id: string; name: string; position: number }[]) {
  const supabase = db();
  const { data, error } = await supabase.from("template_lists").select("id, name, position, start_time, end_time").eq("template_id", templateId);
  if (error) throw new Error(error.message);
  const rows = data as { id: string; name: string; position: number; start_time: string; end_time: string }[];
  let missed = 0;
  for (const l of input.lists) {
    const list = lists.find((x) => x.id === l.listId);
    const row = list && rows.find((r) => r.position === list.position && r.name === list.name);
    if (!row) {
      missed++;
      continue;
    }
    const { error: e } = await supabase.from("template_lists").update({ start_time: l.start, end_time: l.end, cap: l.cap }).eq("id", row.id);
    if (e) throw new Error(e.message);
    Object.assign(row, { start_time: l.start, end_time: l.end });
  }
  const hm = (t: string) => t.slice(0, 5);
  const { error: e } = await supabase
    .from("templates")
    .update({
      location: input.location.trim(),
      start_time: rows.map((r) => hm(r.start_time)).sort()[0],
      end_time: rows.map((r) => hm(r.end_time)).sort().at(-1),
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId);
  if (e) throw new Error(e.message);
  await rpc("apply_template", { p_template: templateId });
  return missed
    ? "The weekly schedule is updated too, except for lists it doesn't have."
    : "The weekly schedule is updated too.";
}

export async function messagePractice(eventId: string, subject: string, body: string, includeWaitlist: boolean) {
  return run(async () => {
    const me = await boardOnly();
    if (!subject.trim()) throw new Problem("Add a subject.");
    if (!body.trim()) throw new Problem("Write a message.");
    const n = await rpc<number>("message_event", {
      p_event: eventId,
      p_subject: subject.trim().slice(0, 120),
      p_body: body.trim().slice(0, 5000),
      p_include_waitlist: includeWaitlist,
      p_by: me.id,
    });
    return n ? `Sent to ${players(n)}.` : "Nobody on the list has an email yet, so nothing was sent.";
  });
}

export async function cancelPractice(eventId: string, reason: string) {
  return run(async () => {
    const me = await boardOnly();
    const n = await rpc<number>("cancel_event", { p_event: eventId, p_reason: reason.slice(0, 300), p_by: me.id });
    return `Practice cancelled. Emailed ${players(n)}.`;
  });
}

// Teams -------------------------------------------------------------------------

export async function shuffleTeams(eventId: string) {
  return run(async () => {
    await boardOnly();
    await rpc("shuffle_teams", { p_event: eventId });
    return "Shuffled. Tweak by hand, then send.";
  });
}

export async function setTeam(signupId: string, team: TeamColor | null) {
  return run(async () => {
    await boardOnly();
    await rpc("set_team", { p_signup: signupId, p_team: team });
  });
}

export async function sendTeams(eventId: string) {
  return run(async () => {
    await boardOnly();
    const n = await rpc<number>("send_teams", { p_event: eventId });
    return n ? `Teams sent. Emailing ${players(n)}.` : "Teams are on the practice page. Nobody's team changed, so no emails went out.";
  });
}

// Weekly schedule (any board member) --------------------------------------------------

export type TemplateInput = {
  id: string | null;
  title: string;
  weekday: number;
  location: string;
  openMode: "auto" | "manual";
  openDaysBefore: number;
  openTime: string;
  lists: { name: string; cap: number; makesTeams: boolean; start: string; end: string }[];
};

export async function saveTemplate(input: TemplateInput) {
  return run(async () => {
    await boardOnly();
    const time = /^\d{2}:\d{2}$/;
    if (!input.title.trim()) throw new Problem("Give it a name, like “Wednesday practice”.");
    if (!(input.weekday >= 0 && input.weekday <= 6)) throw new Problem("Pick a day.");
    if (!input.location.trim()) throw new Problem("Add a place.");
    if (input.lists.length === 0) throw new Problem("Add at least one list.");
    if (!time.test(input.openTime) || input.lists.some((l) => !time.test(l.start) || !time.test(l.end))) throw new Problem("Fill in all the times.");
    if (input.lists.some((l) => l.end <= l.start)) throw new Problem("The end time has to be after the start time.");
    if (input.lists.some((l) => !l.name.trim())) throw new Problem("Every list needs a name.");
    if (input.lists.some((l) => !Number.isInteger(l.cap) || l.cap < 1 || l.cap > 500)) throw new Problem("Caps have to be between 1 and 500.");
    if (!(input.openDaysBefore >= 0 && input.openDaysBefore <= 14)) throw new Problem("Pick when sign-ups open.");

    const supabase = db();
    const row = {
      title: input.title.trim(),
      weekday: input.weekday,
      // The practice runs from its first list to its last.
      start_time: input.lists.map((l) => l.start).sort()[0],
      end_time: input.lists.map((l) => l.end).sort().at(-1),
      location: input.location.trim(),
      open_mode: input.openMode,
      open_days_before: input.openDaysBefore,
      open_time: input.openTime,
      updated_at: new Date().toISOString(),
    };
    let id = input.id;
    if (id) {
      const { error } = await supabase.from("templates").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      const { error: delError } = await supabase.from("template_lists").delete().eq("template_id", id);
      if (delError) throw new Error(delError.message);
    } else {
      const { data, error } = await supabase.from("templates").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      id = data.id as string;
    }
    const { error } = await supabase.from("template_lists").insert(
      input.lists.map((l, i) => ({
        template_id: id,
        name: l.name.trim(),
        cap: l.cap,
        makes_teams: l.makesTeams,
        position: i,
        start_time: l.start,
        end_time: l.end,
      })),
    );
    if (error) throw new Error(error.message);
    await rpc("apply_template", { p_template: id });
    return "Saved. Upcoming practices that nobody has signed up for yet now match.";
  });
}

export async function setTemplatePaused(id: string, paused: boolean) {
  return run(async () => {
    await boardOnly();
    const { error } = await db().from("templates").update({ paused, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    // Removes practices nobody has touched yet (paused), or creates them again (resumed).
    await rpc("apply_template", { p_template: id });
    return paused ? "Paused. No new practices will be created until you resume it." : "Resumed. Upcoming practices are back.";
  });
}

export async function deleteTemplate(id: string) {
  return run(async () => {
    await boardOnly();
    await rpc("delete_template", { p_template: id });
    return "Deleted. Practices people already signed up for are kept.";
  });
}

// Board -------------------------------------------------------------------------

export async function inviteBoard(name: string, email: string, role: BoardRole) {
  return run(async () => {
    const me = await presidentOnly();
    const e = emailSchema.safeParse(email);
    if (!e.success) throw new Problem("That email doesn't look right.");
    const supabase = db();
    const { error } = await supabase
      .from("board_members")
      .insert({ email: e.data, name: name.trim().slice(0, 80), role: role === "president" ? "president" : "board", invited_by: me.id });
    if (error) throw new Error(error.message);
    await supabase.from("emails").insert({
      kind: "board_invite",
      to_address: e.data,
      payload: { name: name.trim(), role, invited_by: me.name || me.email },
    });
    return `Invited. We emailed ${e.data} how to log in.`;
  });
}

export async function setBoardRole(id: string, role: BoardRole) {
  return run(async () => {
    await presidentOnly();
    const { error } = await db().from("board_members").update({ role }).eq("id", id);
    if (error) throw new Error(error.message);
    return role === "president" ? "Now a president." : "Now a board member.";
  });
}

export async function removeBoard(id: string) {
  return run(async () => {
    const me = await boardOnly();
    if (me.id !== id && me.role !== "president") throw new NotAllowed("Only presidents can remove people.");
    const { error } = await db().from("board_members").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return me.id === id ? "You've left the board." : "Removed. They can't log in anymore.";
  });
}

export async function setMyName(name: string) {
  return run(async () => {
    const me = await boardOnly();
    const { error } = await db().from("board_members").update({ name: name.trim().slice(0, 80) }).eq("id", me.id);
    if (error) throw new Error(error.message);
    return "Saved. Messages you send to the list are signed with this name.";
  });
}

// Email -------------------------------------------------------------------------

export async function retryFailedEmails() {
  return run(async () => {
    await boardOnly();
    const { data, error } = await db()
      .from("emails")
      .update({ status: "pending", attempts: 0, claimed_at: null })
      .eq("status", "failed")
      .select("id");
    if (error) throw new Error(error.message);
    return `Retrying ${data.length} ${data.length === 1 ? "email" : "emails"}.`;
  });
}
