import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// A practice's sign-up link is "/p/<slug>?k=<key>". The key is an HMAC of the
// practice id, so only the board (who copies it into WhatsApp) can hand it
// out, and nothing needs to be stored. It stops working once the practice is
// over, so people outside the WhatsApp group can't keep using old links.

function key(eventId: string) {
  return createHmac("sha256", env.dropLinkSecret).update(`signup.${eventId}`).digest("base64url").slice(0, 16);
}

export function signupPath(event: { id: string; slug: string }) {
  return `/p/${event.slug}?k=${key(event.id)}`;
}

export function signupUrl(event: { id: string; slug: string }) {
  return `${env.siteUrl}${signupPath(event)}`;
}

/** True when `k` is this practice's key and the practice hasn't ended. */
export function hasSignupAccess(event: { id: string; ends_at: string }, k: unknown, now = new Date()) {
  if (typeof k !== "string" || now.getTime() >= Date.parse(event.ends_at)) return false;
  const expected = Buffer.from(key(event.id));
  const given = Buffer.from(k);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
