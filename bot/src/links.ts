import { createHmac } from "node:crypto";

// The practice's signed sign-up link, re-implemented from src/lib/signup-link.ts
// (which imports server-only and env.ts). test/links.test.ts checks it matches
// the app's output for the same secret.

export function signupKey(secret: string, slug: string) {
  return createHmac("sha256", secret).update(`signup.${slug}`).digest("base64url").slice(0, 16);
}

export function signupUrl(secret: string, siteUrl: string, event: { slug: string }) {
  return `${siteUrl}/p/${event.slug}?k=${signupKey(secret, event.slug)}`;
}
