import { toLocalInputs, weekdayLong } from "../../src/lib/time";
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
