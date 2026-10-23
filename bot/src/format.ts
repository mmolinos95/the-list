import { dayDate, relativeDay, timeRange } from "../../src/lib/time";
import { TEAM_LABEL, TEAMS } from "../../src/lib/types";
import type { ListInfo, Practice } from "./data/types";

// Reply text. Short, WhatsApp-formatted (*bold*, _italic_), New York times.

export const day = (p: Practice) => dayDate(p.event.starts_at); // "Thu, Oct 23"

const listTime = (l: ListInfo) => timeRange(l.starts_at, l.ends_at);

/** "Open · locks Thu at 5 PM", "Sign-ups open Wed at 9 AM", "Cancelled". */
export function stageLine(p: Practice, now: Date) {
  const e = p.event;
  switch (p.stage) {
    case "cancelled":
      return e.cancel_reason ? `*Cancelled*: ${e.cancel_reason}` : "*Cancelled*";
    case "past":
      return "Over";
    case "teams":
      return "Locked · teams are out";
    case "locked":
      return "Locked";
    case "open":
      return `Open · locks ${relativeDay(e.locks_at, now)}`;
    case "soon":
      return `Sign-ups open ${relativeDay(e.opens_at!, now)}`;
    case "waiting":
      return "Sign-ups not open yet";
  }
}

/** "Skills: 12 of 40 left" or "Games: full, 3 waiting". */
export function listCount(l: ListInfo, short = false) {
  const left = l.cap - l.main.length;
  const wait = l.waitlist.length ? `, ${l.waitlist.length} waiting` : "";
  if (short) return left > 0 ? `${l.name} ${left} left${wait}` : `${l.name} full${wait}`;
  return `${l.name}: ${l.main.length}/${l.cap}${left > 0 ? ` (${left} left)` : " (full)"}${wait}`;
}

/** One practice in the "!week" overview. */
export function overviewItem(p: Practice, now: Date) {
  const head = `*${day(p)}* · ${timeRange(p.event.starts_at, p.event.ends_at)} · ${p.event.location}`;
  if (p.stage === "cancelled") return `${head}\n${stageLine(p, now)}`;
  return `${head}\n${p.lists.map((l) => listCount(l, true)).join(" · ")} · ${stageLine(p, now)}`;
}

export function details(p: Practice, now: Date) {
  const lines = [
    `*${p.event.title} · ${day(p)}*`,
    `${timeRange(p.event.starts_at, p.event.ends_at)} · ${p.event.location}`,
    stageLine(p, now),
  ];
  if (p.stage !== "cancelled") {
    const many = p.lists.length > 1;
    for (const l of p.lists) lines.push(`• ${listCount(l)}${many ? ` · ${listTime(l)}` : ""}`);
  }
  return lines.join("\n");
}

/** The practice with everyone's names, for "!list" and after every change. */
export function fullList(p: Practice, now: Date) {
  const lines = [`*${p.event.title} · ${day(p)}*`, `${timeRange(p.event.starts_at, p.event.ends_at)} · ${p.event.location}`, stageLine(p, now)];
  if (p.stage === "cancelled") return lines.join("\n");
  const many = p.lists.length > 1;
  for (const l of p.lists) {
    lines.push("", `*${l.name}*${many ? ` · ${listTime(l)}` : ""} · ${l.main.length}/${l.cap}`);
    lines.push(...(l.main.length ? l.main.map((s, i) => `${i + 1}. ${s.name}`) : ["_Nobody yet_"]));
    if (l.waitlist.length) lines.push("_Waitlist_", ...l.waitlist.map((s, i) => `${i + 1}. ${s.name}`));
  }
  return lines.join("\n");
}

/** A member's own spots, for "!me" and after sign-ups. */
export function mySpots(practices: Practice[], memberId: string) {
  const lines: string[] = [];
  for (const p of practices) {
    const parts: string[] = [];
    for (const l of p.lists) {
      const main = l.main.findIndex((s) => s.member_id === memberId);
      const wait = l.waitlist.findIndex((s) => s.member_id === memberId);
      if (main >= 0) {
        const team = l.makes_teams && l.teams_sent_at && l.main[main].team_sent ? `, team *${TEAM_LABEL[l.main[main].team_sent!]}*` : "";
        parts.push(`${l.name}: in (#${main + 1} of ${l.cap})${team}`);
      } else if (wait >= 0) {
        parts.push(`${l.name}: waitlist #${wait + 1}`);
      }
    }
    if (parts.length) lines.push(`*${day(p)}*${p.stage === "cancelled" ? " (cancelled)" : ""} · ${parts.join(" · ")}`);
  }
  return lines;
}

/** Draft teams (the builder's `team`), per teams list. */
export function teamsText(p: Practice) {
  const out: string[] = [];
  for (const l of p.lists.filter((x) => x.makes_teams)) {
    out.push(`*${l.name} teams · ${day(p)}*`);
    for (const t of TEAMS) {
      const names = l.main.filter((s) => s.team === t).map((s) => s.name);
      if (names.length) out.push(`*${TEAM_LABEL[t]}* (${names.length}): ${names.join(", ")}`);
    }
    const none = l.main.filter((s) => !s.team).map((s) => s.name);
    if (none.length) out.push(`_No team_: ${none.join(", ")}`);
  }
  return out.join("\n");
}

export const players = (n: number) => `${n} ${n === 1 ? "player" : "players"}`;

/** "Skills (7–8 PM) or Games (8–9 PM)" */
export function listChoices(p: Practice) {
  const names = p.lists.map((l) => `*${l.name}* (${listTime(l)})`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0] ?? "";
}
