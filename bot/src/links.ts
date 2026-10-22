import { createHmac } from "node:crypto";

// Signed links, re-implemented from src/lib/signup-link.ts, drop-link.ts and
// board-action.ts (those import server-only and env.ts). test/links.test.ts
// checks they match the app's output for the same secret.

export function signupKey(secret: string, slug: string) {
  return createHmac("sha256", secret).update(`signup.${slug}`).digest("base64url").slice(0, 16);
}

export function signupUrl(secret: string, siteUrl: string, event: { slug: string }) {
  return `${siteUrl}/p/${event.slug}?k=${signupKey(secret, event.slug)}`;
}

export function dropUrl(secret: string, siteUrl: string, eventId: string, memberId: string) {
  const sig = createHmac("sha256", secret).update(`${eventId}.${memberId}`).digest("base64url").slice(0, 32);
  return `${siteUrl}/drop/${eventId}.${memberId}.${sig}`;
}

export type BoardAction =
  | { a: "promote"; e: string; l: string; to: string; x: number }
  | { a: "cancel"; e: string; to: string; x: number };

export function boardActionUrl(secret: string, siteUrl: string, action: BoardAction) {
  const body = Buffer.from(JSON.stringify(action)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`board-action:${body}`).digest("base64url").slice(0, 32);
  return `${siteUrl}/admin/act/${body}.${sig}`;
}
