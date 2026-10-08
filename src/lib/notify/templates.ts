// Email copy and layout. Voice: clear, warm, fair. Lead with the status.
// Colors and type follow the brand file (see PLAN.md, "Brand & design").

import { TEAM_LABEL, type TeamColor } from "../types";
import { clock, dayDate, duration, timeRange, weekdayLong } from "../time";
import type { OutgoingMessage } from "./channel";

type EventJson = { id: string; title: string; location: string; slug: string; starts_at: string; ends_at: string; locks_at: string };
type ListResult = { list: string; spot: "main" | "waitlist"; position: number; cap: number };

export type EmailContext = {
  siteUrl: string;
  /** Personal drop-out link, for emails sent to a member. */
  dropUrl?: string;
  /** The practice page with its sign-up key, for emails about a practice. */
  practiceUrl?: string;
};

const C = {
  blue: "#B9D9EB",
  core: "#1D4F91",
  gold: "#E3B43C",
  red: "#D6453D",
  black: "#111418",
  muted: "#5B6470",
  line: "#D8E6EF",
};
const TEAM_HEX: Record<TeamColor, string> = { black: "#111418", white: "#FFFFFF", red: "#D6453D", light_blue: "#B9D9EB" };

const DISPLAY = "'Bebas Neue', Impact, 'Arial Narrow Bold', 'Helvetica Neue', Arial, sans-serif";
const BODY = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const firstName = (name: string) => name.trim().split(/\s+/)[0];
const day = (e: EventJson) => weekdayLong(e.starts_at);

// Building blocks -------------------------------------------------------------

function layout(ctx: EmailContext, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#F3F7FA;font-family:${BODY};color:${C.black}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F7FA;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${C.blue};padding:24px 40px">
  <a href="${ctx.siteUrl}" style="text-decoration:none;color:#fff">
    <img src="${ctx.siteUrl}/brand/lockup-on-blue@2x.png" width="156" height="56" alt="CBS FC · The List" style="display:block;border:0">
  </a>
</td></tr>
<tr><td style="padding:40px">${body}</td></tr>
<tr><td style="background:${C.blue};padding:18px 40px">
  <table role="presentation" width="100%"><tr>
    <td style="font-family:${DISPLAY};font-size:22px;letter-spacing:.5px">YOUR SPOT, SORTED.</td>
    <td align="right" style="font-size:11px;font-weight:700;letter-spacing:1.5px">CBS FC · NEW YORK</td>
  </tr></table>
</td></tr>
</table></td></tr></table></body></html>`;
}

const headline = (text: string) =>
  `<h1 style="margin:0 0 20px;font-family:${DISPLAY};font-weight:400;font-size:52px;line-height:1;letter-spacing:.5px;text-transform:uppercase">${esc(text)}</h1>`;
const p = (html: string, style = "") => `<p style="margin:0 0 20px;font-size:16px;line-height:1.55;${style}">${html}</p>`;
const small = (html: string) => p(html, `font-size:13px;color:${C.muted}`);

function details(rows: [string, string][]) {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 16px 5px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;color:${C.core};vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;font-size:15px">${esc(v)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${C.line};border-radius:10px;background:#F7FBFD;padding:16px 20px;margin:0 0 20px">${tr}</table>`;
}

function button(href: string, label: string, kind: "solid" | "outline" = "solid") {
  const style =
    kind === "solid"
      ? `background:${C.core};color:#fff;border:2px solid ${C.core}`
      : `background:#fff;color:${C.core};border:2px solid ${C.core}`;
  return `<p style="margin:0 0 16px"><a href="${href}" style="${style};display:inline-block;padding:12px 22px;border-radius:8px;font-family:${DISPLAY};font-size:20px;letter-spacing:.5px;text-decoration:none">${esc(label)}</a></p>`;
}

function eventRows(e: EventJson): [string, string][] {
  return [
    ["WHEN", `${dayDate(e.starts_at)} · ${timeRange(e.starts_at, e.ends_at)}`],
    ["WHERE", e.location],
  ];
}

function dropBlock(ctx: EmailContext) {
  if (!ctx.dropUrl) return "";
  return (
    button(ctx.dropUrl, "Can't make it? Drop out", "outline") +
    small("Dropping out gives your spot to the next teammate on the waitlist. This link only works for you.")
  );
}

const listLine = (r: ListResult) =>
  r.spot === "main" ? `${r.list} · #${r.position} of ${r.cap}` : `${r.list} · #${r.position} on the waitlist`;

const text = (...lines: (string | false | undefined)[]) => lines.filter((l) => l !== false && l !== undefined).join("\n");

// Emails ------------------------------------------------------------------------

