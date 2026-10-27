import { toLocalInputs, weekdayLong, weekdayShort } from "../../src/lib/time";
import type { EventList, EventRow } from "./data/types";
import { signupUrl } from "./links";

// The board's WhatsApp post, re-implemented from src/lib/share.ts (which
// imports server-only and env.ts). test/links.test.ts checks they match.
//
//   List Sign Up: 10/9 Friday Practice
//   Skills: 10:00 - 11:00 (40 players)
//   Games: 11:00 - 12:00 (40 players)
//   Location: Riverside Park (107th) entrance at 103rd St
//   Sign up: https://…/p/2026-10-09-fri?k=…

const hm = (iso: string) => toLocalInputs(iso).time;

export function sharePost(
  secret: string,
  siteUrl: string,
  event: Pick<EventRow, "slug" | "starts_at" | "location">,
  lists: Pick<EventList, "name" | "cap" | "starts_at" | "ends_at">[],
) {
  const { date } = toLocalInputs(event.starts_at);
  const [, month, day] = date.split("-").map(Number);
  return [
    `List Sign Up: ${month}/${day} ${weekdayLong(event.starts_at)} Practice`,
    ...lists.map((l) => `${l.name}: ${hm(l.starts_at)} - ${hm(l.ends_at)} (${l.cap} players)`),
    `Location: ${event.location}`,
    `Sign up: ${signupUrl(secret, siteUrl, event)}`,
  ].join("\n");
}

/**
 * The post once members can sign up in WhatsApp: the same practice lines, then
 * the commands, with the web link only as a fallback at the end.
 *
 *   List Sign Up: 10/26 Monday Practice
 *   Games: 12:40 - 13:40 (40 players)
 *   Location: Riverside Park (107th) entrance at 103rd St
 *
 *   *Sign up here:* send `!in mon`
 *   First time? Add your name once: `!in mon Firstname Lastname`
 *   Drop out: `!out mon` · Who's in: `!list mon`
 *   Or on the web: https://…/p/2026-10-26-mon?k=…
 */
export function chatPost(
  event: Pick<EventRow, "starts_at" | "location">,
  lists: Pick<EventList, "name" | "cap" | "starts_at" | "ends_at">[],
  now: Date,
  link: string | null,
) {
  const { date } = toLocalInputs(event.starts_at);
  const [, month, day] = date.split("-").map(Number);
  const sel = selectorFor(event.starts_at, now);
  return [
    `List Sign Up: ${month}/${day} ${weekdayLong(event.starts_at)} Practice`,
    ...lists.map((l) => `${l.name}: ${hm(l.starts_at)} - ${hm(l.ends_at)} (${l.cap} players)`),
    `Location: ${event.location}`,
    "",
    `*Sign up here:* send \`!in ${sel}\``,
    `First time? Add your name once: \`!in ${sel} Firstname Lastname\``,
    ...(lists.length === 2 ? [`One list only? \`!in ${sel} ${lists[0].name.toLowerCase()}\` · Both: \`!in ${sel} both\``] : []),
    `Drop out: \`!out ${sel}\` · Who's in: \`!list ${sel}\``,
    ...(link ? [`Or on the web: ${link}`] : []),
  ].join("\n");
}

/** How to name a practice in a command: a weekday is easiest to type, but only names one practice within the week. */
export function selectorFor(startsAt: string, now: Date) {
  if (Date.parse(startsAt) - now.getTime() < 6 * 86_400_000) return weekdayShort(startsAt).toLowerCase();
  const [, month, day] = toLocalInputs(startsAt).date.split("-").map(Number);
  return `${month}/${day}`;
}
