import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// A personal drop-out link is "<eventId>.<memberId>.<signature>". The
// signature proves the server issued it, so nothing needs to be stored. The
// same person always gets the same link for a practice, so every email they
// receive keeps working.

function sign(eventId: string, memberId: string) {
  return createHmac("sha256", env.dropLinkSecret).update(`${eventId}.${memberId}`).digest("base64url").slice(0, 32);
}

export function dropToken(eventId: string, memberId: string) {
  return `${eventId}.${memberId}.${sign(eventId, memberId)}`;
}

export function dropUrl(eventId: string, memberId: string) {
  return `${env.siteUrl}/drop/${dropToken(eventId, memberId)}`;
}

/** Returns the event and member a token belongs to, or null if it is forged or malformed. */
export function verifyDropToken(token: string): { eventId: string; memberId: string } | null {
  const parts = decodeURIComponent(token).split(".");
  if (parts.length !== 3) return null;
  const [eventId, memberId, sig] = parts;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(eventId) || !uuid.test(memberId)) return null;
  const expected = Buffer.from(sign(eventId, memberId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { eventId, memberId };
}
