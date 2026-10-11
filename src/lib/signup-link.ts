import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// A practice's sign-up link is "/p/<slug>?k=<key>". The key is an HMAC of the
// practice's slug, so only the board (who copies it into WhatsApp) can hand it
// out, and nothing needs to be stored. The slug (not the id) is signed because
// saving the weekly schedule rebuilds untouched practices with new ids but the
// same slug, and a link already posted must keep working. It stops working
// once the practice is over, so people outside the WhatsApp group can't keep
// using old links.

function key(slug: string) {
  return createHmac("sha256", env.dropLinkSecret).update(`signup.${slug}`).digest("base64url").slice(0, 16);
}

export function signupPath(event: { slug: string }) {
  return `/p/${event.slug}?k=${key(event.slug)}`;
}

export function signupUrl(event: { slug: string }) {
  return `${env.siteUrl}${signupPath(event)}`;
}

/** "ok" for this practice's key before it ends, "expired" for its key after, "invalid" otherwise. */
export function signupAccess(event: { slug: string; ends_at: string }, k: unknown, now = new Date()): "ok" | "expired" | "invalid" {
  if (typeof k !== "string") return "invalid";
  const expected = Buffer.from(key(event.slug));
  const given = Buffer.from(k);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  return now.getTime() < Date.parse(event.ends_at) ? "ok" : "expired";
}

/** True when `k` is this practice's key and the practice hasn't ended. */
export function hasSignupAccess(event: { slug: string; ends_at: string }, k: unknown, now = new Date()) {
  return signupAccess(event, k, now) === "ok";
}