export function render(kind: string, payload: Record<string, unknown>, ctx: EmailContext): Omit<OutgoingMessage, "to"> {
  const out = templates[kind as keyof typeof templates];
  if (!out) throw new Error(`No email template for "${kind}"`);
  const { subject, html, text } = out(payload as never, ctx);
  return { subject, html: layout(ctx, html), text: `${text}\n\nYOUR SPOT, SORTED. · CBS FC` };
}

const templates = {
  signup(d: { name: string; event: EventJson; lists: ListResult[] }, ctx: EmailContext) {
    const inAny = d.lists.some((l) => l.spot === "main");
    const wait = d.lists.find((l) => l.spot === "waitlist");
    const first = firstName(d.name);
    const subject = inAny ? `You're in for ${day(d.event)} ✅` : `You're #${wait!.position} on the ${day(d.event)} waitlist`;
    const lead = inAny
      ? `You've got a spot for ${esc(day(d.event))} practice. We'll save it for you.`
      : `The list is full right now, so you're on the waitlist. If someone drops out before ${clock(d.event.locks_at)}, you move up automatically and we'll email you.`;
    const rows: [string, string][] = [
      ...eventRows(d.event),
      ...d.lists.map((l): [string, string] => ["LIST", listLine(l)]),
      ["LOCKS", `${clock(d.event.locks_at)}, 2 hours before kickoff`],
    ];
    const waitNote =
      inAny && wait
        ? p(`You're also #${wait.position} on the ${esc(wait.list)} waitlist. If a spot opens before ${clock(d.event.locks_at)}, it's yours and we'll email you.`)
        : "";
    return {
      subject,
      html:
        headline(inAny ? `You're in, ${first}.` : `You're on the waitlist, ${first}.`) +
        p(lead) +
        details(rows) +
        waitNote +
        small("Your team color comes in a separate email once the board picks teams.") +
        dropBlock(ctx),
      text: text(
        inAny ? `You're in, ${first}.` : `You're on the waitlist, ${first}.`,
        "",
        ...rows.map(([k, v]) => `${k}: ${v}`),
        "",
        ctx.dropUrl && `Can't make it? Drop out so a teammate gets your spot: ${ctx.dropUrl}`,
      ),
    };
  },

  promoted(d: { name: string; event: EventJson; list: string; position: number; cap: number }, ctx: EmailContext) {
    const rows: [string, string][] = [...eventRows(d.event), ["LIST", `${d.list} · #${d.position} of ${d.cap}`]];
    return {
      subject: `A spot opened up. You're in for ${day(d.event)} 🎉`,
      html: headline(`You're in, ${firstName(d.name)}.`) + p("A spot opened up and it's yours. See you on the pitch.") + details(rows) + dropBlock(ctx),
      text: text(`You're in, ${firstName(d.name)}. A spot opened up and it's yours.`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", ctx.dropUrl && `Can't make it? ${ctx.dropUrl}`),
    };
  },

  team(d: { name: string; event: EventJson; team: TeamColor; list: string; update: boolean }, ctx: EmailContext) {
    const label = TEAM_LABEL[d.team].toUpperCase();
    const swatch = `<span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:${TEAM_HEX[d.team]};border:2px solid ${C.black};vertical-align:middle;margin-right:10px"></span>`;
    return {
      subject: d.update ? `Team change: you're on ${label} for ${day(d.event)}` : `You're on ${label} for ${day(d.event)}`,
      html:
        `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;color:${C.core}">${d.update ? "TEAM CHANGE" : "YOUR TEAM"}</p>` +
        `<h1 style="margin:0 0 20px;font-family:${DISPLAY};font-weight:400;font-size:56px;line-height:1">${swatch}${label}</h1>` +
        p(`${esc(firstName(d.name))}, you're on <b>${esc(TEAM_LABEL[d.team])}</b> for ${esc(day(d.event))} ${esc(d.list)}. Bring a ${esc(TEAM_LABEL[d.team].toLowerCase())} shirt if you have one.`) +
        details(eventRows(d.event)) +
        (ctx.practiceUrl ? button(ctx.practiceUrl, "See all teams") : "") +
        dropBlock(ctx),
      text: text(`You're on ${label} for ${day(d.event)}.`, "", ...eventRows(d.event).map(([k, v]) => `${k}: ${v}`), "", ctx.practiceUrl && `All teams: ${ctx.practiceUrl}`),
    };
  },

  cancelled(d: { name: string; event: EventJson; reason: string | null }, ctx: EmailContext) {
    return {
      subject: `${day(d.event)} practice is off`,
      html:
        headline("Practice is off.") +
        p(`Sorry, ${esc(firstName(d.name))}. ${esc(day(d.event))} practice (${esc(dayDate(d.event.starts_at))}, ${esc(timeRange(d.event.starts_at, d.event.ends_at))}) is cancelled.`) +
        (d.reason ? details([["WHY", d.reason]]) : "") +
        p("Watch the WhatsApp group for the next one."),
      text: text(`${day(d.event)} practice is off.`, d.reason ? `Why: ${d.reason}` : undefined, "", "Watch the WhatsApp group for the next one."),
    };
  },

  changed(d: { name: string; event: EventJson; old_event: EventJson }, ctx: EmailContext) {
    const rows: [string, string][] = [...eventRows(d.event), ["LOCKS", `${clock(d.event.locks_at)}, 2 hours before kickoff`]];
    const was = `${dayDate(d.old_event.starts_at)} · ${timeRange(d.old_event.starts_at, d.old_event.ends_at)} · ${d.old_event.location}`;
    return {
      subject: `Heads up: ${day(d.event)} practice has changed`,
      html:
        headline("Practice has changed.") +
        p(`${esc(firstName(d.name))}, here are the new details. You keep your spot.`) +
        details(rows) +
        small(`It was: ${esc(was)}`) +
        dropBlock(ctx),
      text: text("Practice has changed. You keep your spot.", "", ...rows.map(([k, v]) => `${k}: ${v}`), `It was: ${was}`, "", ctx.dropUrl && `Can't make it now? ${ctx.dropUrl}`),
    };
  },

  board_message(d: { name: string; event: EventJson; subject: string; body: string; from_name: string | null }, ctx: EmailContext) {
    const paras = d.body.split(/\n{2,}/).map((para) => p(esc(para).replace(/\n/g, "<br>")));
    return {
      subject: d.subject,
      html:
        `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;color:${C.core}">${esc(day(d.event).toUpperCase())} PRACTICE · FROM THE BOARD</p>` +
        headline(d.subject) +
        paras.join("") +
        (d.from_name ? p(`— ${esc(d.from_name)}`, `color:${C.muted}`) : "") +
        details(eventRows(d.event)) +
        dropBlock(ctx),
      text: text(d.subject, "", d.body, d.from_name ? `— ${d.from_name}` : undefined, "", ctx.dropUrl && `Can't make it? ${ctx.dropUrl}`),
    };
  },

  late_drop(d: { member_name: string; event: EventJson; list: string; minutes_before: number }, ctx: EmailContext) {
    const when = duration(d.minutes_before * 60_000);
    return {
      subject: `Late drop: ${d.member_name} left ${day(d.event)} ${d.list} (${when} before kickoff)`,
      html:
        `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;color:${C.red}">LATE DROP</p>` +
        headline(`${d.member_name} dropped out.`) +
        p(`They left the ${esc(d.list)} list ${esc(when)} before kickoff, after the list locked, so nobody was moved up automatically.`) +
        details(eventRows(d.event)) +
        button(`${ctx.siteUrl}/admin/p/${d.event.slug}`, "Open the practice") +
        small("You can promote someone from the waitlist there. If teams are already out, the team builder shows the gap."),
      text: text(`Late drop: ${d.member_name} left ${d.list}, ${when} before kickoff.`, "", `Open the practice: ${ctx.siteUrl}/admin/p/${d.event.slug}`),
    };
  },

  board_invite(d: { name: string; role: "president" | "board"; invited_by: string | null }, ctx: EmailContext) {
    const role = d.role === "president" ? "a president" : "a board member";
    return {
      subject: `You're on the CBS FC board`,
      html:
        headline("Welcome to the board.") +
        p(`${d.invited_by ? `${esc(d.invited_by)} added you` : "You've been added"} to The List as ${role}. You can now run practices: open sign-ups, manage the list and send teams.`) +
        p("There's no password. Log in with this email address and we'll send you a link.") +
        button(`${ctx.siteUrl}/admin/login`, "Log in"),
      text: text(`You've been added to The List as ${role}.`, `Log in with this email: ${ctx.siteUrl}/admin/login`),
    };
  },
};

/** The login link email. Sent directly, not through the outbox, because the link is a secret. */
export function loginEmail(link: string, siteUrl: string): Omit<OutgoingMessage, "to"> {
  return {
    subject: "Your login link for The List",
    html: layout(
      { siteUrl },
      headline("Here's your login link.") + button(link, "Log in to The List") + small("The link works once and expires in 1 hour. If you didn't ask for it, you can ignore this email."),
    ),
    text: `Log in to The List: ${link}\n\nThe link works once and expires in 1 hour.`,
  };
}
